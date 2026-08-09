import * as THREE from 'three';
import { createRendererBackend, type RendererBackend } from './RendererBackend';
import { Settings, QualityLevel, TimeMode } from './Settings';
import type { LifeSnapshot, NpcSnapshot, PopulationSnapshot, TestSurface } from './TestMode';
import type { PerceptionKind } from '../npc/Perception';
import { DisposalRegistry } from './DisposalRegistry';
import { ZoneManager } from '../world/zones/ZoneManager';
import { buildCityChunk, buildCitySkyline } from '../world/zones/CityBuilder';
import { CityRuntime } from '../world/zones/CityRuntime';
import type { ZoneId } from '../world/zones/Manifest';
import type { ZoneRuntime } from '../world/zones/ZoneRuntime';
import { SimulationClock } from './SimulationClock';
import { PhysicsWorld } from '../physics/PhysicsWorld';
// Type-only, so none of the vehicle system reaches the main chunk. The
// implementations arrive through the dynamic import in `spawnVehicle`, beside
// Rapier: a player who never gets into a vehicle downloads neither.
import type { VehicleController } from '../vehicles/VehicleController';
import type { VehicleId } from '../vehicles/VehicleDefinition';
import type { VehicleInput } from '../vehicles/VehicleDynamics';
import type { SeatSpec } from '../vehicles/VehicleDefinition';
import { VehicleRegistry } from '../vehicles/VehicleRegistry';
// Type-only, so the population system and the ~900 kB of Recast WebAssembly
// behind it stay out of the app chunk. The implementation arrives through the
// dynamic import in `ensurePopulation`, once the world is already standing.
import type { Population } from '../npc/Population';
import { POPULATION_BUDGETS, type PopulationBudget } from '../npc/NpcLod';
import { RelationshipStore } from '../npc/Relationships';
import { availableChoices, pickBark, SMALL_TALK } from '../npc/Dialogue';
import { LifeClock } from './clocks/LifeClock';
import { WorldClock } from './clocks/WorldClock';
import { StoryClock } from './clocks/StoryClock';
import { SaveService } from '../save/SaveService';
import { createSaveDriver } from '../save/SaveDriver';
import { CONTENT_VERSION, type SaveData, type SaveSlotId } from '../save/SaveSchema';
import {
  canEnterZone,
  DEFAULT_FREE_ROAM,
  type FreeRoamOptions,
  type GameMode,
  type GateContext,
} from './Gates';
import { WORLD_MANIFEST } from '../world/zones/worldManifest';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { AssetManager } from './AssetManager';
import { World } from '../world/World';
import { InteractionSystem, type InteractionState } from '../interaction/InteractionSystem';
import {
  worldInteractables,
  type WorldActionHandlers,
  type WorldInteractionContext,
} from '../interaction/WorldInteractables';
import { Environment } from '../world/Environment';
import { Player } from '../player/Player';
import { Inventory, Equipment, type EquipSlot } from '../player/Inventory';
import { Needs } from '../player/Needs';
import { DEFAULT_CAMERA, ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { ContactShadow } from '../graphics/StylizedShadows';
import { PostProcessing } from '../graphics/PostProcessing';
import { WindowPortal } from '../graphics/WindowPortal';
import { INTERIOR_ORIGIN } from '../world/Interiors';
import { setToonPlayer, toonFromImported, updateToonTime } from '../graphics/ToonMaterial';
import { HUD } from '../ui/HUD';
import { LoadingScreen } from '../ui/LoadingScreen';
import { Minimap } from '../ui/Minimap';
import { clamp } from '../utils/MathUtils';
import { featureFlags } from './FeatureFlags';

/**
 * Owns the frame loop and wires every subsystem together.
 *
 * Update order matters and is deliberate:
 *   input -> player (moves, collides) -> camera (follows, fades occluders)
 *   -> environment (sun follows player) -> world (birds, lamps, pickups)
 *   -> audio -> render
 * The camera reads the player's post-collision position, so there is never a
 * frame where the character has moved and the camera has not.
 */

const MAX_FRAME_DT = 1 / 15;
const DEBUG = import.meta.env.DEV;

/** What the test bridge reports when the population never arrived. */
const EMPTY_POPULATION: PopulationSnapshot = {
  named: 0,
  ambient: 0,
  near: 0,
  mid: 0,
  far: 0,
  bodies: 0,
  navState: 'idle',
  navBuildMs: 0,
  navAgents: 0,
  offMeshLinks: 0,
  traffic: 0,
  trafficParked: 0,
  trafficBarges: 0,
  witnessed: 0,
  stuckRecoveries: 0,
  farTickMs: 0,
};

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private renderer!: RendererBackend;
  private zones!: ZoneManager;
  /** Parent for streamed district geometry; null while the village is active. */
  private zoneGroup: THREE.Group | null = null;
  /** The active district runtime, if the player is in one. */
  private city: CityRuntime | null = null;

  /**
   * Renderer-lifetime resources.
   *
   * Distinct from the zone scope on purpose. `PostProcessing` and
   * `WindowPortal` own render targets sized to the *viewport*, and both are
   * built before any world exists and outlive every zone change. Putting them
   * in a zone scope would tear them down on travel and leave rendering broken
   * on arrival. Zone content — the World, and the CollisionWorld it owns —
   * belongs to the zone scope; these belong here.
   */
  private readonly gameScope = new DisposalRegistry('game');
  private camera!: ThirdPersonCamera;
  private post!: PostProcessing;
  private env!: Environment;
  /**
   * The active zone, behind the contract. Everything Game needs from a zone
   * goes through here, so it no longer assumes it is in the village.
   */
  private runtime!: ZoneRuntime;

  /**
   * The village specifically, for the handful of things only it has:
   * collectibles, the shared interior cell, keepsake markers. Null once a
   * district is active — the narrowing is the point, since a district has no
   * keepsakes to count.
   */
  private village: World | null = null;
  private player!: Player;
  private contact!: ContactShadow;
  private portal!: WindowPortal;
  private hud!: HUD;
  private minimap!: Minimap;

  private readonly input = new InputManager();
  private readonly audio = new AudioManager();
  private readonly settings = new Settings();

  /**
   * Three independent clocks. Life is gated on active play; the world's day
   * runs on its own fixed length; story timers are plain active seconds. See
   * src/core/clocks for why none of them derives from the others.
   */
  private readonly life = new LifeClock();
  private readonly worldClock = new WorldClock();
  private readonly storyClock = new StoryClock();
  private handlingBirthday = false;

  /**
   * Physics, and the fixed step it runs on.
   *
   * Separate from the frame's `dt` on purpose. The character motor, camera and
   * world are tuned against a variable step and work; re-timing all of them to
   * gain rigid bodies would put the thing that already feels right at risk for
   * the sake of the thing that does not exist yet. So the accumulator wraps
   * physics alone, and everything else is left as it was.
   *
   * `physics` stays null until something actually needs it — Rapier is 2.2 MB
   * and arrives by dynamic import, so a player who never gets on a bicycle
   * never downloads it.
   */
  private readonly physicsClock = new SimulationClock({ stepSeconds: 1 / 60, maxStepsPerFrame: 5 });
  private physics: PhysicsWorld | null = null;
  private physicsLoading: Promise<PhysicsWorld> | null = null;
  /** Interpolation factor for the current partial physics step. */
  private physicsAlpha = 0;

  /**
   * Live vehicles, keyed by instance id.
   *
   * Physics-only until the models land: the controller drives a rigid body and
   * a placeholder box follows it, so handling can be tuned and verified before
   * any art exists.
   */
  private readonly vehicles = new Map<string, VehicleController>();
  private readonly vehicleProxies = new Map<string, THREE.Object3D>();
  /** Base meshes, LODs and collision proxies from vehicles.glb, by node name. */
  private vehicleModels = new Map<string, THREE.Object3D>();
  /**
   * The character GLB, kept so NPC bodies can be cloned from it.
   *
   * One rig for the whole population — the brief's "do not create one GLB per
   * NPC", and the reason twenty residents cost one download.
   */
  private playerRig: THREE.Object3D | null = null;
  private playerClips: readonly THREE.AnimationClip[] = [];
  private nextVehicleSerial = 1;
  /** Vehicles the player has locked. */
  private readonly lockedVehicles = new Set<string>();
  /**
   * Ownership, condition, fuel and where each vehicle was parked.
   *
   * Separate from the controllers because a controller only exists while its
   * vehicle is loaded in the current zone, and none of this may be forgotten
   * when the player walks away or travels.
   */
  private readonly garage = new VehicleRegistry();
  /** Distance each vehicle has driven since fuel was last charged, metres. */
  private readonly odometer = new Map<string, number>();
  /** Speed last step, to notice an impact without subscribing to contacts. */
  private readonly lastSpeed = new Map<string, number>();
  /**
   * Fuel is a soft system and can be switched off entirely, per the brief.
   * A bicycle is unaffected either way -- it has no tank to empty.
   */
  private fuelEnabled = true;
  /** Set when the dev proving ground is built. */
  private testRoadOrigin: THREE.Vector3 | null = null;

  /**
   * What the player is riding, if anything.
   *
   * The character keeps existing while seated -- hidden and held at the seat --
   * rather than being destroyed and rebuilt. Getting out is then a matter of
   * showing it again and teleporting it somewhere safe, and none of the
   * inventory, needs or appearance state has to survive a round trip.
   */
  private riding: { id: string; seat: SeatSpec } | null = null;
  private cameraWasReversing = false;

  /**
   * The vehicle modules, once loaded.
   *
   * `updateRiding` runs every frame, so it cannot await an import. It also
   * cannot run before a vehicle exists, and a vehicle cannot exist before
   * `spawnVehicle` has finished importing — so capturing the namespaces there
   * makes the frame path synchronous without pulling ~19 kB of driving code
   * into the startup bundle.
   */
  private vehicleApi: {
    controls: typeof import('../vehicles/VehicleControls');
    access: typeof import('../vehicles/VehicleAccess');
    dynamics: typeof import('../vehicles/VehicleDynamics');
  } | null = null;
  private readonly camTarget = new THREE.Vector3();
  private readonly seatPos = new THREE.Vector3();

  /**
   * The zone's population, once it has arrived.
   *
   * Null before the dynamic import resolves and null again between zones. The
   * game is fully playable in that state — the village stands, the player
   * walks, vehicles drive — which is exactly why the population is allowed to
   * be late. It carries Recast's WebAssembly with it, and the initial-load
   * budget has no room for that.
   */
  private population: Population | null = null;
  private populationLoading: Promise<void> | null = null;
  /**
   * Relationships live here rather than in `Population` because they outlive
   * it: the player's history with a village resident has to survive travelling
   * to the city and back, and the population is torn down on every zone change.
   */
  private readonly relationships = new RelationshipStore();
  /** Named-resident ages, held across zone changes for the same reason. */
  private npcAges: Array<{ id: string; age: number }> = [];
  /** Seconds since the player last announced themselves to anybody nearby. */
  private greetTimer = 0;

  private readonly saves = new SaveService(createSaveDriver());
  private mode: GameMode = 'story';
  /** The spawn the player last arrived at; saved rather than a raw position. */
  private lastSpawnId = 'village_start';
  private readonly completedChapters = new Set<string>();
  /** True once an autosave has been applied, so mode selection defers to it. */
  private resumedFromSave = false;
  private readonly inventory = new Inventory();
  private readonly equipment = new Equipment();
  private readonly needs = new Needs();
  private freeRoamMoney = 0;
  private readonly unlockedZones = new Set<ZoneId>(['village_coast']);

  private running = false;
  private paused = false;
  private elapsed = 0;
  private frameHandle = 0;

  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 60;

  private readonly camForward = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly interactions = new InteractionSystem();
  /** Last frame's offer, for the HUD and the test bridge. */
  private lastInteraction: InteractionState | null = null;
  private readonly interactionHandlers: WorldActionHandlers = {
    sleep: () => void this.sleep(),
    enter: () => void this.enterInterior(),
    exit: () => void this.exitInterior(),
    sit: (on) => this.sit(on),
    wardrobe: () => this.hud.openWardrobe(true),
  };
  private sleeping = false;
  private transitioning = false;
  private indoors = false;
  private readonly returnPoint = new THREE.Vector3();
  private returnFacing = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async start(loading: LoadingScreen): Promise<void> {
    const preset = this.settings.preset;

    this.renderer = createRendererBackend(this.canvas, preset).backend;
    this.camera = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.post = new PostProcessing(this.renderer.renderer, this.scene, this.camera.camera);

    const assetManager = new AssetManager();
    const assets = await assetManager.loadAll((p) =>
      loading.setProgress(p.fraction * 0.7, p.label),
    );

    loading.setProgress(0.76, 'the ground');
    // Yield so the browser can paint the progress bar before the heavy
    // synchronous world build blocks the main thread.
    await frame();

    this.env = new Environment(this.scene, preset);
    this.env.setMode(this.settings.current.timeMode);

    this.portal = new WindowPortal(window.innerWidth, window.innerHeight);

    // The village is now a zone. It is still the same hand-authored World,
    // built exactly as before — the difference is that the ZoneManager owns
    // it through a disposal scope, so leaving the zone is guaranteed to give
    // its geometry, materials and textures back rather than relying on
    // Game.dispose() remembering to.
    this.zones = new ZoneManager(WORLD_MANIFEST, {
      buildZone: (zone, scope) => {
        if (zone.id === 'village_coast') {
          const world = new World(assets, preset);
          world.portalMaterial = this.portal.material;
          world.build();
          this.scene.add(world.group);
          scope.addTeardown(
            () => {
              this.scene.remove(world.group);
              world.dispose();
            },
            'geometry',
            'village-world',
          );
          this.runtime = world;
          this.village = world;
          return;
        }

        // A city district. Streamed chunks attach to this group; the skyline
        // is always-resident dressing so the horizon does not end in sky.
        const group = new THREE.Group();
        group.name = `zone_${zone.id}`;
        this.scene.add(group);
        this.zoneGroup = group;

        const city = new CityRuntime(zone, group);
        this.city = city;
        this.runtime = city;
        // A district has no keepsakes and no interior cell. Clearing this is
        // what makes the village-only paths unreachable rather than stale.
        this.village = null;

        scope.addTeardown(
          () => {
            this.scene.remove(group);
            city.dispose();
            if (this.zoneGroup === group) this.zoneGroup = null;
            if (this.city === city) this.city = null;
          },
          'other',
          `zone-group:${zone.id}`,
        );
        buildCitySkyline(zone, scope, group);
      },
      buildChunk: (zone, chunk, scope) => {
        // Authored zones never stream, so this only fires for districts.
        if (!this.zoneGroup || !this.city) return;
        const meshes = buildCityChunk(zone, chunk, scope, this.zoneGroup);
        // Solid geometry has to reach collision too, or the player falls
        // through a district that renders perfectly well.
        const city = this.city;
        city.addChunkColliders(chunk.id, meshes);
        scope.addTeardown(
          () => city.releaseChunkColliders(chunk.id),
          'physics',
          `chunk-colliders:${chunk.id}`,
        );
      },
    });
    await this.zones.enter('village_coast');

    loading.setProgress(0.94, 'the explorer');
    await frame();

    this.vehicleModels = assets.vehicles;
    // Record which palette slot each primitive came from *before* `Player`
    // swaps the imported materials for toon ones. NPC bodies are cloned from
    // this same rig and need the mapping to bake their colours; the material
    // names do not survive the conversion, and `userData` does survive a
    // SkeletonUtils clone.
    assets.player.scene?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (m?.name) mesh.userData.paletteSlot = m.name;
    });
    this.playerRig = assets.player.scene;
    this.playerClips = assets.player.clips;
    this.player = new Player(assets.player.scene, assets.player.clips, this.input);
    this.scene.add(this.player.root);
    this.player.setSpawn(this.runtime.spawn, this.runtime.spawnFacing);
    this.camera.resetBehind(this.player.lookTarget, this.runtime.spawnFacing);

    this.contact = new ContactShadow(0.66);
    this.scene.add(this.contact.mesh);

    // Everything above outlives zone changes, so record ownership here rather
    // than relying on dispose() listing them by hand. Registration order is
    // creation order; the registry releases in reverse.
    this.gameScope.add(this.renderer, 'other', 'renderer');
    this.gameScope.add(this.post, 'renderTarget', 'post-processing');
    this.gameScope.add(this.env, 'other', 'environment');
    this.gameScope.add(this.portal, 'renderTarget', 'window-portal');
    this.gameScope.add(this.contact, 'geometry', 'contact-shadow');

    // Where the room appears to sit when you look out of it: on the east
    // verge, so the back window frames the road climbing toward the hill.
    const view = new THREE.Vector3(12.5, 0, 30);
    view.y = this.runtime.heightAt(view.x, view.z);
    this.portal.setAnchor(INTERIOR_ORIGIN, view, 0);

    this.village!.onCollect = (def, count, total) => {
      this.hud.setCounter(count, total);
      this.hud.popCounter();
      this.hud.showToast(count >= total ? 'All found' : 'Found', def.found);
      this.audio.playDiscovery();
    };

    this.hud = new HUD(this.settings, this.input, {
      onQuality: (q) => this.applyQuality(q),
      onMuted: (m) => this.audio.setMuted(m),
      onTimeMode: (m) => this.applyTimeMode(m),
      onResetProgress: () => {
        this.village!.collectibles.restoreAll();
        this.hud.setCounter(0, this.village!.collectibles.total);
      },
      onInteract: (down) => this.input.setInteractHeld(down),
      onOutfit: (patch) => {
        // The panel still speaks in colours; Equipment resolves each one back
        // to its catalogue item so the two representations cannot drift.
        for (const slot of ['shirt', 'trousers', 'hat'] as const) {
          const colour = patch[slot];
          if (typeof colour === 'string') this.equipment.equipColour(slot as EquipSlot, colour);
        }
        if (typeof patch.hatOn === 'boolean') this.equipment.setHatOn(patch.hatOn);
        this.player.setOutfit(this.equipment.toOutfit());
        this.hud.syncOutfit(this.player.outfit);
      },
    });
    this.hud.syncOutfit(this.player.outfit);
    this.hud.setCounter(this.village!.collectibles.count, this.village!.collectibles.total);
    // Runs every frame, including while a district is active — a district has
    // no keepsakes, so this must degrade rather than assert.
    this.minimap = new Minimap(this.runtime.mapData, () => this.village?.keepsakeMarkers ?? []);
    // The proving ground, if asked for. Built before the interactables are
    // synced so its collision is in place before anything can drive at it.
    if (featureFlags().testRoad) await this.buildTestRoad();

    // The map reads the world each redraw rather than being handed a
    // snapshot, so a driven vehicle moves on it and a found keepsake greys
    // out without anything having to remember to push an update.
    this.hud.setMapSource(this.runtime.mapData, () => ({
      player: {
        x: this.player.position.x,
        z: this.player.position.z,
        facing: this.player.controller.facing,
      },
      markers: this.mapMarkers(),
    }));

    // Needs the HUD, because the wardrobe handler opens it.
    this.syncInteractables();
    // Somewhere for recovered vehicles to reappear: the verge by the house,
    // clear of the road so a returned car is not dropped into traffic.
    this.garage.setGarage('village_coast', { x: 12.6, y: this.runtime.heightAt(12.6, 28), z: 28, facing: Math.PI / 2 });

    this.gameScope.addTeardown(
      this.saves.onStatus((s) => this.hud.setSaveStatus(s)),
      'subscription',
      'save-status',
    );

    this.post.setEnabled(this.settings.current.quality === 'high');
    this.applyViewport();

    if (assetManager.failures.length) {
      console.warn('[LastHorizon] some packs failed to load:', assetManager.failures);
    }
    // Resume the autosave if there is one. Loaded without an expected mode:
    // there is no mode-selection screen yet, so the save's own mode is
    // adopted. That is resuming, not mixing — the guard matters once the
    // player has actively chosen a mode.
    // Reading a save can migrate it, and the phase rules say life must not
    // advance during a migration. Blocking across the whole read is the simple
    // correct choice: it cannot advance before the game is running anyway, and
    // this keeps the rule true if resume is ever called mid-session.
    this.life.block('saveMigration');
    try {
      const resumed = await this.saves.load('autosave');
      if (resumed.ok) {
        this.applySave(resumed.data);
        this.resumedFromSave = true;
        // Show which mode is being continued, and stop it being changed.
        loading.presetMode(resumed.data.mode, true);
        if (resumed.recoveredFromBackup) {
          this.hud.showToast('Recovered', 'Your last save was damaged; an earlier one was used.');
        } else if (resumed.migratedFrom !== undefined) {
          this.hud.showToast('Updated', 'Your save was brought up to date.');
        }
      }
    } catch (err) {
      // A broken save must never stop the game booting.
      console.warn('[LastHorizon] could not read the autosave', err);
    } finally {
      this.life.unblock('saveMigration');
    }

    // A save written between reaching a birthday and acknowledging it — the
    // crash case — restores with one still armed. Deliver it now rather than
    // leaving the clock permanently blocked on it.
    if (this.life.pendingBirthday !== null) {
      await this.handleBirthday(this.life.pendingBirthday);
    }

    // The village is standing and walkable at this point. Residents, traffic
    // and the navmesh arrive behind it, on their own chunk, so the loading
    // screen ends when the world does rather than when Recast has finished.
    void this.ensurePopulation();

    loading.setProgress(1, 'the afternoon');
    loading.ready();
  }

  /**
   * Called once the player dismisses the loading screen.
   *
   * The chosen mode only applies to a fresh run: a resumed save already has
   * one, and switching it would silently change the rules of a run in
   * progress — story gates applied to a Free Roam save, or the reverse.
   */
  begin(mode: GameMode = 'story', options: FreeRoamOptions = DEFAULT_FREE_ROAM): void {
    if (this.running) return;
    this.running = true;

    if (!this.resumedFromSave) {
      this.mode = mode;
      if (mode === 'freeRoam') this.applyFreeRoamOptions(options);
    }

    this.input.attach(this.canvas);
    this.hud.show();
    this.audio.start();
    this.audio.setMuted(this.settings.current.muted);
    this.applyNeedsSettings();
    this.gameScope.addTeardown(this.settings.onChange(() => this.applyNeedsSettings()));

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', () => this.input.releaseAll());

    this.clock.start();
    this.loop();
  }

  private applyViewport(): void {
    this.renderer.resize();
    const { width, height } = this.renderer.size;
    this.camera.applyViewport(width, height);
    this.post.resize(width, height, this.renderer.renderer.getPixelRatio());
    this.portal.resize(width, height);
  }

  private onResize = (): void => {
    this.applyViewport();
  };

  /** Freeze simulation when hidden; a returning tab must not fast-forward. */
  private onVisibility = (): void => {
    this.paused = document.hidden;
    this.audio.setSuspended(document.hidden);
    // A hidden tab is not active play. Without this the character would age
    // while the game sat in the background, which is the one thing the life
    // mechanic must never do.
    this.life.setBlocked('hidden', document.hidden);
    this.storyClock.setPaused(document.hidden);
    if (!document.hidden) {
      // Discard the elapsed background time so dt stays sane.
      this.clock.getDelta();
    }
  };

  /**
   * Advance all three clocks for one frame.
   *
   * `Environment` remains the day/night presentation authority; `WorldClock`
   * mirrors it so world time has one typed, saveable home. Life and story time
   * are advanced here and gated on whether the player is actually playing.
   */
  private advanceClocks(dt: number): void {
    this.worldClock.jumpTo(this.env.time);

    const settingsOpen = this.hud.infoOpen || this.hud.wardrobeOpen;
    this.life.setBlocked('settings', settingsOpen);
    this.life.setBlocked('loading', this.transitioning);
    this.life.setBlocked('paused', this.paused);
    this.storyClock.setPaused(this.paused || settingsOpen || this.transitioning);

    this.storyClock.advance(dt);

    const tick = this.life.advance(dt);
    if (tick.birthdayReached !== null) void this.handleBirthday(tick.birthdayReached);

    // Needs drain on the life clock's *active* seconds, not on dt: a paused or
    // backgrounded game must not leave the player starving on return, and the
    // two would drift apart the moment a gate blocked one and not the other.
    this.needs.advance(tick.consumed);
    this.player.controller.speedScale = this.needs.modifiers().moveSpeed;

    this.syncAge();
  }

  /**
   * A birthday has been reached.
   *
   * The clock has already paused itself, so nothing ages while this runs and
   * the next birthday cannot race it. Acknowledging is the last step, and is
   * what makes the delivery once-only across a reload.
   */
  /**
   * Apply the Free Roam setup to a fresh run.
   *
   * Age goes through `LifeClock.restore` rather than a setter so it lands in
   * the same validated path a save uses — one way in, one set of clamps.
   */
  private applyFreeRoamOptions(o: FreeRoamOptions): void {
    this.life.restore({
      ageYears: o.startAge,
      yearProgress: 0,
      lastHandledAge: o.startAge,
      rate: o.rate,
      activeSeconds: 0,
    });
    this.freeRoamMoney = o.startMoney;

    // A fresh run starts from a known inventory, not whatever the last one
    // left behind — this path is also reached when restarting from the menu.
    this.inventory.clear();
    if (o.startVehicle !== 'none') this.inventory.add(`keys_${o.startVehicle}`, 1);

    if (o.unlockCity) this.unlockedZones.add('city_old_market');
    this.syncAge();
  }

  /**
   * Publish the current age everywhere it is presented.
   *
   * Proportions are fed the *fractional* age, not the whole year, so the last
   * year of a stage blends into the next and a birthday is not a visible jolt.
   */
  private syncAge(): void {
    this.hud.setAge(this.life.ageYears, this.life.yearProgress);
    this.player.appearance.applyAge(this.life.ageYears + this.life.yearProgress);
  }

  private gateContext(): GateContext {
    return {
      mode: this.mode,
      age: this.life.ageYears,
      completedChapters: this.completedChapters,
      unlockedZones: this.unlockedZones,
    };
  }

  /**
   * Build a save from live state.
   *
   * Records the spawn *id* rather than only a raw position, so a save whose
   * spawn has since been removed can still resolve somewhere safe instead of
   * dropping the player at stale coordinates.
   */
  private captureSave(slot: SaveSlotId): SaveData {
    const p = this.player.position;
    const story = this.storyClock.snapshot();
    return {
      version: 2,
      contentVersion: CONTENT_VERSION,
      savedAt: 0, // stamped by SaveService
      mode: this.mode,
      slot,
      zone: this.zones.activeZoneId ?? 'village_coast',
      spawnId: this.lastSpawnId,
      player: {
        position: { x: p.x, y: p.y, z: p.z },
        facing: this.player.controller.facing,
      },
      life: this.life.snapshot(),
      world: this.worldClock.snapshot(),
      story: {
        chapter: story.chapter,
        chapterSeconds: story.chapterSeconds,
        totalSeconds: story.totalSeconds,
        completedChapters: [...this.completedChapters].sort(),
        quests: {},
      },
      money: this.freeRoamMoney,
      inventory: this.inventory.toJSON(),
      wardrobe: this.equipment.toJSON(),
      vehicles: this.garage.toJSON() as SaveData['vehicles'],
      needs: this.needs.toJSON(),
      relationships: this.relationships.toJSON(),
      // Live ages when a population is loaded, the lifted copy when it is not —
      // between zones, or before the chunk has landed.
      npcs: this.population?.ageSnapshot() ?? this.npcAges,
      collectibles: this.village?.collectibles.foundIds ?? [],
      unlockedZones: [...this.unlockedZones],
    };
  }

  /**
   * Apply a loaded save.
   *
   * Position is resolved through `SpawnRegistry` rather than trusted: if the
   * saved spawn no longer exists the registry degrades to a valid one, and we
   * use that instead of the stale transform. Restoring a raw position into a
   * world that has moved is how a save strands a player.
   */
  private applySave(data: SaveData): void {
    this.mode = data.mode;
    this.life.restore(data.life);
    this.worldClock.restore(data.world);
    this.env.setMode(data.world.mode);
    this.env.jumpTo(data.world.time);
    this.storyClock.restore({
      chapter: data.story.chapter,
      chapterSeconds: data.story.chapterSeconds,
      totalSeconds: data.story.totalSeconds,
      timers: [],
    });

    this.completedChapters.clear();
    for (const c of data.story.completedChapters) this.completedChapters.add(c);
    this.unlockedZones.clear();
    for (const z of data.unlockedZones) this.unlockedZones.add(z);

    this.freeRoamMoney = data.money;
    // Relationships and ages before the population is asked for anything: a
    // resident seeded from the catalogue would otherwise overwrite the history
    // the player actually has with them.
    this.relationships.fromJSON(data.relationships);
    this.npcAges = data.npcs ?? [];
    this.population?.restoreAges(this.npcAges);
    this.village?.collectibles.restoreFound(data.collectibles);
    if (this.village) {
      this.hud.setCounter(this.village.collectibles.count, this.village.collectibles.total);
    }
    this.garage.restore(data.vehicles as unknown as Array<Record<string, unknown>>);
    this.inventory.restore(data.inventory);
    this.needs.restoreFrom(data.needs);
    // Accepts both item ids and the raw hex a pre-migration save holds.
    this.equipment.restore(data.wardrobe);
    this.player.setOutfit(this.equipment.toOutfit());
    this.hud.syncOutfit(this.player.outfit);

    // Only reposition when the save belongs to the zone that is actually
    // built; a save from another zone needs travel, which is a separate step.
    if (data.zone === this.zones.activeZoneId) {
      const resolved = this.zones.spawns.resolve({ zoneId: data.zone, spawnId: data.spawnId });
      if (resolved.ok && resolved.fallback) {
        const y = this.runtime.heightAt(resolved.spawn.x, resolved.spawn.z);
        this.player.setSpawn(
          new THREE.Vector3(resolved.spawn.x, y + 0.05, resolved.spawn.z),
          resolved.spawn.facing,
        );
        this.lastSpawnId = resolved.spawn.id;
        this.hud.showToast('Moved', 'Your last spot is gone; you are nearby.');
      } else {
        const pos = data.player.position;
        this.player.setSpawn(new THREE.Vector3(pos.x, pos.y, pos.z), data.player.facing);
        this.lastSpawnId = data.spawnId;
      }
      this.camera.resetBehind(this.player.lookTarget, this.player.controller.facing);
    }

    this.syncAge();
  }

  private lifeSnapshot(): LifeSnapshot {
    return {
      ageYears: this.life.ageYears,
      yearProgress: this.life.yearProgress,
      pendingBirthday: this.life.pendingBirthday,
      blocked: this.life.blockReasons,
      rate: this.life.rate,
    };
  }

  private async handleBirthday(age: number): Promise<void> {
    if (this.handlingBirthday) return;
    this.handlingBirthday = true;
    try {
      // Loop rather than handle one: acknowledging can immediately deliver
      // the next birthday from carried overflow, and a re-entrant call would
      // hit the guard above and be dropped silently.
      let current = age;
      for (;;) {
        await this.deliverBirthday(current);
        const next = this.life.pendingBirthday;
        if (next === null) break;
        current = next;
      }
    } finally {
      this.handlingBirthday = false;
    }
  }

  /** One birthday: announce, autosave while the clock is stopped, age up. */
  private async deliverBirthday(age: number): Promise<void> {
    this.hud.showToast('Another year', `You are ${age} today.`);

    // A year passes for the named residents too. Ambient pedestrians are
    // deliberately left alone: they are pooled strangers with no identity to
    // age, and remodelling forty bodies for a birthday nobody would notice is
    // precisely the cost the two-tier population exists to avoid.
    this.population?.advanceYear();
    this.npcAges = this.population?.ageSnapshot() ?? this.npcAges.map((n) => ({ ...n, age: n.age + 1 }));

    // Appearance stage and age-gated story checks attach here as those
    // systems land.
    await wait(60);

    // Acknowledge *before* saving. Saving first records the pre-birthday
    // state — age N, sitting on the boundary — so a reload re-arms and
    // re-fires the same birthday, which is the duplicate event the phase
    // rules forbid. Acknowledging first also fails in the safe direction: a
    // crash between the two re-fires the birthday rather than skipping it.
    this.life.acknowledgeBirthday();

    // The clock is still stopped if the carried overflow reached another
    // boundary, so this remains a safe moment to write.
    const result = await this.saves.save('autosave', this.captureSave('autosave'));
    if (!result.ok) {
      console.warn('[LastHorizon] birthday autosave failed', result.reason);
      this.hud.showToast('Could not save', 'Your progress is still here, but not written.');
    }
  }

  private applyQuality(q: QualityLevel): void {
    const preset = this.settings.preset;
    void q;
    this.renderer.applyQuality(preset);
    this.env.applyQuality(preset);
    this.runtime.applyQuality(preset);
    this.population?.setBudget(this.populationBudget());
    this.post.setEnabled(this.settings.current.quality === 'high');
    this.portal.setQuality(preset.antialias ? 0.5 : 0.34);
    this.applyViewport();
  }

  private applyTimeMode(m: TimeMode): void {
    this.env.setMode(m);
  }

  private loop = (): void => {
    this.frameHandle = requestAnimationFrame(this.loop);
    if (!this.running) return;

    const raw = this.clock.getDelta();
    if (this.paused) return;

    // Clamp so a stall (tab switch, GC pause) can't teleport the character
    // through a wall on the next frame.
    const dt = clamp(raw, 0, MAX_FRAME_DT);
    this.elapsed += dt;
    this.update(dt);
    this.render();

    this.fpsAccum += raw;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      if (DEBUG) this.reportDebug();
    }
  };

  /**
   * Dev-only: advance and draw exactly one fixed step, independent of
   * requestAnimationFrame. Used to capture deterministic frames when rAF is
   * throttled (background windows, automated screenshots).
   */
  stepOnce(dt = 1 / 60, steps = 1): void {
    if (!this.running) this.begin();
    for (let i = 0; i < steps; i++) {
      this.elapsed += dt;
      this.update(dt);
    }
    this.render();
  }

  /** Dev-only: jump the camera/character somewhere for a framing check. */
  placeCamera(yaw: number, pitch: number, distance: number): void {
    this.camera.yaw = yaw;
    this.camera.pitch = pitch;
    this.camera.setDistance(distance);
  }

  get debugPlayer(): Player {
    return this.player;
  }

  /**
   * Move the player to another zone.
   *
   * `TravelService` guarantees the destination is built and has a valid spawn
   * before the source is released, so a failure here means nothing moved and
   * nothing was torn down. Everything that pointed at the old zone is rebound
   * afterwards, because `this.runtime` has changed underneath them.
   */
  async travelTo(to: ZoneId): Promise<boolean> {
    const from = this.zones.activeZoneId;
    if (!from || from === to || this.transitioning) return false;

    // The narrative gate, ahead of the mechanism. TravelService knows about
    // routes and spawns; whether the player is *allowed* to go lives in Gates.
    const verdict = canEnterZone(to, this.gateContext());
    if (!verdict.allowed) {
      this.hud.showToast('Not yet', verdict.reason ?? 'You cannot go there yet.');
      return false;
    }

    this.transitioning = true;
    this.input.releaseAll();
    // Before the zone is released, not after: the population owns crowd agents
    // and a navmesh inside WASM memory, which the JavaScript collector cannot
    // reach, and it holds Three objects parented to the group the zone scope is
    // about to tear down.
    this.disposePopulation();
    try {
      const result = await this.zones.travel.travel({ to, context: { fromZone: from } });

      if (!result.ok) {
        this.hud.showToast('Not that way', result.message);
        // Nothing moved, so put the population back. Without this a refused
        // journey empties the zone the player is standing in and never
        // refills it.
        void this.ensurePopulation();
        return false;
      }

      // Land on the resolved spawn, which may differ from the requested one if
      // it was unavailable or unsafe.
      const { spawn } = result;
      this.lastSpawnId = spawn.id;
      this.unlockedZones.add(to);
      const y = this.runtime.heightAt(spawn.x, spawn.z);
      this.player.setLying(false);
      this.player.setSitting(false);
      this.player.setSpawn(new THREE.Vector3(spawn.x, y + 0.05, spawn.z), spawn.facing);
      this.camera.resetBehind(this.player.lookTarget, spawn.facing);
      this.camera.setMinDistance(3.0);
      this.camera.setDistance(6.4);

      // The radar captured its roads at construction; without this it keeps
      // drawing the village after travelling.
      this.minimap.setData(this.runtime.mapData);
      this.hud.setMapData(this.runtime.mapData);

      // Leaving a zone leaves these pointing at content that no longer exists.
      this.indoors = false;
      this.sleeping = false;
      this.syncInteractables();
      this.hud.setPrompt(null);
      this.player.controller.boundsEnabled = true;
      this.audio.setZone('outdoor');

      const zone = this.zones.activeZone;
      if (zone) this.hud.showToast('Arrived', zone.displayName);
      // Stream the first rings before handing control back, so the player does
      // not spawn into an empty district.
      await this.zones.update(spawn.x, spawn.z);
      // Populate the new zone. Not awaited: arriving should not wait on a
      // navmesh bake, and residents walking in a beat later is invisible next
      // to the fade that just finished.
      void this.ensurePopulation();
      this.stepQuiet();
      return true;
    } finally {
      this.transitioning = false;
    }
  }

  /**
   * The only surface the `?e2e=1` test bridge is given. Deliberately a fixed
   * set of operations rather than a handle to the scene graph, so test mode
   * cannot grow into a general back door. Built here because the operations it
   * forwards to are private.
   */
  testSurface(): TestSurface {
    return {
      setTimeMode: (mode) => this.applyTimeMode(mode),
      jumpToTime: (t) => this.env.jumpTo(t),
      getTime: () => this.env.time,
      teleport: (x, y, z, facing) => {
        this.player.motor.teleport(x, y, z);
        this.player.controller.facing = facing;
      },
      groundAt: (x, z) => this.runtime.heightAt(x, z),
      frameCamera: (facing, distance, pitch) => {
        this.camera.resetBehind(this.player.lookTarget, facing);
        this.camera.setDistance(distance);
        if (pitch !== undefined) this.camera.pitch = pitch;
      },
      step: (dt) => {
        this.update(dt);
        this.render();
      },
      enterInterior: () => this.enterInterior(),
      exitInterior: () => this.exitInterior(),
      sit: (on) => this.sit(on),
      setLying: (on) => this.player.setLying(on),
      openWardrobe: (open) => this.hud.openWardrobe(open),
      isIndoors: () => this.indoors,
      isRunning: () => this.running,
      playerPosition: () => this.player.position,
      playerFacing: () => this.player.controller.facing,
      playerState: () => this.player.state,
      playerSpeed: () => this.player.speed,
      isSitting: () => this.player.isSitting,
      isLying: () => this.player.isLying,
      renderStats: () => {
        const i = this.renderer.renderer.info;
        return {
          drawCalls: i.render.calls,
          triangles: i.render.triangles,
          geometries: i.memory.geometries,
          textures: i.memory.textures,
          programs: i.programs?.length ?? 0,
        };
      },
      collectedCount: () => this.village?.collectibles.count ?? 0,
      // The bridge deals in plain strings; TravelService rejects an unknown
      // zone at runtime ("there is no route to ..."), so this cannot smuggle
      // an invalid id past validation.
      travelTo: (id) => this.travelTo(id as ZoneId),
      activeZoneId: () => this.zones.activeZoneId,
      zoneDebug: () => this.zones.debugState(),
      releaseInput: () => this.input.releaseAll(),
      // Awaited rather than fire-and-forget: a caller that immediately asks
      // for another birthday would otherwise hit the in-progress guard and
      // have it silently dropped.
      advanceLife: async (seconds) => {
        const tick = this.life.advance(seconds);
        // Same consequence as a frame's worth of active time, or the bridge
        // would report seconds passing with the needs untouched.
        this.needs.advance(tick.consumed);
        if (tick.birthdayReached !== null) await this.handleBirthday(tick.birthdayReached);
        return this.lifeSnapshot();
      },
      forceBirthday: async () => {
        const reached = this.life.forceBirthday();
        if (reached !== null) await this.handleBirthday(reached);
        return this.lifeSnapshot();
      },
      lifeState: () => this.lifeSnapshot(),
      interactionState: () => {
        const s = this.lastInteraction;
        return {
          prompt: s?.prompt ?? null,
          actionId: s?.primary?.action.id ?? null,
          candidates: s ? s.candidates.map((c) => c.action.id) : [],
          needsSelector: s?.needsSelector ?? false,
          holdProgress: s?.holdProgress ?? 0,
        };
      },
      pressInteract: (held: boolean) => this.input.setInteractHeld(held),
      needsState: () => this.needs.toJSON(),
      appearanceState: () => this.player.appearance.snapshot(),
      playGesture: (name: string) => this.player.playGesture(name),
      spawnVehicle: (kind, x, z, facing, atY) =>
        this.spawnVehicle(kind as VehicleId, x, z, facing, atY),
      setVehicleInput: (id, input) => this.setVehicleInput(id, input),
      vehicleTelemetry: (id) => {
        const v = this.vehicles.get(id);
        if (!v) return null;
        const t = v.telemetry;
        const pos = v.position(new THREE.Vector3());
        return {
          ...t,
          x: pos.x, y: pos.y, z: pos.z,
          heading: v.headingYaw(),
          recoveries: this.physics?.recoveriesOf(v.bodyId) ?? 0,
        };
      },
      resetVehicle: (id, x, y, z, facing) =>
        this.vehicles.get(id)?.resetTo(new THREE.Vector3(x, y, z), facing),
      despawnVehicle: (id) => this.despawnVehicle(id),
      enterVehicle: (id, seatId) => this.enterVehicle(id, seatId),
      exitVehicle: () => this.exitVehicle(),
      ridingVehicle: () => this.ridingVehicleId,
      setVehicleLocked: (id, locked) => this.setVehicleLocked(id, locked),
      giveItem: (id, count) => this.inventory.add(id, count).added > 0,
      recoverVehicle: (id) => this.recoverVehicle(id),
      rollVehicle: (id) => {
        this.vehicles.get(id)?.rollOver();
      },
      pressFlip: () => this.input.queueFlip(),
      testRoadMark: (name: string) => this.testRoadMark(name),
      vehicleRecord: (id) => {
        const r = this.garage.get(id);
        return r ? { ...r, transform: { ...r.transform } } : null;
      },
      setFuelEnabled: (on) => {
        this.fuelEnabled = on;
      },
      initPhysics: async () => {
        await this.ensurePhysics();
        return this.physicsSnapshot();
      },
      physicsState: () => this.physicsSnapshot(),
      gestureState: () => ({
        playing: this.player.gesture,
        weight: this.player.animator?.overlayWeight ?? 0,
      }),
      inventoryState: () => this.inventory.toJSON(),
      completeChapter: (id) => {
        this.completedChapters.add(id);
      },
      saveNow: async (slot) => {
        const parsed = SaveService.parseSlot(slot);
        if (!parsed) return false;
        return (await this.saves.save(parsed, this.captureSave(parsed))).ok;
      },
      loadNow: async (slot) => {
        const parsed = SaveService.parseSlot(slot);
        if (!parsed) return false;
        const read = await this.saves.load(parsed);
        if (!read.ok) return false;
        this.applySave(read.data);
        return true;
      },

      awaitPopulation: async () => {
        // Already here is the common case and must not trigger a rebuild:
        // `disposePopulation` clears the in-flight promise, so falling through
        // to `ensurePopulation` would tear down a live population to make an
        // identical one.
        if (!this.population) await (this.populationLoading ?? this.ensurePopulation());
        return this.population?.stats ?? EMPTY_POPULATION;
      },
      populationState: () => this.population?.stats ?? null,
      npcList: () => this.npcSnapshots(),
      npcState: (id) => this.npcSnapshots().find((n) => n.id === id) ?? null,
      npcSendTo: (id, x, z) => {
        const agent = this.population?.namedById(id);
        if (!agent) return false;
        // A quest override rather than a bare destination, so the next
        // schedule tick does not immediately send them home again — which is
        // exactly what a quest needs too.
        agent.questOverride = { kind: 'quest', place: { x, y: this.runtime.heightAt(x, z), z } };
        agent.setDestination(x, z);
        return true;
      },
      npcApplyHour: (hour) => {
        // Pin the world clock as well as pushing the schedules. Without this
        // the far tick re-reads the real time half a second later and undoes
        // it, which is a footgun rather than an operation.
        this.applyTimeMode('day');
        this.env.jumpTo((((hour % 24) + 24) % 24) / 24);
        this.worldClock.jumpTo(this.env.time);
        for (const n of this.population?.namedList() ?? []) n.applySchedule(hour);
      },
      relationship: (id) => (this.relationships.has(id) ? this.relationships.get(id) : null),
      emitPerception: (kind, x, y, z) => {
        this.population?.emit(
          kind as PerceptionKind,
          new THREE.Vector3(x, y, z),
          'player',
        );
      },
      trafficList: () => this.population?.trafficPositions() ?? [],
      populationActive: (on) => this.population?.setActive(on),
    };
  }

  private npcSnapshots(): NpcSnapshot[] {
    return (this.population?.namedList() ?? []).map((a) => ({
      id: a.id,
      name: a.definition?.displayName ?? a.id,
      age: a.age,
      band: a.band,
      activity: a.activity,
      indoors: a.indoors,
      reaction: a.reaction,
      x: a.position.x,
      y: a.position.y,
      z: a.position.z,
      speed: a.movingSpeed,
      targetX: a.target?.x ?? null,
      targetZ: a.target?.z ?? null,
    }));
  }

  private update(dt: number): void {
    const uiBlocking =
      this.hud.infoOpen || this.hud.wardrobeOpen || this.sleeping || this.transitioning;
    if (uiBlocking) this.input.releaseAll();

    // Before anything reads input: the Gamepad API is polled, not evented, so
    // a pad that is never asked reports nothing at all.
    this.input.pollGamepad(dt);

    this.advanceClocks(dt);

    // 0. driving, before the character: while seated, the player's own
    //    controller must not also be reading the stick.
    this.updateRiding();

    // 1. character
    this.camForward.copy(this.camera.forward);
    this.camRight.copy(this.camera.right);
    const wasAir = !this.player.motor.grounded;
    this.player.update(dt, this.runtime.collision, this.camForward, this.camRight,
                       this.runtime.inBounds);

    if (this.player.controller.jumpedThisFrame) this.audio.playJump();
    if (this.player.motor.justLanded && wasAir) {
      this.audio.playLand(this.player.motor.lastImpactSpeed);
    }
    if (this.player.controller.respawnedThisFrame) {
      this.camera.resetBehind(this.player.lookTarget, this.player.controller.facing);
      this.hud.showToast('Back on the road', 'You wandered a little too far.');
    }

    // 2. camera (reads the already-resolved player position)
    const camTarget = this.riding ? this.vehicleCameraTarget() : this.player.lookTarget;
    this.camera.update(dt, camTarget, this.input, this.runtime.collision, this.scene);

    // 3. atmosphere
    this.env.update(dt, this.elapsed, this.player.position, this.camera.camera.position);
    const windStrength = 0.85 + Math.sin(this.elapsed * 0.17) * 0.35;
    updateToonTime(this.elapsed, windStrength);
    setToonPlayer(this.player.position);

    // 4. world
    this.runtime.update(
      dt,
      this.elapsed,
      this.player.position,
      this.camera.camera.position,
      this.env.lampFactor,
    );

    // 5. contact shadow, dimmed as the sun goes down
    const groundY = this.player.motor.grounded
      ? this.player.position.y
      : this.runtime.collision.groundBelow(
          this.player.position.x,
          this.player.position.y + 0.4,
          this.player.position.z,
          4.5,
        );
    this.contact.update(
      this.player.position,
      this.player.motor.groundNormal,
      groundY,
      this.player.motor.airTime,
      0.35 + this.env.dayFactor * 0.65,
    );

    // 5b. the map, if it is open
    if (this.input.consumeMap()) this.hud.toggleMap();
    this.hud.updateMap();

    // 6. radar — hidden indoors, where it has nothing useful to show
    this.minimap.setVisible(!this.indoors);
    if (!this.indoors) {
      this.minimap.update(dt, this.player.position, this.player.controller.facing);
    }

    // 7. interactables
    this.updateInteraction(dt);

    // 8. physics, on its own fixed step
    this.stepPhysics(dt);

    // 9. the population, after physics so traffic sees where the player's
    //    vehicle actually ended up this step rather than where it started
    this.updatePopulation(dt);

    // 10. audio
    this.updateAudio(dt);
  }

  private updatePopulation(dt: number): void {
    const population = this.population;
    if (!population) return;

    // The player's own vehicle is an obstacle to traffic, not a participant:
    // it is a Rapier body with a driver, and the lane graph has no opinion
    // about it beyond "do not drive into that".
    const obstacles: Array<{ x: number; z: number; radius: number }> = [];
    for (const proxy of this.vehicleProxies.values()) {
      obstacles.push({ x: proxy.position.x, z: proxy.position.z, radius: 2.4 });
    }
    if (!this.riding && !this.indoors) {
      obstacles.push({ x: this.player.position.x, z: this.player.position.z, radius: 0.8 });
    }

    population.update(
      dt,
      this.worldClock.time,
      { position: this.player.position, facing: this.player.controller.facing },
      obstacles,
    );
    this.announcePlayer(dt);
  }

  // ------------------------------------------------------------ population

  private populationBudget(): PopulationBudget {
    return POPULATION_BUDGETS[this.settings.current.quality];
  }

  /**
   * Populate the active zone.
   *
   * Not awaited by `start`. The loading screen ends when the world is ready to
   * walk around in; residents and traffic arrive a moment later, which is both
   * honest about what the download costs and invisible in practice, because the
   * player is still reading the "Begin" button.
   *
   * Called again on every zone change. The old population is disposed first —
   * it owns crowd agents inside WASM memory, which the JavaScript collector
   * cannot reach.
   */
  private ensurePopulation(): Promise<void> {
    const zone = this.zones.activeZoneId;
    if (!zone) return Promise.resolve();

    const manifest = WORLD_MANIFEST.zones.find((z) => z.id === zone);
    if (!manifest) return Promise.resolve();

    // Defensive: every caller is supposed to have disposed first, and a second
    // population would leak a navmesh and a crowd into WASM memory where
    // nothing can collect them.
    this.disposePopulation();

    this.populationLoading = import('../npc/Population')
      .then(({ Population: Ctor }) => {
        // The zone may have changed again while the chunk was in flight.
        if (this.zones.activeZoneId !== zone) return;

        const group = this.village ? this.village.group : this.zoneGroup;
        if (!group) return;

        const population = new Ctor(
          {
            zone: manifest,
            group,
            collision: this.runtime.collision,
            relationships: this.relationships,
            rig: { scene: this.playerRig, clips: this.playerClips },
            vehicleModels: this.vehicleModels,
            heightAt: (x, z) => this.runtime.heightAt(x, z),
            extraCentrelines: this.villageCentrelines(),
          },
          this.populationBudget(),
          manifest.seed,
          this.worldClock.time,
        );
        this.population = population;
        population.restoreAges(this.npcAges);
        // Residents are interactable from the moment they exist, not from when
        // the navmesh lands.
        this.registerNpcInteractables();
        return population.buildNavigation();
      })
      .catch((err: unknown) => {
        // A population that cannot load must not stop the game. The village
        // simply stays empty, and the debug overlay says so.
        console.warn('[LastHorizon] population unavailable', err);
      });

    return this.populationLoading;
  }

  private disposePopulation(): void {
    if (!this.population) return;
    // Ages are the one thing that cannot be recomputed, so they are lifted out
    // before the population goes.
    this.npcAges = this.population.ageSnapshot();
    // The "talk to" offers hold a reference to an agent that is about to stop
    // existing. Left registered, the prompt goes on appearing at the last
    // place the resident stood.
    for (const agent of this.population.namedList()) {
      this.interactions.unregister(`npc:${agent.id}`);
    }
    this.population.dispose();
    this.population = null;
    this.populationLoading = null;
  }

  /**
   * The village road, as traffic centrelines.
   *
   * A district describes its roads in the manifest as a handful of nodes; the
   * village's road is a 260-point spline built by `RoadNetwork`, and there is
   * no sensible way to write that down as manifest data. Thinning it to every
   * eighth point gives a lane graph that follows the actual tarmac, curves and
   * elevation included.
   */
  private villageCentrelines() {
    const world = this.village;
    if (!world) return undefined;
    const toPoints = (pts: readonly THREE.Vector3[]) =>
      pts.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    return [
      { id: 'village_main', points: thin(toPoints(world.road.main.pts), 8), speedLimit: 12 },
      { id: 'village_side', points: thin(toPoints(world.road.side.pts), 8), speedLimit: 10 },
    ];
  }

  /**
   * Let anyone nearby notice the player.
   *
   * A periodic low-loudness `greeting` rather than a per-frame proximity test:
   * the perception layer already does distance, facing and occlusion properly,
   * and emitting into it means a resident behind a wall does not turn round and
   * wave at masonry.
   */
  private announcePlayer(dt: number): void {
    const population = this.population;
    if (!population || this.indoors) return;

    this.greetTimer += dt;
    if (this.greetTimer < 1.5) return;
    this.greetTimer = 0;

    if (this.riding) {
      // Driving fast past people is a thing they notice, and it is the first
      // event Phase 9's police system will care about.
      const speed = Math.abs(this.ridingTelemetry()?.forwardSpeed ?? 0);
      if (speed > 12) {
        population.emit('dangerous_driving', this.player.position, 'player', {
          severity: Math.min(1, speed / 24),
        });
      }
      return;
    }

    population.emit('greeting', this.player.position, 'player');

    for (const bark of population.pendingBarks.splice(0)) {
      this.hud.showToast(bark.name, bark.line);
    }
  }

  private ridingTelemetry() {
    if (!this.riding) return null;
    return this.vehicles.get(this.riding.id)?.telemetry ?? null;
  }

  /**
   * Bring Rapier up, once, and hand it the zone's collision geometry.
   *
   * Shares one in-flight promise so two vehicles asking at the same moment do
   * not each download the module.
   */
  async ensurePhysics(): Promise<PhysicsWorld> {
    if (this.physics) return this.physics;
    this.physicsLoading ??= PhysicsWorld.create(this.physicsClock.stepSeconds).then((w) => {
      this.physics = w;
      this.syncPhysicsGeometry();
      this.physicsClock.reset();
      return w;
    });
    return this.physicsLoading;
  }

  /**
   * Rebuild the static world for physics from the same merged proxy geometry
   * the BVH uses, so both agree about what is solid. Called on zone change.
   */
  private syncPhysicsGeometry(): void {
    const geometry = this.runtime.collision.collider?.geometry;
    if (this.physics && geometry) this.physics.setStaticGeometry(geometry);
  }

  private physicsSnapshot() {
    const s = this.physics?.stats;
    return {
      loaded: this.physics !== null,
      bodies: s?.bodies ?? 0,
      colliders: s?.colliders ?? 0,
      steps: s?.steps ?? 0,
      recoveries: s?.recoveries ?? 0,
      alpha: this.physicsAlpha,
      hasWorld: this.physics?.hasStaticGeometry ?? false,
    };
  }

  private stepPhysics(dt: number): void {
    if (!this.physics) return;
    this.physicsClock.setPaused(this.paused || this.transitioning);
    const tick = this.physicsClock.advance(dt);
    for (let i = 0; i < tick.steps; i++) {
      // Controllers first: the forces they set have to be the ones this step
      // integrates, not the next one.
      for (const v of this.vehicles.values()) v.update(tick.dt);
      this.physics.step();
    }
    this.physicsAlpha = tick.alpha;
    this.syncVehicleProxies();
    if (tick.steps > 0) this.updateVehicleUpkeep(tick.steps * tick.dt);
  }

  /**
   * Fuel, damage and where each vehicle is, once per batch of physics steps.
   *
   * Impacts are noticed as a sudden drop in speed rather than by subscribing
   * to contact events: the drop is what damage is a function of anyway, and it
   * costs one subtraction per vehicle instead of a collision callback.
   */
  private updateVehicleUpkeep(dt: number): void {
    for (const [id, controller] of this.vehicles) {
      const t = controller.telemetry;
      const speed = Math.abs(t.forwardSpeed);

      const previous = this.lastSpeed.get(id) ?? speed;
      const lost = previous - speed;
      // Braking sheds speed too, so only a drop far faster than the brakes can
      // manage counts as hitting something.
      if (lost > 4 && dt > 0 && lost / dt > 40) this.garage.damage(id, lost);
      this.lastSpeed.set(id, speed);

      const travelled = (this.odometer.get(id) ?? 0) + speed * dt;
      if (travelled > 25) {
        this.odometer.set(id, 0);
        this.garage.consumeFuel(id, travelled, this.fuelEnabled);
      } else {
        this.odometer.set(id, travelled);
      }

      const record = this.garage.get(id);
      if (record) {
        controller.setCondition(record.condition);
        const at = controller.position(this.seatPos);
        this.garage.park(id, this.zones.activeZoneId ?? record.zone, {
          x: at.x, y: at.y, z: at.z, facing: controller.headingYaw(),
        });
      }
    }
  }

  /**
   * Set a vehicle back on its wheels in place.
   *
   * Distinct from `recoverVehicle`, which returns it to the garage. Rolling a
   * car onto its roof in a field is the common case and the player almost
   * always wants to carry on from there rather than be sent home.
   */
  rightVehicle(id: string): boolean {
    const controller = this.vehicles.get(id);
    if (!controller) return false;
    controller.rightItself();
    return true;
  }

  /**
   * Put a vehicle back somewhere sensible.
   *
   * One path for flipped, submerged, out of bounds, impounded or simply lost,
   * because from the player's side they are the same problem: the thing they
   * own is somewhere they cannot use it.
   */
  recoverVehicle(id: string): boolean {
    const record = this.garage.get(id);
    if (!record) return false;
    const controller = this.vehicles.get(id);

    const reason = controller
      ? this.garage.needsRecovery(
          id,
          {
            upright: controller.telemetry.upright,
            y: controller.position(this.seatPos).y,
            inBounds: this.runtime.inBounds(controller.position(this.seatPos).x, this.seatPos.z),
          },
          -2,
        ) ?? 'lost'
      : 'lost';

    const moved = this.garage.recover(id, reason, this.zones.activeZoneId ?? record.zone);
    if (!moved) return false;

    if (this.riding?.id === id) void this.exitVehicle();
    controller?.resetTo(
      new THREE.Vector3(moved.transform.x, moved.transform.y + 0.4, moved.transform.z),
      moved.transform.facing,
    );
    this.hud.showToast('Recovered', `Returned to the garage (${reason})`);
    return true;
  }

  /** Draw each vehicle at its interpolated transform. */
  private syncVehicleProxies(): void {
    for (const [id, controller] of this.vehicles) {
      const mesh = this.vehicleProxies.get(id);
      if (!mesh) continue;
      controller.sample(this.physicsAlpha, mesh.position, mesh.quaternion);
    }
  }

  /**
   * Put a vehicle in the world.
   *
   * Drops it on the ground at `x, z` with a little clearance so the suspension
   * settles rather than starting compressed through the road.
   */
  async spawnVehicle(
    kind: VehicleId,
    x: number,
    z: number,
    facing = 0,
    atY?: number,
  ): Promise<string | null> {
    const [{ vehicleDef }, { VehicleController: Controller }, controls, access, dynamics, physics] =
      await Promise.all([
        import('../vehicles/VehicleDefinition'),
        import('../vehicles/VehicleController'),
        import('../vehicles/VehicleControls'),
        import('../vehicles/VehicleAccess'),
        import('../vehicles/VehicleDynamics'),
        this.ensurePhysics(),
      ]);
    this.vehicleApi = { controls, access, dynamics };
    // The registry deliberately does not import the catalogue, so hand it the
    // few rules it needs now that the catalogue is actually here. This also
    // prunes any saved vehicle whose kind no longer exists.
    this.garage.setRules((k) => {
      const d = vehicleDef(k as VehicleId);
      if (!d) return null;
      return {
        fuelCapacity: d.fuel?.capacity ?? null,
        consumptionPerKm: d.fuel?.consumptionPerKm ?? 0,
        scratchSpeed: d.damage.scratchSpeed,
        dentSpeed: d.damage.dentSpeed,
        repairCost: d.damage.repairCost,
        impoundable: d.ownership.impoundable,
      };
    });

    const def = vehicleDef(kind);
    if (!def) return null;
    // An explicit height wins outright. Probing is right for ordinary spawns,
    // but the proving ground knows exactly how high its own tarmac is and
    // should not have to hope a downward ray agrees.
    const terrain = this.runtime.heightAt(x, z);
    const ground = atY ?? Math.max(
      terrain,
      this.runtime.collision.groundBelow(x, terrain + 80, z, 160) ?? terrain,
    );
    const y = ground + def.dimensions.y * 0.5 + 0.15;
    const at = new THREE.Vector3(x, y, z);

    const id = `${kind}_${this.nextVehicleSerial++}`;
    const controller = new Controller(physics, def, at, facing);
    this.vehicles.set(id, controller);

    const visual = this.buildVehicleVisual(def, id);
    this.scene.add(visual);
    this.vehicleProxies.set(id, visual);
    this.registerVehicleInteractable(id);
    this.garage.register({
      id,
      kind,
      zone: this.zones.activeZoneId ?? 'village_coast',
      transform: { x: at.x, y: at.y, z: at.z, facing },
      owned: def.ownership.ownable,
      locked: false,
      impounded: false,
    });

    return id;
  }

  /**
   * The mesh that follows a vehicle body.
   *
   * Falls back to a plain box if the model is missing, so a failed asset load
   * leaves something visible to drive rather than an invisible car — the
   * physics would be working and nothing would look wrong except the screen.
   */
  private buildVehicleVisual(
    def: { model: string; dimensions: { x: number; y: number; z: number }; colourVariants: readonly string[] },
    id: string,
  ): THREE.Object3D {
    const proto = this.vehicleModels.get(def.model);
    if (!proto) {
      const d = def.dimensions;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(d.x, d.y, d.z),
        new THREE.MeshToonMaterial({ color: 0xc94f3d }),
      );
      box.name = `vehicle:${id}`;
      return box;
    }

    const obj = proto.clone(true);
    obj.name = `vehicle:${id}`;

    // Colour variants are a material parameter, not a mesh: every body shares
    // `vehicle_paint` and only the tint differs.
    const variant = def.colourVariants[0];
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const source = mesh.material as THREE.Material;
      const converted = toonFromImported(source, `vehicle_${def.model}`);
      if (variant && source.name === 'vehicle_paint') {
        const tinted = converted.clone() as THREE.MeshToonMaterial;
        tinted.color = new THREE.Color(variant);
        mesh.material = tinted;
      } else {
        mesh.material = converted;
      }
    });
    return obj;
  }

  vehicle(id: string): VehicleController | null {
    return this.vehicles.get(id) ?? null;
  }

  setVehicleInput(id: string, input: Partial<VehicleInput>): void {
    this.vehicles.get(id)?.setInput(input);
  }

  despawnVehicle(id: string): void {
    if (this.riding?.id === id) void this.exitVehicle();
    this.interactions.unregister(`vehicle:${id}`);
    this.vehicles.get(id)?.dispose();
    this.vehicles.delete(id);
    this.lockedVehicles.delete(id);
    const visual = this.vehicleProxies.get(id);
    if (visual) {
      this.scene.remove(visual);
      visual.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      });
      this.vehicleProxies.delete(id);
    }
  }

  /**
   * Re-register what the player can interact with.
   *
   * Called whenever the set changes — construction and zone travel. The system
   * holds no reference to the previous zone's content afterwards, which is what
   * stops a stale door from being offered in the city.
   */
  private syncInteractables(): void {
    this.interactions.clear();
    for (const it of worldInteractables(this.runtime.interactables, this.interactionHandlers)) {
      this.interactions.register(it);
    }
    for (const id of this.vehicles.keys()) this.registerVehicleInteractable(id);
    this.registerNpcInteractables();
  }

  /**
   * Offer "talk to" beside each named resident.
   *
   * Same pattern as the vehicles: `position()` is read per frame, so a resident
   * walking to work stays interactable without anything having to notice they
   * moved. `isAvailable` closes the offer while they are indoors, which is what
   * stops a prompt appearing on a doorstep with nobody behind it.
   */
  private registerNpcInteractables(): void {
    for (const agent of this.population?.namedList() ?? []) {
      const def = agent.definition;
      if (!def) continue;
      this.interactions.register({
        id: `npc:${agent.id}`,
        position: () => agent.position,
        actions: [
          {
            id: `npc:${agent.id}:talk`,
            label: `Talk to ${def.displayName.split(' ')[0]}`,
            // Below a door's 30, deliberately. Every village building is
            // enterable, so a resident standing near their own front door
            // competes with it, and somebody walking up to a door came for the
            // door. Both stay on offer through the selector.
            priority: 25,
            maxDistance: 2.4,
            facingTolerance: Math.PI * 0.6,
            holdSeconds: 0,
            isAvailable: () => !agent.indoors && this.riding === null,
            execute: () => this.talkTo(agent.id),
          },
        ],
      });
    }
  }

  /**
   * One exchange with a named resident.
   *
   * The dialogue *data* is fully exercised here — the tree is walked, choice
   * conditions are evaluated against the live relationship and the player's
   * age, and the chosen branch's relationship effects are applied. What is
   * deliberately absent is the choice UI: a panel with portraits and history
   * belongs to Phase 11, and inventing a throwaway one now would be a screen to
   * delete rather than a screen to build on. Until then the first available
   * choice is taken and the outcome is reported as a toast.
   */
  private talkTo(npcId: string): void {
    const agent = this.population?.namedById(npcId);
    const def = agent?.definition;
    if (!agent || !def) return;

    agent.react('greet', this.player.position);

    const ctx = {
      relationship: this.relationships.get(npcId),
      playerAge: this.life.ageYears,
    };
    const root = SMALL_TALK.nodes[SMALL_TALK.root];
    const choice = availableChoices(root, ctx)[0];
    if (choice?.effects) this.relationships.adjust(npcId, choice.effects);
    this.relationships.greet(npcId);

    const next = choice?.to ? SMALL_TALK.nodes[choice.to] : null;
    if (next?.effects) this.relationships.adjust(npcId, next.effects);

    const line =
      pickBark(def.barkSet, this.env.dayFactor > 0.25 ? 'greet' : 'night', Math.floor(this.env.time * 24)) ??
      next?.text ??
      '…';
    this.hud.showToast(def.displayName, line);
  }

  /**
   * Offer "get in" near a vehicle.
   *
   * Registered with the same `InteractionSystem` as the doors and the bed, so
   * a car parked by the front door goes through the selector rather than
   * competing with it. `position()` is read per frame, which is what makes a
   * *moving* vehicle work without any special handling.
   */
  private registerVehicleInteractable(id: string): void {
    const controller = this.vehicles.get(id);
    if (!controller) return;
    const def = controller.def;
    const at = new THREE.Vector3();

    this.interactions.register({
      id: `vehicle:${id}`,
      position: () => controller.position(at),
      actions: [
        {
          id: `vehicle:${id}:enter`,
          label: `Get on the ${def.displayName.toLowerCase()}`,
          priority: 25,
          // Reach from the widest part of the vehicle, plus an arm's length.
          maxDistance: Math.max(def.dimensions.x, def.dimensions.z) * 0.5 + 1.4,
          facingTolerance: null,
          holdSeconds: 0,
          isAvailable: () => this.riding === null,
          execute: () => void this.enterVehicle(id),
        },
      ],
    });
  }

  /**
   * Push the accessibility options onto the needs.
   *
   * Bound to `Settings.onChange` rather than read per frame, so turning a need
   * off takes effect immediately and `Needs` stays the only thing that knows
   * what "off" means: it leaves the value where it was rather than topping it
   * up, so switching back on resumes instead of granting a free refill.
   */
  private applyNeedsSettings(): void {
    const s = this.settings.current;
    this.needs.configure({ enabled: s.needsEnabled, decayScale: s.needsDecay });
  }

  /**
   * Build the dev proving ground and fold it into collision.
   *
   * The road's boxes are added to the *existing* merged BVH rather than a
   * second collision world: the character motor and the vehicle wheels both
   * read one collider, and giving the road its own would mean a car could
   * drive on it while the player walked through it.
   */
  private async buildTestRoad(): Promise<void> {
    const { buildTestRoad, TEST_ROAD_MARKS } = await import('../vehicles/TestRoad');
    // Off to the side of the village, clear of anything it could intersect.
    //
    // Height is the *highest* terrain under the whole 120 m footprint, not a
    // single sample: taken at one point, most of the road ends up buried and
    // a vehicle "on" it is really driving on the hillside underneath, which
    // is exactly the contamination the proving ground exists to remove.
    // Sat on the terrain under its own start line, not over the highest point
    // in the footprint: that put it fifteen metres in the air. The far end may
    // clip a rise, which is acceptable for a dev tool whose purpose is the
    // flat straight.
    const origin = new THREE.Vector3(-140, this.runtime.heightAt(-140, -56) + 0.25, -60);
    const { group, colliders } = buildTestRoad(origin);

    this.scene.add(group);
    this.testRoadOrigin = origin;
    this.gameScope.addTeardown(() => {
      this.scene.remove(group);
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    });

    // `build` disposes the current collider before merging, so the existing
    // geometry has to be copied out first -- passing the live collider back in
    // hands the merger a buffer that is freed underneath it, and the road
    // silently fails to become solid.
    const existing = this.runtime.collision.collider;
    const carried = existing ? new THREE.Mesh(existing.geometry.clone()) : null;
    carried?.updateMatrixWorld(true);
    this.runtime.collision.build([...(carried ? [carried] : []), ...colliders]);
    if (this.physics) this.syncPhysicsGeometry();
    void TEST_ROAD_MARKS;
  }

  /** World position of a named spot on the proving ground, or null. */
  async testRoadMark(name: string): Promise<{ x: number; y: number; z: number; facing: number } | null> {
    if (!this.testRoadOrigin) return null;
    const { TEST_ROAD_MARKS } = await import('../vehicles/TestRoad');
    const mark = (TEST_ROAD_MARKS as Record<string, { x: number; z: number; facing: number }>)[name];
    if (!mark) return null;
    return {
      x: this.testRoadOrigin.x + mark.x,
      y: this.testRoadOrigin.y + 0.6,
      z: this.testRoadOrigin.z + mark.z,
      facing: mark.facing,
    };
  }

  /**
   * Everything the map should mark.
   *
   * Built fresh each redraw. Keepsakes come from the village, which a district
   * does not have, so this has to degrade rather than assert -- the same rule
   * the radar follows.
   */
  private mapMarkers(): Array<{
    x: number; z: number;
    kind: 'keepsake' | 'vehicle' | 'home' | 'garage';
    found?: boolean; label?: string;
  }> {
    const out: Array<{
      x: number; z: number;
      kind: 'keepsake' | 'vehicle' | 'home' | 'garage';
      found?: boolean; label?: string;
    }> = [];

    for (const k of this.village?.keepsakeMarkers ?? []) {
      out.push({ x: k.x, z: k.z, kind: 'keepsake', found: k.found });
    }

    const zone = this.zones.activeZoneId ?? 'village_coast';
    for (const record of this.garage.inZone(zone)) {
      out.push({
        x: record.transform.x,
        z: record.transform.z,
        kind: 'vehicle',
        label: record.kind,
      });
    }

    const spot = this.garage.garageFor(zone);
    if (spot) out.push({ x: spot.transform.x, z: spot.transform.z, kind: 'garage' });

    return out;
  }

  /** Right whichever vehicle the player is standing closest to, within reach. */
  private rightNearestVehicle(): boolean {
    let best: string | null = null;
    let bestDistance = 6;
    for (const [id, controller] of this.vehicles) {
      const at = controller.position(this.seatPos);
      const d = Math.hypot(at.x - this.player.position.x, at.z - this.player.position.z);
      if (d < bestDistance) {
        best = id;
        bestDistance = d;
      }
    }
    return best ? this.rightVehicle(best) : false;
  }

  /** Where the camera looks while driving: the vehicle, at cabin height. */
  private vehicleCameraTarget(): THREE.Vector3 {
    const controller = this.riding ? this.vehicles.get(this.riding.id) : null;
    if (!controller) return this.player.lookTarget;
    const at = controller.position(this.camTarget);
    return at.setY(at.y + controller.def.camera.height * 0.5);
  }

  /**
   * Drive, and keep the seated character with the vehicle.
   *
   * Runs before the character update so the player's own controller never sees
   * the same stick that is steering.
   */
  private updateRiding(): void {
    if (!this.riding) return;
    const controller = this.vehicles.get(this.riding.id);
    if (!controller) {
      // The vehicle went away underneath the rider -- despawned, or a zone
      // change took it. Put the player back on their feet rather than leaving
      // them attached to nothing.
      this.riding = null;
      this.player.root.visible = true;
      this.hud.setVehicleReadout(null);
      return;
    }

    const api = this.vehicleApi;
    if (!api) return;

    // R, or the pad's d-pad down: set it back on its wheels where it stands.
    if (this.input.consumeFlip()) this.rightVehicle(this.riding.id);

    const blocked = this.hud.infoOpen || this.hud.wardrobeOpen || this.transitioning;
    controller.setInput(
      blocked
        ? { steer: 0, throttle: 0, brake: 1, handbrake: true }
        : api.controls.vehicleInputFrom(this.input.move, this.input.pad, this.input.running),
    );

    // Hold the character at its seat so its shadow and anything attached to it
    // travel with the vehicle, even though the mesh itself is hidden.
    const t = controller.telemetry;
    const seatAt = api.access.seatWorldPosition(
      {
        position: controller.position(this.seatPos),
        yaw: controller.headingYaw(),
        speed: t.forwardSpeed,
      },
      this.riding.seat,
    );
    this.player.motor.teleport(seatAt.x, seatAt.y, seatAt.z);
    this.player.controller.facing = controller.headingYaw();

    this.cameraWasReversing = api.controls.isReversing(t.forwardSpeed, this.cameraWasReversing);
    Object.assign(
      this.camera.tuning,
      api.controls.vehicleCameraTuning(
        controller.def.camera,
        t.forwardSpeed,
        controller.def.drive.maxSpeed,
      ),
    );

    this.hud.setVehicleReadout(
      api.controls.dashboard(
        controller.def,
        t.speedKmh,
        api.dynamics.gearLabel(t.gear),
        1,
        null,
      ),
    );
  }

  /** Put the player into a vehicle. False when they may not. */
  async enterVehicle(id: string, seatId?: string): Promise<boolean> {
    const controller = this.vehicles.get(id);
    if (!controller || this.riding) return false;

    const access = this.vehicleApi?.access ?? (await import('../vehicles/VehicleAccess'));
    const pose = {
      position: controller.position(this.seatPos),
      yaw: controller.headingYaw(),
      speed: controller.telemetry.forwardSpeed,
    };

    const chosen = seatId
      ? controller.def.seats.find((s) => s.id === seatId)
      : access.nearestSeat(controller.def, pose, this.player.position, { driverOnly: true })?.seat;
    if (!chosen) return false;

    const allowed = access.canEnter(controller.def, chosen, pose, {
      keys: new Set(this.inventory.toJSON().map((stack) => stack.id)),
      locked: this.lockedVehicles.has(id),
      occupied: new Set<string>(),
    });
    if (!allowed.ok) {
      this.hud.showToast('Vehicle', access.entryRefusalText(allowed.reason));
      return false;
    }

    this.riding = { id, seat: chosen };
    this.player.root.visible = false;
    this.player.setSitting(false);
    this.camera.resetBehind(this.vehicleCameraTarget(), controller.headingYaw());
    this.hud.setPrompt(null);
    return true;
  }

  /**
   * Get out, if there is anywhere safe to stand.
   *
   * Refusing is a real outcome, not an error. The acceptance criterion is that
   * the player cannot end up in a wall or over a cliff, and the only way to
   * honour that is sometimes to say no.
   */
  async exitVehicle(): Promise<boolean> {
    if (!this.riding) return false;
    const controller = this.vehicles.get(this.riding.id);
    if (!controller) {
      this.riding = null;
      this.player.root.visible = true;
      this.hud.setVehicleReadout(null);
      return true;
    }

    const access = this.vehicleApi?.access ?? (await import('../vehicles/VehicleAccess'));
    const t = controller.telemetry;
    const placed = access.exitPlacement(
      controller.def,
      this.riding.seat,
      {
        position: controller.position(this.seatPos),
        yaw: controller.headingYaw(),
        speed: t.forwardSpeed,
      },
      this.placementProbe(),
    );

    if (!placed.ok) {
      this.hud.showToast('Vehicle', access.exitRefusalText(placed.reason));
      return false;
    }

    this.riding = null;
    controller.setInput({ steer: 0, throttle: 0, brake: 1, handbrake: true });
    this.player.root.visible = true;
    this.player.motor.teleport(placed.position.x, placed.position.y + 0.05, placed.position.z);

    // Hand the camera back its character tuning; it is one object shared by
    // both, so leaving it on the vehicle's settings follows the player out.
    Object.assign(this.camera.tuning, DEFAULT_CAMERA);
    this.camera.resetBehind(this.player.lookTarget, this.player.controller.facing);
    this.hud.setVehicleReadout(null);
    return true;
  }

  /** Answers about the world, for `exitPlacement`. */
  private placementProbe() {
    return {
      groundAt: (x: number, z: number): number | null =>
        this.runtime.inBounds(x, z) ? this.runtime.heightAt(x, z) : null,
      isClear: (x: number, y: number, z: number, radius: number): boolean => {
        // Sweep the player's capsule at the candidate spot; any displacement
        // means something solid is already there.
        const segment = new THREE.Line3(
          new THREE.Vector3(x, y + radius, z),
          new THREE.Vector3(x, y + 1.75 - radius, z),
        );
        const resolved = this.runtime.collision.resolveCapsule(segment, radius, {
          displacement: new THREE.Vector3(),
          groundNormal: null,
        });
        return resolved.displacement.lengthSq() < 1e-4;
      },
    };
  }

  get ridingVehicleId(): string | null {
    return this.riding?.id ?? null;
  }

  setVehicleLocked(id: string, locked: boolean): void {
    if (locked) this.lockedVehicles.add(id);
    else this.lockedVehicles.delete(id);
  }

  isVehicleLocked(id: string): boolean {
    return this.lockedVehicles.has(id);
  }

  /** What actions are allowed to read when deciding whether they can run. */
  private interactionContext(): WorldInteractionContext {
    return {
      age: this.life.ageYears,
      busy: this.transitioning || this.sleeping || this.hud.wardrobeOpen,
      indoors: this.indoors,
      sitting: this.player.isSitting,
    };
  }

  /**
   * Offer whatever is in reach, and act on it if asked.
   *
   * Position is the player's chest rather than their feet, so a bed you are
   * standing beside still counts. Everything past that — reach, facing,
   * availability, holds, the prompt — belongs to `InteractionSystem`.
   */
  private updateInteraction(dt: number): void {
    // Consumed unconditionally, so a press aimed at nothing cannot fire later.
    const pressed = this.input.consumeInteract();

    // On foot, R rights the nearest vehicle in reach. Standing beside a car on
    // its roof and having no way to turn it over is the frustrating case.
    if (!this.riding && this.input.consumeFlip()) this.rightNearestVehicle();
    const ctx = this.interactionContext();

    // Nothing may fire mid-transition, mid-nap or behind the wardrobe panel —
    // this guard has to come before standing up, or a stray WASD during the
    // fade teleports the player out of the chair.
    if (ctx.busy) {
      this.lastInteraction = null;
      this.hud.setPrompt(null);
      return;
    }

    // Driving: the only thing on offer is getting out. Leaving the world's
    // interactables live would let a player open their front door from the
    // driving seat of a car parked outside it.
    if (this.riding) {
      const label = 'Get out';
      this.hud.setPrompt(label);
      // Publish it as the interaction state too, or anything reading the
      // system -- the HUD's own record, the test bridge -- keeps reporting
      // last frame's "get in" while the player is already driving.
      this.lastInteraction = {
        primary: null,
        candidates: [],
        needsSelector: false,
        holdProgress: 0,
        prompt: label,
      };
      if (pressed) void this.exitVehicle();
      return;
    }

    // Any attempt to walk while seated is a request to stand.
    if (this.player.isSitting && this.input.anyMovement) {
      this.sit(false);
      return;
    }

    const state = this.interactions.update(
      dt,
      {
        position: this.player.lookTarget,
        facing: this.player.controller.facing,
        // A press with no key state behind it -- touch, gamepad -- still needs
        // one frame of "held" for the system to see a leading edge.
        held: this.input.interactHeld || pressed,
      },
      ctx,
      (c) => void c.action.execute(ctx),
    );

    this.lastInteraction = state;
    this.hud.setPrompt(state.prompt);

    // Indoors, an interact that found nothing means "let me out". Gating the
    // way out on a proximity radius is how you strand someone in a room.
    if (pressed && !state.primary && this.indoors && !ctx.busy) void this.exitInterior();
  }

  /**
   * Take the chair, or leave it.
   *
   * Sitting snaps onto the seat rather than blending, because a spring toward
   * the seat with collision still running just wedges the capsule in the desk.
   */
  private sit(on: boolean): void {
    const room = this.village!.interiors;
    if (on) {
      this.player.motor.teleport(room.chair.x, room.chair.y, room.chair.z);
      this.player.controller.facing = Math.PI;
      this.player.setSitting(true);
      this.camera.resetBehind(this.player.lookTarget, Math.PI * 0.35);
      this.camera.setDistance(2.6);
      this.hud.setPrompt('Stand up');
    } else {
      this.player.setSitting(false);
      // Step clear of the seat so the sit prompt doesn't fire again instantly.
      this.player.motor.teleport(room.chair.x + 0.85, room.chair.y, room.chair.z + 0.55);
      this.camera.setDistance(2.3);
      this.hud.setPrompt(null);
    }
  }

  /** Common teleport: fade out, move, reframe the camera, fade back in. */
  private async transit(
    to: THREE.Vector3,
    facing: number,
    indoors: boolean,
    outMs = 0.75,
    inMs = 0.85,
  ): Promise<void> {
    this.hud.setPrompt(null);
    this.input.releaseAll();

    await this.hud.setFade(true, outMs);

    this.village!.interiors.setVisible(indoors);
    this.indoors = indoors;
    this.audio.setZone(indoors ? 'indoor' : 'outdoor');
    // The kill plane and world bounds only make sense outdoors — the interior
    // cell sits 600 m up and outside the terrain footprint.
    this.player.controller.boundsEnabled = !indoors;
    this.player.motor.teleport(to.x, to.y, to.z);
    this.player.controller.facing = facing;
    this.camera.resetBehind(this.player.lookTarget, facing);
    // Indoors the camera has to sit close or it ends up inside a wall.
    this.camera.setMinDistance(indoors ? 1.15 : 3.0);
    this.camera.setDistance(indoors ? 2.3 : 6.4);
    this.stepQuiet();

    await this.hud.setFade(false, inMs);
  }

  /** Step the simulation without letting the player drift during a fade. */
  private stepQuiet(): void {
    // Enough steps for the camera spring and collision probe to settle.
    for (let i = 0; i < 24; i++) this.update(1 / 60);
    this.render();
  }

  private async enterInterior(): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    this.returnPoint.copy(this.player.position);
    this.returnFacing = this.player.controller.facing;

    await this.transit(this.village!.interiors.spawn, Math.PI, true);
    this.transitioning = false;
    this.hud.showToast('Inside', 'Quiet in here. The bed is by the window.');
  }

  private async exitInterior(): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    await this.transit(this.returnPoint, this.returnFacing, false);
    this.transitioning = false;
  }

  /**
   * Sleep. The character actually lies down and is held on screen for a beat
   * before the fade — a straight cut to black reads as a bug, not a nap.
   */
  private async sleep(): Promise<void> {
    if (this.sleeping || this.transitioning) return;
    this.sleeping = true;
    this.hud.setPrompt(null);
    this.input.releaseAll();

    const room = this.village!.interiors;

    // Lie down on the mattress and frame it from the side. `sleepSpot` is the
    // *feet* position: tipping onto the back swings the head 1.36 m along -Z,
    // so facing must stay at 0 for the head to land on the pillow.
    const bed = room.sleepSpot;
    this.player.motor.teleport(bed.x, bed.y, bed.z);
    this.player.controller.facing = 0;
    this.player.setLying(true);
    this.camera.resetBehind(this.player.lookTarget, Math.PI * 0.62);
    this.camera.setMinDistance(1.15);
    this.camera.setDistance(2.9);
    this.camera.pitch = 0.34;
    this.stepQuiet();
    await wait(1500);

    await this.hud.setFade(true, 1.2);

    this.env.setMode('cycle');
    this.settings.setTimeMode('cycle');
    this.env.jumpTo(0.285); // just after first light

    // A night's sleep fills energy and lifts mood. It does not feed you.
    this.needs.sleep();

    this.player.setLying(false);
    this.player.motor.teleport(room.bedside.x, room.bedside.y, room.bedside.z);
    this.player.controller.facing = Math.PI;
    this.camera.resetBehind(this.player.lookTarget, Math.PI);
    this.camera.setDistance(2.3);
    this.stepQuiet();

    await this.hud.setFade(false, 1.5);
    this.sleeping = false;
    this.hud.showToast('Morning', 'You slept until the light came back.');
  }

  private updateAudio(dt: number): void {
    const p = this.player.position;
    // The road field is a 2D lookup with no notion of the interior cell, and
    // the room sits directly above the main road in x/z — so indoors it would
    // report tarmac. Floorboards are closer to grass than asphalt.
    const surface = this.indoors ? 0.3 : this.runtime.surfaceHardness(p.x, p.z);
    const moving = this.player.motor.grounded && this.player.speed > 0.3;

    this.audio.update(
      dt,
      this.player.speed,
      surface,
      1 - this.env.dayFactor,
      moving,
    );
  }

  /**
   * Draw the outdoor world into the window texture.
   *
   * Only while indoors, and only for the interior windows. The interior
   * itself, the player and their contact shadow are suppressed for the pass —
   * they live in the room, not out on the street.
   */
  private renderPortal(): void {
    if (!this.indoors) return;
    this.portal.render(
      this.renderer.renderer,
      this.scene,
      this.camera.camera,
      [this.village!.interiors.group, this.player.root, this.contact.mesh],
      (cam) => {
        // The sky dome rides the main camera, which is 600 m up. Move it onto
        // the portal camera or the window would look out at a tiny ball.
        this.env.sky.anchorDome(cam.position);
      },
    );
    // Put the dome back where the main camera can see it.
    this.env.sky.anchorDome(this.camera.camera.position);
  }

  private render(): void {
    this.renderer.beginFrame();
    this.renderPortal();
    this.post.setDaylight(this.env.dayFactor);
    this.post.setCamera(this.camera.camera);
    this.post.render();
  }

  private reportDebug(): void {
    const s = this.runtime.stats;
    const lines = [
      `${this.fps.toFixed(0)} fps · ${this.renderer.info}`,
      `veg ${s.vegetation} · grass ${s.grass} · collider ${(s.colliderTris / 1000).toFixed(0)}k`,
      `state ${this.player.state} · ${this.player.speed.toFixed(2)} m/s · ${
        this.player.motor.grounded ? 'ground' : 'air'
      }`,
      `time ${this.env.clockLabel} · day ${this.env.dayFactor.toFixed(2)}`,
    ];

    const p = this.population?.stats;
    if (p) {
      lines.push(
        `npc ${p.named}+${p.ambient} · near ${p.near} mid ${p.mid} far ${p.far} · bodies ${p.bodies}`,
        `nav ${p.navState} ${p.navBuildMs}ms · agents ${p.navAgents} · links ${p.offMeshLinks} · far ${p.farTickMs}ms`,
        `traffic ${p.traffic} (${p.trafficParked} parked, ${p.trafficBarges} barged) · seen ${p.witnessed} · unstuck ${p.stuckRecoveries}`,
      );
    } else {
      lines.push('npc — population not loaded');
    }

    this.hud.setDebug(lines.join('\n'));
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.player?.dispose();
    // Ahead of the zone teardown, for the same reason as in `travelTo`:
    // crowd agents and the navmesh live in WASM memory and are not reachable
    // by the garbage collector.
    this.disposePopulation();

    // The active zone owns the world (and, through it, the CollisionWorld).
    // Awaiting is not an option in a synchronous dispose, so report a failure
    // rather than drop it silently.
    void this.zones?.dispose().catch((err) => {
      console.warn('[LastHorizon] zone teardown failed', err);
    });

    // Everything renderer-lifetime. Listed once, at creation, rather than
    // duplicated here — a hand-maintained teardown list is exactly how a
    // resource ends up released twice or not at all.
    const report = this.gameScope.dispose();
    if (report.errors.length) {
      console.warn('[LastHorizon] game teardown had errors', report.errors);
    }
  }
}

/**
 * Yield to the browser so it can paint the loading bar before the next block
 * of synchronous world building.
 *
 * rAF alone is not enough: in a background or non-compositing tab it may
 * never fire, which would hang loading forever. Race it against a timer.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Every nth point, always keeping the last.
 *
 * The village road is 260 spaced points. Every one of them earns its place in
 * the tarmac mesh and none of them do in a lane graph, where a car
 * interpolating between points 40 cm apart gains nothing and pays for a segment
 * search each frame.
 */
function thin<T>(points: readonly T[], step: number): T[] {
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (last !== undefined && out[out.length - 1] !== last) out.push(last);
  return out;
}

function frame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 80);
  });
}

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
import { IMPOUND_FEE, VehicleRegistry } from '../vehicles/VehicleRegistry';
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
import type { InteriorRegistry } from '../world/interiors/InteriorRegistry';
import { interiorInteractables } from '../interaction/WorldInteractables';
import type { BuiltPoint } from '../world/interiors/InteriorBuilder';
import { Economy } from '../economy/Economy';
import { RENT_PERIOD_DAYS, SERVICE_FEES } from '../economy/PriceCatalog';
import { TaskSystem, type StartRefusal } from '../tasks/TaskSystem';
import { jobIds, loadTasks, taskDef } from '../tasks/taskRegistry';
import type { ServiceFailure, ServiceHost } from '../services/ServiceSystem';
import type { DecorItemId } from '../services/ServiceCatalog';
import type { KitPart } from '../world/interiors/InteriorKit';
import {
  SERVICE_HOURS,
  formatHour,
  isOpenAt,
  type ServiceType,
} from '../world/interiors/InteriorDefinition';

/** The lazily-imported half. See `src/world/interiors/InteriorSubsystem.ts`. */
type InteriorApi = typeof import('../world/interiors/InteriorSubsystem');
// Eager, and deliberately: `SaveService` has to read and write story progress
// whether or not a quest has ever loaded, the same argument that keeps
// `RelationshipStore` above `Population`. Everything else about the story --
// 35 quests, 15 dialogue trees, 9 cutscenes, the string table, the Life Reel
// renderer -- is behind `StorySubsystem`.
import { StoryState } from '../story/StoryState';
type StoryApi = typeof import('../story/StorySubsystem');
type StoryDirector = import('../story/StoryDirector').StoryDirector;
// Eager for the same reason as `StoryState`: a criminal record is in every
// save, and the HUD needs to know whether to show a Heat readout before the
// combat chunk exists. Everything that *does* anything is behind the import.
import { CombatState } from '../combat/CombatState';
type CombatApi = typeof import('../combat/CombatSubsystem');
type CombatDirector = import('../combat/CombatDirector').CombatDirector;
// Phase 10, same split again: where the aeroplane is parked is in every save.
import { FlightState } from '../flight/FlightState';
type FlightDirector = import('../flight/FlightDirector').FlightDirector;
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

// Scratch vectors for the officer sight test. It runs per officer per tick, and
// allocating a vector there is garbage the collector walks every frame of a
// pursuit.
const _officerEye = new THREE.Vector3();
const _officerDir = new THREE.Vector3();

/**
 * What a witness would call each thing they notice.
 *
 * The join between Phase 6's `PerceptionKind` and Phase 9's `CrimeId`. Kinds
 * with no entry — a greeting, a collision, somebody driving badly — are
 * noticed and reacted to but never reported, which is why the table is a map
 * rather than a cast.
 */
const CRIME_BY_PERCEPTION: Readonly<Record<string, import('../crime/CrimeDefinition').CrimeId | undefined>> = {
  theft: 'theft',
  weapon_display: 'weapon_display',
  gunshot: 'weapon_discharge',
  crime: 'assault',
};

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
  /** Kept so the interior kit can be fetched later, on the first doorway. */
  private assetManager: AssetManager | null = null;
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
    enter: (doorId) => void this.enterInterior(doorId),
    exit: () => void this.exitInterior(),
    sit: (on) => this.sit(on),
    wardrobe: () => this.hud.openWardrobe(true),
    shower: () => this.shower(),
    service: (serviceId, pointId) => this.useService(serviceId, pointId),
    task: (taskId) => this.startTask(taskId),
    point: (pointId, kind) => this.usePoint(pointId, kind),
  };
  private sleeping = false;
  private transitioning = false;
  private indoors = false;

  // ---- Phase 7 -------------------------------------------------------------
  /**
   * Null until the first door is opened.
   *
   * The registry, the builder, the nine layouts and the whole service layer
   * live behind a dynamic import -- see InteriorSubsystem. Every read below
   * is optional-chained rather than asserted, because "nobody has gone inside
   * yet" is the normal state for most of a session.
   */
  private interiors: InteriorRegistry | null = null;
  private interiorApi: InteriorApi | null = null;
  private readonly economy = new Economy(this.inventory);
  private readonly tasks = new TaskSystem();
  /**
   * Decorations the player has placed, by interior id then slot id.
   *
   * Held here rather than on the built room, because the room is destroyed
   * every time they walk out of it and the sofa should still be there when
   * they come back.
   */
  private readonly decor = new Map<string, Map<string, DecorItemId>>();
  /** Which owned vehicle the garage acts on. */
  private garageSelection: string | null = null;

  // -- Phase 8: the authored story ----------------------------------------
  private readonly story = new StoryState();
  private storyApi: StoryApi | null = null;
  private director: StoryDirector | null = null;
  private storyLoading: Promise<void> | null = null;
  private panels: import('../ui/StoryPanels').StoryPanels | null = null;
  /** Set while a scene or a conversation owns the screen. */
  private storyBlocking = false;
  private lastVehiclePos: THREE.Vector3 | null = null;

  // -- Phase 10: the aeroplane ----------------------------------------------
  private readonly flightState = new FlightState();
  private flight: FlightDirector | null = null;
  private flightLoading: Promise<void> | null = null;
  /** Body, and the propeller as its own node so the runtime can spin it. */
  private planeMesh: THREE.Object3D | null = null;
  private planeProp: THREE.Object3D | null = null;

  // -- Phase 9: weapons and the police -------------------------------------
  private readonly combatState = new CombatState();
  private combatApi: CombatApi | null = null;
  private combat: CombatDirector | null = null;
  private combatLoading: Promise<void> | null = null;
  private weaponModels = new Map<string, THREE.Object3D>();
  /** The mesh currently in the player's hand, if any. */
  private heldWeapon: THREE.Object3D | null = null;
  /** Composure per NPC, 0..1. Full is untouched. Never called health. */
  private readonly composure = new Map<string, number>();
  /** The officers, as bodies. Lives in the lazy chunk; see OfficerCorps. */
  private corps: import('../combat/OfficerCorps').OfficerCorps | null = null;
  /** The last service menu opened, so a second press runs the first offer. */
  private lastServiceId: string | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async start(loading: LoadingScreen): Promise<void> {
    const preset = this.settings.preset;

    this.renderer = createRendererBackend(this.canvas, preset).backend;
    this.camera = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.post = new PostProcessing(this.renderer.renderer, this.scene, this.camera.camera);

    const assetManager = new AssetManager();
    this.assetManager = assetManager;
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

    // The portal anchor is per-interior now and set on entry: each room sits
    // in its own pocket of space, so the mapping from room origin to the
    // outdoor viewpoint changes with the door you came through. The registry
    // that holds it does not exist until the first doorway.

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
      onCombatOption: (key, value) => {
        this.settings.setCombatOption(key, value);
        this.applyCombatSettings();
      },
      onAccessOption: (key, value) => {
        this.settings.setAccessOption(key, value);
        // Flight assist is the only one of the five that reaches a system
        // rather than the document; the rest are `HUD.applyAccess`.
        if (key === 'flightAssist') {
          this.flight?.setAssist(this.settings.current.flightAssist);
        }
      },
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
    // The phone's data sources, handed over once the HUD exists. Without this
    // `openPhone` refuses rather than showing an empty handset.
    this.hud.setPhoneDeps(this.phoneDeps());
    this.hud.setPauseDeps(this.pauseDeps());
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
    this.syncDoorLinks();
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

    // The six job definitions, in both modes. Fire-and-forget for the same
    // reason as the population: nothing can start a task until an interior
    // counter, a quest stage or the phone's Work app exists, and all three are
    // themselves lazy and await this first. The village is walkable meanwhile.
    void loadTasks();

    // Story Mode brings the authored story in; Free Roam never downloads it.
    // Fire-and-forget: the village is already standing and playable, and
    // chapter 1 arrives a moment later exactly as the population does.
    if (this.mode === 'story') {
      void this.ensureStory().then(() => this.director?.begin());
    }

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
    this.economy.wallet.restore({ cash: o.startMoney, bank: 0 });

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
    const inside = this.interiors?.returnContext ?? null;
    return {
      version: 5,
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
        // Kept in step with `progress` below for the reason `money` is kept in
        // step with the wallet: a reader written against v3 still sees roughly
        // where the player is. Nothing in this build reads it.
        quests: Object.fromEntries(
          this.story.allRuns.map((r) => [r.id, r.state === 'completed' ? -1 : 0]),
        ),
        progress: this.story.toJSON(),
      },
      // Kept in step with the wallet so a reader that predates the economy
      // still sees a sensible balance rather than a zero.
      money: this.economy.wallet.cash,
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
      // Phase 7. The door and the way back out, never the room's contents —
      // the room is rebuilt from the catalogue, like the world from the
      // manifest.
      inside: inside
        ? {
            doorId: inside.doorId,
            zone: inside.zone as SaveData['zone'],
            x: inside.x,
            y: inside.y,
            z: inside.z,
            facing: inside.facing,
          }
        : null,
      economy: this.economy.toJSON(),
      // Pushed from the live systems first, so a save taken mid-pursuit
      // records the Heat that is actually on screen rather than the last one
      // that happened to be mirrored.
      combat: (this.combat?.capture(), this.combatState.toJSON()),
      tasks: this.tasks.toJSON(),
      decor: Object.fromEntries(
        [...this.decor].map(([id, slots]) => [id, Object.fromEntries(slots)]),
      ),
    };
  }

  /**
   * Write a slot, rolling the economy *and the story* back if the write fails.
   *
   * The failure this guards is narrow and real: a purchase applied in memory,
   * then a save that throws on quota. Without the rollback the run carries
   * goods that the next load will not have paid for.
   *
   * The story is in the snapshot for the same reason the economy's award keys
   * are: a quest reward paid in memory and then not written leaves a spent key
   * with no money behind it, and that reward can never pay again.
   */
  private async saveWithRollback(slot: SaveSlotId): Promise<boolean> {
    const before = this.economy.snapshot();
    const storyBefore = this.story.snapshot();
    const combatBefore = this.combatState.snapshot();
    const result = await this.saves.save(slot, this.captureSave(slot));
    if (!result.ok) {
      this.economy.restore(before);
      this.story.restore(storyBefore);
      // A fine paid in memory against a write that failed would otherwise be
      // a fine the next load still owes, with the money already gone.
      this.combatState.restore(combatBefore);
      this.combat?.afterRestore();
      this.hud.showToast('Not saved', 'Nothing was lost, but nothing was written.');
    }
    return result.ok;
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

    // The story before anything that could report progress into it. `restore`
    // handles an absent block as "nothing has happened yet", which is exactly
    // what a save written before this phase means.
    this.story.restore(data.story.progress);
    this.director?.afterRestore();

    // The same for weapons and the record. `afterRestore` also retires every
    // officer: a save loaded mid-chase must not come back with a squad still
    // standing in the street from the run before it.
    this.combatState.restore(data.combat);
    this.combat?.afterRestore();
    this.corps?.clear();
    this.composure.clear();

    // The economy before the inventory, because `Economy.restoreFrom` only
    // touches the wallet, the ledger and the award keys -- the stacks are the
    // inventory's own and are restored below.
    if (data.economy) this.economy.restoreFrom(data.economy);
    else this.economy.wallet.restore({ cash: data.money, bank: 0 });
    this.tasks.restore(data.tasks ?? {});

    this.decor.clear();
    for (const [interiorId, slots] of Object.entries(data.decor ?? {})) {
      const map = new Map<DecorItemId, DecorItemId>() as unknown as Map<string, DecorItemId>;
      for (const [slot, item] of Object.entries(slots)) {
        if (this.interiorApi !== null && item in this.interiorApi.DECOR_PARTS) map.set(slot, item as DecorItemId);
      }
      if (map.size > 0) this.decor.set(interiorId, map);
    }

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

    void this.restoreIndoors(data);
    this.syncAge();
  }

  /**
   * Put the player back inside the building they saved in.
   *
   * Deliberately after the spawn resolution above, which has just placed them
   * outdoors: if the kit cannot be fetched, or the door no longer exists, that
   * outdoor position is a valid place to be and the load degrades to it rather
   * than failing.
   */
  private async restoreIndoors(data: SaveData): Promise<void> {
    const inside = data.inside;
    if (!inside) {
      if (this.indoors) await this.exitInterior();
      return;
    }
    if (inside.zone !== this.zones.activeZoneId) return;
    if (!(await this.ensureKit())) return;

    const result = this.interiors!.reopen(
      { ...inside, zone: inside.zone },
      this.env.time * 24,
      this.decorFor(this.interiors?.door(inside.doorId)?.interiorId ?? ''),
    );
    if (!result.ok) return;

    this.enterBuiltInterior(result.interior);
    this.indoors = true;
    this.player.controller.boundsEnabled = false;
    this.player.motor.teleport(
      result.interior.spawn.x,
      result.interior.spawn.y,
      result.interior.spawn.z,
    );
    this.player.controller.facing = result.interior.spawnFacing;
    this.camera.resetBehind(this.player.lookTarget, result.interior.spawnFacing);
    this.camera.setMinDistance(1.15);
    this.camera.setDistance(2.3);
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

  /**
   * What a birthday unlocks, in the player's words.
   *
   * Read off `Gates` rather than listed here, so the postcard cannot claim
   * something the gates still refuse. A birthday that unlocks nothing gets a
   * card with no list rather than an invented one.
   */
  private birthdayUnlocks(age: number): string[] {
    const out: string[] = [];
    if (age === 16) out.push('Paid work');
    if (age === 17) out.push('Driving');
    if (age === 18) out.push('The city', 'Adult work');
    return out;
  }

  /** One birthday: announce, autosave while the clock is stopped, age up. */
  private async deliverBirthday(age: number): Promise<void> {
    const card = this.director?.birthday(age, this.birthdayUnlocks(age)) ?? null;
    if (card) this.hud.showToast(card.title, card.body);
    else this.hud.showToast('Another year', `You are ${age} today.`);

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
    if (!(await this.saveWithRollback('autosave'))) {
      console.warn('[LastHorizon] birthday autosave failed');
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
      // Travelling while indoors is not reachable -- the door prompts are the
      // only way to travel and they are not registered inside -- but the room
      // is torn down here anyway rather than trusted to be absent.
      const openRoom = this.interiors?.active ?? null;
      if (openRoom) {
        this.scene.remove(openRoom.group);
        this.runtime.collision.setOverlay(null);
        this.interiors?.close();
      }
      this.indoors = false;
      this.sleeping = false;
      this.seatPoint = null;
      this.syncDoorLinks();
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
      step: (dt, render = true) => {
        this.update(dt);
        if (render) this.render();
      },
      // No door named: take the nearest, or the zone's first if the caller is
      // nowhere near one. "Put me inside a building" is what the pre-Phase-7
      // bridge op meant and several specs still say it that way; the *game*
      // path always names a door, so this convenience cannot loosen it.
      enterInterior: async () => {
        await this.ensureKit();
        const id = this.nearestDoorId() ?? this.runtime.interactables[0]?.doorId;
        if (id) await this.enterInterior(id);
      },
      exitInterior: () => this.exitInterior(),
      // Likewise: sitting with no seat named takes the room's first chair.
      sit: (on) => {
        const seat = this.interiors?.active?.points.find((p) => p.kind === 'chair');
        this.sit(on, on ? seat : undefined);
      },
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
      giveItem: (id, count) => {
        const added = this.inventory.add(id, count).added > 0;
        // A `collect` objective reads off the bag, so a test that hands over
        // three boxes has done the objective.
        this.syncTaskProgress();
        return added;
      },
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
        return this.saveWithRollback(parsed);
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

      // ---- Phase 7 ----------------------------------------------------------
      // Read off the zone rather than the registry: the registry does not
      // exist until somebody opens a door, and a test has to be able to ask
      // what the doors *are* before going through one.
      doorList: () => {
        const hour = this.env.time * 24;
        return this.runtime.interactables.map((it) => ({
          id: it.doorId,
          interiorId: it.service,
          x: it.position.x,
          y: it.position.y,
          z: it.position.z,
          label: it.prompt,
          open: isOpenAt(SERVICE_HOURS[it.service], hour),
        }));
      },
      enterDoor: async (doorId) => {
        await this.enterInterior(doorId);
        return this.indoors && this.interiors?.returnContext?.doorId === doorId;
      },
      interiorState: () => {
        const built = this.interiors?.active ?? null;
        if (!built) return null;
        const ctx = this.interiors?.returnContext ?? null;
        return {
          id: built.def.id,
          name: built.def.name,
          service: built.def.service,
          originX: built.origin.x,
          originY: built.origin.y,
          parts: built.stats.parts,
          triangles: built.stats.triangles,
          colliderBoxes: built.stats.colliderBoxes,
          points: built.points.map((p) => p.id),
          livePortal: built.def.livePortal,
          returnTo: ctx
            ? { doorId: ctx.doorId, x: ctx.x, y: ctx.y, z: ctx.z, facing: ctx.facing }
            : null,
        };
      },
      walletState: () => ({
        cash: this.economy.wallet.cash,
        bank: this.economy.wallet.bank,
        ledger: this.economy.ledger.size,
        net: this.economy.ledger.net(),
      }),
      giveMoney: (amount) => {
        this.economy.earn('refund', Math.max(0, Math.floor(amount)), 'Test top-up', Date.now());
      },
      serviceMenu: (serviceId) => {
        const menu = this.interiorApi!.buildMenu(serviceId, this.serviceHost());
        if (!menu) return null;
        return {
          id: menu.id,
          title: menu.title,
          open: menu.open,
          entries: menu.entries.map((e) => ({
            id: e.id,
            label: e.label,
            price: e.price,
            available: e.available,
            reason: e.reason,
          })),
        };
      },
      runService: (serviceId, offerId) => {
        const r = this.interiorApi!.executeOffer(serviceId, offerId, this.serviceHost());
        this.syncTaskProgress();
        this.syncInteractables();
        return r.ok ? 'ok' : r.reason;
      },
      taskState: () => {
        const run = this.tasks.active;
        if (!run) return null;
        return {
          id: run.def.id,
          name: run.def.name,
          status: this.tasks.status,
          runNumber: run.runNumber,
          difficulty: run.difficulty,
          pay: run.pay,
          timeRemaining: this.tasks.timeRemaining,
          objectives: run.progress.map((p) => ({
            id: p.id,
            label: p.label,
            done: p.done,
            target: p.target,
            complete: p.complete,
          })),
        };
      },
      beginTask: (taskId) => this.startTask(taskId),
      // Accepts a place name or an objective id, whichever the caller has.
      reportTask: (name) => {
        const ok = this.tasks.report({ place: name }) || this.tasks.report({ objectiveId: name });
        if (ok) this.afterTaskChange();
        return ok;
      },
      advanceTask: (seconds) => {
        this.tasks.advance(seconds);
        this.afterTaskChange();
      },
      cancelTask: () => {
        this.tasks.cancel();
        this.tasks.clear();
      },

      // ---- Phase 8 ----------------------------------------------------------
      // The debug tooling the brief asks for, reachable only under `?e2e=1`.
      // `jumpToStage` in particular must never be in ordinary play: it is the
      // one operation here that can skip authored content.
      awaitStory: async () => {
        await this.ensureStory();
        this.director?.begin();
        return this.storyState();
      },
      storyState: () => this.storyState(),
      startQuest: (id) => this.director?.quests.start(id).ok ?? false,
      questState: (id) => {
        const view = this.director?.quests.view(id) ?? null;
        if (!view) return null;
        return {
          id: view.id,
          kind: view.kind,
          chapter: view.chapter,
          stage: view.stageId,
          objectives: view.objectives.map((o) => ({
            id: o.id,
            kind: o.kind,
            done: o.done,
            target: o.target,
            complete: o.complete,
            optional: o.optional,
          })),
        };
      },
      activeQuests: () => (this.director?.quests.activeQuests() ?? []).map((q) => q.id),
      jumpToStage: (questId, stageId) =>
        this.director?.quests.jumpToStage(questId, stageId) ?? false,
      reportObjective: (questId, objectiveId, amount) =>
        this.director?.quests.setProgress(questId, objectiveId, amount) ?? false,
      advanceStory: (seconds) => this.director?.quests.advance(seconds),
      setChoice: (id, value) => {
        this.director?.quests.applyConsequence({ kind: 'choice', id, value });
      },
      setFlag: (id) => {
        this.story.setFlag(id);
      },
      adjustReputation: (axis, delta) => {
        this.story.adjustReputation(axis === 'law' ? 'law' : 'community', delta);
      },
      talkToNpc: (id) => {
        this.talkTo(id);
        return (this.panels?.dialogueOpen ?? false);
      },
      dialogueState: () => {
        const turn = this.director?.dialogue.current() ?? null;
        if (!turn || !(this.panels?.dialogueOpen ?? false)) return null;
        return {
          treeId: turn.treeId,
          nodeId: turn.nodeId,
          speaker: turn.speaker,
          text: turn.text,
          choices: turn.choices.map((c) => ({
            index: c.index,
            text: c.text,
            available: c.available,
          })),
        };
      },
      chooseDialogue: (index) => {
        const next = this.director?.choose(index) ?? null;
        if (next) {
          const speaker = this.population?.namedById(this.director!.dialogue.npcId);
          this.showDialogueTurn(next, speaker?.definition?.displayName ?? '');
        } else {
          this.panels?.closeDialogue();
        }
        return (this.panels?.dialogueOpen ?? false);
      },
      sceneState: () => this.director?.scenes.currentScene ?? null,
      skipScene: () => this.director?.scenes.skip(),
      reelModel: () => {
        const model = this.director?.reel(this.reelFacts()) ?? null;
        if (!model) return null;
        return {
          finalTitle: model.finalTitle,
          timeline: model.timeline.map((r) => ({ age: r.age, kind: r.kind, text: r.text })),
          sections: model.sections.map((s) => ({
            title: s.title,
            rows: s.rows.map((r) => ({ label: r.label, value: r.value })),
          })),
        };
      },
      openReel: (open) => {
        if (open) this.openReel();
        else this.panels?.openReel(false);
      },
      exportReel: async () => {
        if (!this.director || !this.storyApi) return 0;
        const model = this.director.reel(this.reelFacts());
        const blob = await this.storyApi.exportReel(model, () =>
          document.createElement('canvas'),
        );
        return blob?.size ?? 0;
      },
      objectiveLine: () => this.hud.objectiveLine,
      openJournal: (open) => this.panels?.openJournal(open, this.director?.journal() ?? []),

      // ---- Phase 9 ----------------------------------------------------------
      awaitCombat: async () => {
        await this.ensureCombat();
        return this.combatSnapshot();
      },
      combatState: () => this.combatSnapshot(),
      // Refused below 18 by `WeaponSystem.acquire`, exactly as the game path
      // is. A bridge that could arm a minor would make criterion 1 a property
      // of the UI rather than of the system.
      giveWeapon: (id, rounds) =>
        this.combat?.acquire(id as import('../combat/WeaponDefinition').WeaponId, rounds) ?? false,
      equipWeapon: (id) =>
        this.combat?.equip(id as import('../combat/WeaponDefinition').WeaponId) ?? false,
      holsterWeapon: () => this.combat?.holster(),
      // Through the *input*, not the weapon. `updateCombat` rebuilds aim from
      // `input.aimHeld` every frame, so a bridge op that wrote to the weapon
      // system directly was undone one frame later and could never move the
      // camera — which is what a browser run found. Holding the aim is what a
      // player does; this does the same thing.
      setAiming: (on) => {
        this.input.setAimHeld(on);
        // One frame so the caller sees the state it just asked for rather than
        // the state from before, which is the whole reason this returns a bool.
        this.update(1 / 60);
        return this.combat?.weapons.aiming ?? false;
      },
      fireWeapon: () => this.combat?.fire().hits ?? [],
      reloadWeapon: () => this.combat?.reload() ?? false,
      forceHeat: (level, x, z) => {
        this.combat?.heat.forceHeat(
          level,
          x !== undefined && z !== undefined ? { x, y: 0, z } : null,
        );
      },
      commitCrime: (id, x, z) =>
        this.combat?.commitCrime(id as import('../crime/CrimeDefinition').CrimeId, {
          x,
          y: this.runtime.heightAt(x, z),
          z,
        }) ?? 0,
      reportCrime: (o) => {
        this.combat?.witnessed({
          eventId: o.eventId,
          crime: o.crime as import('../crime/CrimeDefinition').CrimeId,
          at: { x: o.x, y: 0, z: o.z },
          observerId: 'test',
          confidence: o.confidence,
          identified: o.identified,
          distanceToHelp: o.distanceToHelp,
          canReachHelp: o.canReachHelp,
        });
      },
      advanceCombat: (seconds) => {
        this.combat?.update(seconds);
        this.corps?.advance(seconds);
      },
      officers: () =>
        this.combat?.police.all.map((u) => {
          const at = this.corps?.positionOf(u.id) ?? { x: 0, z: 0 };
          return {
            id: u.id,
            state: u.state as string,
            x: at.x,
            z: at.z,
            goalX: u.goal?.x ?? null,
            goalZ: u.goal?.z ?? null,
          };
        }) ?? [],
      surrender: () => this.combat?.surrender() ?? false,
      composureOf: (npcId) => this.composure.get(npcId) ?? 1,
      setCombatOption: (key, value) => {
        this.settings.setCombatOption(
          key as 'aimAssist' | 'cameraShake' | 'flashes' | 'combatDifficulty',
          value,
        );
        this.applyCombatSettings();
      },

      // ---- Phase 10 ---------------------------------------------------------
      awaitFlight: async () => {
        await this.ensureFlight();
        return this.flightSnapshot();
      },
      flightState: () => this.flightSnapshot(),
      boardPlane: () => this.flight?.board() ?? false,
      leavePlane: () => this.flight?.leave() ?? false,
      setThrottle: (v) => {
        this.flightThrottle = Math.max(0, Math.min(1, v));
      },
      setFlightAssist: (level) => {
        this.flight?.setAssist(level === 'reduced' ? 'reduced' : 'assisted');
      },
      /**
       * Fly for `seconds` with a fixed stick. Feeds the *director*, not the
       * model, so the boundary, the captions and the recovery all run — the
       * Phase 9 lesson about `setAiming` writing past the frame loop.
       */
      flyFor: (seconds, stick) => {
        const flight = this.flight;
        if (!flight) return;
        const steps = Math.max(1, Math.round(seconds * 60));
        for (let i = 0; i < steps; i++) {
          flight.update(1 / 60, {
            pitch: stick.pitch ?? 0,
            roll: stick.roll ?? 0,
            yaw: stick.yaw ?? 0,
            throttle: stick.throttle ?? 0,
            brake: stick.brake ?? false,
          });
        }
        this.updateFlight(0);
      },
      placePlane: (x, z, facing, aboveGround) => {
        this.flight?.model.placeAt(x, z, facing, aboveGround ?? 0);
      },
    };
  }

  /**
   * What the pause menu reads.
   *
   * `saveWithRollback` rather than a bare write, because that is the path the
   * desk in the family home already uses and the one that keeps a readable
   * backup if the write fails halfway.
   */
  private pauseDeps(): import('../ui/PauseMenu').PauseDeps {
    return {
      slots: async () => {
        const list = await this.saves.listSlots();
        return list.map((s) => ({
          slot: s.slot,
          exists: s.exists,
          ageYears: s.ageYears,
          mode: s.mode,
          savedAt: s.savedAt,
          // `listSlots` reports a slot it could not read as existing with no
          // detail. Surfacing that as "damaged" rather than as "empty" is the
          // difference between a player knowing a run is gone and wondering.
          damaged: s.exists && s.ageYears === undefined,
        }));
      },
      save: async (slot) => {
        const parsed = SaveService.parseSlot(slot);
        return parsed ? this.saveWithRollback(parsed) : false;
      },
      load: async (slot) => {
        const parsed = SaveService.parseSlot(slot);
        if (!parsed) return false;
        const read = await this.saves.load(parsed);
        if (!read.ok) return false;
        this.applySave(read.data);
        return true;
      },
      resume: () => this.hud.openPause(false),
      openSettings: () => {
        this.hud.openPause(false);
        this.hud.openInfoPanel();
      },
      toast: (title, body) => this.hud.showToast(title, body),
    };
  }

  /** One line on how somebody feels about you, from the trust axis. */
  private static describeTrust(trust: number): string {
    if (trust >= 0.75) return 'knows you well';
    if (trust >= 0.45) return 'friendly';
    if (trust >= 0.15) return 'getting to know you';
    if (trust > -0.15) return 'an acquaintance';
    return 'wary of you';
  }

  /**
   * What the phone reads.
   *
   * A narrow interface rather than a handle on the game, the same shape
   * `SettingsPanel` and `CombatDirector` take. The phone owns none of this
   * data — it is `TaskSystem`, `Relationships` and `VehicleRegistry` with the
   * wording done here, where the vocabulary already lives.
   */
  private phoneDeps(): import('../ui/Phone').PhoneDeps {
    return {
      jobs: () => {
        const active = this.tasks.active;
        return jobIds().map((id) => {
          const def = taskDef(id);
          return {
            id,
            name: def?.name ?? id,
            summary: def?.summary ?? '',
            pay: def?.basePay ?? 0,
            done: this.tasks.completionsOf(id),
            active: active?.def.id === id,
          };
        });
      },
      contacts: () => {
        // Only people actually met. An address book pre-filled with strangers
        // is a list, not a relationship.
        const out: Array<{ id: string; name: string; note: string }> = [];
        for (const npc of this.population?.namedList() ?? []) {
          const id = npc.definition?.id ?? npc.id;
          if (!this.relationships.has(id)) continue;
          const r = this.relationships.get(id);
          out.push({
            id,
            name: npc.definition?.displayName ?? id,
            note: Game.describeTrust(r.trust ?? 0),
          });
        }
        return out;
      },
      vehicles: () =>
        this.garage.owned().map((v) => ({
          id: v.id,
          name: v.kind,
          // The registry knows one thing about where a vehicle is that the
          // player cares about from a phone: whether it is in the pound.
          // Flipped and submerged are recovered by walking up to it.
          status: v.impounded ? 'in the pound' : `parked · ${v.zone.replace(/_/g, ' ')}`,
          recoverable: v.impounded,
        })),
      recoverVehicle: (id) => this.recoverVehicle(id),
      openMap: () => {
        this.hud.openPhone(false);
        this.hud.openMap(true);
      },
      openJournal: () => {
        this.hud.openPhone(false);
        this.panels?.openJournal(true, this.director?.journal() ?? []);
      },
      money: () => this.economy.wallet.cash,
      toast: (title, body) => this.hud.showToast(title, body),
      ready: () => loadTasks(),
    };
  }

  /** Flying, flattened for the bridge. Never a handle on the director. */
  private flightSnapshot(): import('./TestMode').FlightSnapshotData {
    const f = this.flight;
    const s = f?.snapshot() ?? null;
    const v = f?.verdict ?? null;
    return {
      loaded: f !== null,
      riding: f?.riding ?? false,
      x: s?.position.x ?? 0,
      y: s?.position.y ?? 0,
      z: s?.position.z ?? 0,
      yaw: s?.yaw ?? 0,
      pitch: s?.pitch ?? 0,
      roll: s?.roll ?? 0,
      airspeed: s?.airspeed ?? 0,
      verticalSpeed: s?.verticalSpeed ?? 0,
      altitudeAgl: s?.altitudeAgl ?? 0,
      throttle: s?.throttle ?? 0,
      onGround: s?.onGround ?? true,
      stalled: s?.stalled ?? false,
      stallWarning: s?.stallWarning ?? false,
      assist: s?.assist ?? 'assisted',
      boundaryZone: v?.zone ?? 'inside',
      boundaryReason: v?.reason ?? null,
      boundaryPressure: v?.pressure ?? 0,
      boundaryCaption: v?.caption ?? '',
      recoveries: this.flightState.recoveries,
    };
  }

  /** The combat systems, flattened for the bridge. Never a handle on them. */
  private combatSnapshot(): import('./TestMode').CombatSnapshot {
    const c = this.combat;
    const belief = c?.heat.belief ?? null;
    const stats = c?.police.stats;
    return {
      loaded: c !== null,
      heat: c?.heat.heat ?? 0,
      level: this.combatState.heatLevel,
      wanted: this.combatState.wanted,
      finesOwed: this.combatState.finesOwed,
      arrests: c?.heat.arrests ?? 0,
      belief: belief
        ? { x: belief.at.x, z: belief.at.z, age: belief.age, source: belief.source }
        : null,
      weapon: c?.weapons.equipped.id ?? 'unarmed',
      stance: c?.weapons.stance ?? 'holstered',
      rounds: c?.weapons.rounds ?? 0,
      reserve: c?.weapons.reserve ?? 0,
      spread: c?.weapons.spread ?? 0,
      owned: c?.carried ?? [],
      officers: stats?.officers ?? 0,
      pursuing: stats?.pursuing ?? 0,
      searching: stats?.searching ?? 0,
      reportsDelivered: c?.heat.reportsDelivered ?? 0,
      duplicatesIgnored: c?.heat.duplicatesIgnored ?? 0,
      inSafeZone: this.inSafeZone(),
      options: {
        aimAssist: this.settings.current.aimAssist,
        cameraShake: this.settings.current.cameraShake,
        flashes: this.settings.current.flashes,
        combatDifficulty: this.settings.current.combatDifficulty,
      },
    };
  }

  /** The story, flattened for the bridge. Never a handle on the systems. */
  private storyState() {
    return {
      loaded: this.director !== null,
      chapter: this.storyClock.chapter,
      completedChapters: [...this.completedChapters].sort(),
      flags: [...this.story.flags].sort(),
      choices: Object.fromEntries(this.story.choices),
      reputation: { ...this.story.reputation },
      endingId: this.story.endingId,
      reel: this.story.reel.length,
      active: (this.director?.quests.activeQuests() ?? []).map((q) => q.id),
      completed: this.story.allRuns.filter((r) => r.state === 'completed').map((r) => r.id),
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
      this.hud.infoOpen ||
      this.hud.wardrobeOpen ||
      (this.panels?.dialogueOpen ?? false) ||
      (this.panels?.journalOpen ?? false) ||
      (this.panels?.reelOpen ?? false) ||
      this.storyBlocking ||
      this.sleeping ||
      this.transitioning;
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

    // 5c. the journal. Rebuilt on opening rather than kept live: it is a
    //     snapshot of what you are in the middle of, and nobody reads it
    //     while it changes underneath them.
    if (this.input.consumeJournal() && this.panels) {
      const open = !this.panels.journalOpen;
      this.panels.openJournal(open, open ? (this.director?.journal() ?? []) : []);
    }
    if (this.input.consumePhone()) this.hud.togglePhone();

    this.hud.setWallet(this.economy.wallet.cash);

    // 6. radar — hidden indoors, where it has nothing useful to show
    this.minimap.setVisible(!this.indoors);
    if (!this.indoors) {
      this.minimap.update(dt, this.player.position, this.player.controller.facing);
    }

    // 7. interactables, and the running job
    //
    // `collect` objectives are re-read off the bag every frame rather than
    // pushed at each source. Items arrive from a shop, a pickup, a reward and
    // a save restore, and wiring four call sites is four chances to miss one
    // -- while the truth of "carry three boxes" is just how many you hold.
    if (this.tasks.active) {
      this.tasks.advance(dt);
      this.syncTaskProgress();
    }
    this.updateInteraction(dt);

    // 7b. the story, after interactions so a counter used this frame has
    //     already been reported, and before physics so a scene that takes the
    //     camera does it on the frame the stage changed rather than the next.
    this.reportDriving();
    this.updateStory(dt);

    // 7c. weapons and the police. After the story, because a cutscene is a
    //     safe zone and the weapon has to be put away before anything can be
    //     fired; before physics, so an officer's position this frame is the
    //     one the pursuit was computed against.
    this.updateCombat(dt);
    this.updateFlight(dt);

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
    // `id: 0` marks "not a traffic vehicle" — the field exists so a test can
    // follow one car across frames, and nothing here is one.
    const obstacles: Array<{ id: number; x: number; z: number; radius: number }> = [];
    for (const proxy of this.vehicleProxies.values()) {
      obstacles.push({ id: 0, x: proxy.position.x, z: proxy.position.z, radius: 2.4 });
    }
    if (!this.riding && !this.indoors) {
      obstacles.push({ id: 0, x: this.player.position.x, z: this.player.position.z, radius: 0.8 });
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
            onWitness: (w) => this.onWitness(w),
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

    const built = this.interiors?.active ?? null;
    if (built) {
      // Indoors, the room is the only thing in reach. Registering the outdoor
      // doors as well would put a prompt for a house 600 m below your feet in
      // the selector, because range is measured horizontally.
      for (const it of interiorInteractables(built.points, built.exit, this.interactionHandlers)) {
        this.interactions.register(it);
      }
      return;
    }

    for (const it of worldInteractables(this.runtime.interactables, this.interactionHandlers)) {
      this.interactions.register(it);
    }
    for (const id of this.vehicles.keys()) this.registerVehicleInteractable(id);
    this.registerNpcInteractables();
  }

  /**
   * Link every door in the active zone to the interior behind it.
   *
   * Rebuilt with the zone, and the previous zone's links dropped first, so a
   * door in the village can never be opened from the city.
   */
  private syncDoorLinks(): void {
    // No registry yet means nobody has opened a door, and `ensureKit` calls
    // this again the moment one does.
    if (!this.interiors) return;
    const zone = this.zones.activeZoneId ?? 'village_coast';
    this.interiors.clearZone(zone);
    for (const it of this.runtime.interactables) {
      this.interiors.linkDoor({
        id: it.doorId,
        zone,
        interiorId: it.service,
        position: it.position.clone(),
        label: it.prompt,
      });
    }
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

    // The story gets first refusal. A resident who is part of the current
    // stage opens the authored tree in the panel; everyone else falls through
    // to Phase 6's small talk, which is still the right thing for a passer-by.
    const turn = this.director?.dialogueFor(npcId) ?? null;
    if (turn) {
      this.showDialogueTurn(turn, def.displayName);
      return;
    }

    // Not a story conversation, but the objective still counts: a stage that
    // asks you to talk to somebody is satisfied by talking to them.
    this.director?.report({ kind: 'talk', npcId });

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
   * Draw one turn, and wire what the buttons do.
   *
   * `Game` owns the wiring rather than the HUD because taking a choice has
   * consequences — relationship effects, recorded decisions, quest branches —
   * and those belong to the director. The HUD is handed strings and a
   * callback; it has never heard of a stage.
   */
  private showDialogueTurn(
    turn: import('../story/DialogueRunner').DialogueTurn,
    speakerName: string,
  ): void {
    this.input.releaseAll();
    this.panels?.setDialogueHistory(this.director?.dialogue.history ?? []);
    this.panels?.showDialogue(turn, this.speakerLabel(turn.speaker, speakerName), (index) => {
      const next = this.director?.choose(index) ?? null;
      if (next) this.showDialogueTurn(next, speakerName);
      else this.panels?.closeDialogue();
    });
  }

  /** `narrator` and `player` are voices, not residents. */
  private speakerLabel(speaker: string, fallback: string): string {
    if (speaker === 'narrator') return '';
    if (speaker === 'player') return 'You';
    return this.population?.namedById(speaker)?.definition?.displayName ?? fallback;
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

    // Taking something that is not yours. The one crime the game could already
    // commit before this phase existed — `VehicleRegistry` has tracked
    // ownership since Phase 5 and nothing was reading it.
    //
    // Loaded lazily and deliberately *after* the player is in the seat: the
    // import must not delay getting into a car, and a crime that is recorded a
    // frame late is still recorded.
    const record = this.garage.get(id);
    if (record && !record.owned) {
      const at = controller.position(new THREE.Vector3());
      void this.ensureCombat().then(() => {
        this.combat?.commitCrime('vehicle_theft', { x: at.x, y: at.y, z: at.z });
      });
    }
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

    // Leaving a vehicle somewhere *is* parking, and this is the only moment
    // that means it. Measured from the vehicle rather than the player, because
    // you can step away from a correctly parked van.
    const parked = controller.position(this.seatPos);
    this.director?.reportParked(parked.x, parked.z);
    this.lastVehiclePos = null;

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

  /** The seat the player is on, or was last on. */
  private seatPoint: BuiltPoint | null = null;

  /**
   * Take the chair, or leave it.
   *
   * Sitting snaps onto the seat rather than blending, because a spring toward
   * the seat with collision still running just wedges the capsule in the desk.
   *
   * Standing steps 0.9 m back along the *opposite* of the seat's facing rather
   * than a fixed offset. With one chair in one room a constant worked; with
   * seats in four rooms facing four ways it walks you into a wall.
   */
  private sit(on: boolean, point?: BuiltPoint): void {
    const seat = point ?? this.seatPoint;
    if (!seat) return;

    if (on) {
      this.seatPoint = seat;
      const facing = seat.facing ?? Math.PI;
      this.player.motor.teleport(seat.world.x, seat.world.y - 0.4, seat.world.z);
      this.player.controller.facing = facing;
      this.player.setSitting(true);
      this.camera.resetBehind(this.player.lookTarget, facing + Math.PI * 0.25);
      this.camera.setDistance(2.6);
      this.hud.setPrompt('Stand up');
    } else {
      const facing = seat.facing ?? Math.PI;
      this.player.setSitting(false);
      this.player.motor.teleport(
        seat.world.x - Math.sin(facing) * 0.9,
        seat.world.y - 0.4,
        seat.world.z - Math.cos(facing) * 0.9,
      );
      this.camera.setDistance(2.3);
      this.hud.setPrompt(null);
      this.seatPoint = null;
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

  /**
   * The kit, fetched the first time somebody opens a door.
   *
   * 145 kB that only matters once you go inside, and this transition already
   * fades to black — so the wait is hidden for the player who does and never
   * paid by the player who does not.
   */
  /** Buy a vehicle: register it owned, and put it outside the garage. */
  private purchaseVehicle(kind: string): boolean {
    const zone = this.zones.activeZoneId ?? 'village_coast';
    const ctx = this.interiors?.returnContext ?? null;
    // Delivered to the garage's own spot if it has one, otherwise onto the
    // pavement outside the door the player came in through. Never next to the
    // player: they are 600 m up in a room at this moment.
    const at = this.garage.garageFor(zone)?.transform ?? {
      x: (ctx?.x ?? this.runtime.spawn.x) + 3,
      y: ctx?.y ?? this.runtime.spawn.y,
      z: ctx?.z ?? this.runtime.spawn.z,
      facing: 0,
    };
    const id = `owned_${kind}_${this.garage.size + 1}`;
    this.garage.register({
      id,
      kind,
      zone,
      transform: at,
      owned: true,
      locked: false,
      impounded: false,
    });
    this.garageSelection = id;
    return true;
  }

  private async ensureKit(): Promise<boolean> {
    if (!this.assetManager) return false;

    if (!this.interiorApi) {
      // The code and the art in parallel: neither depends on the other, and
      // this is the one moment in the session that pays for both. The task
      // catalogue joins them because a counter behind this door can start a
      // shift, and a shift needs its definition to exist by then.
      const [api, kit] = await Promise.all([
        import('../world/interiors/InteriorSubsystem'),
        this.assetManager.loadInteriorKit(),
        loadTasks(),
      ]);
      this.interiorApi = api;
      this.interiors = new api.InteriorRegistry();
      this.interiors.portalMaterial = this.portal.material;
      this.interiors.setKit(kit);
      // Links were collected while the registry did not exist yet.
      this.syncDoorLinks();
    } else if (!this.interiors!.hasKit) {
      this.interiors!.setKit(await this.assetManager.loadInteriorKit());
    }

    return this.interiors?.hasKit === true;
  }

  /**
   * Go through a door.
   *
   * The return context is captured from the player's *current* position and
   * handed to the registry before anything moves. Reading it back afterwards
   * is how you come out of the wrong door.
   */
  private async enterInterior(doorId?: string): Promise<void> {
    if (this.transitioning || this.indoors) return;

    const id = doorId ?? this.nearestDoorId();
    if (!id) return;

    this.transitioning = true;
    try {
      const hour = this.env.time * 24;

      // Hours are checked *before* the subsystem loads. They live in the eager
      // half precisely so bouncing off a shut shop costs no download.
      const service = this.runtime.interactables.find((it) => it.doorId === id)?.service;
      if (service && !isOpenAt(SERVICE_HOURS[service], hour)) {
        const opens = SERVICE_HOURS[service];
        this.hud.showToast(
          DOOR_NAMES[service],
          opens ? `Closed. Opens at ${formatHour(opens.open)}.` : 'Closed.',
        );
        return;
      }

      // Fade *before* fetching, not after.
      //
      // The whole argument for the interior subsystem and the kit being lazy
      // is that the download hides behind a transition the player is already
      // waiting through. That is only true if the screen goes black first —
      // otherwise the first doorway of a session visibly stalls, and the
      // justification is a comment rather than a fact.
      const firstEntry = this.interiors?.hasKit !== true;
      if (firstEntry) {
        this.hud.setPrompt(null);
        this.input.releaseAll();
        await this.hud.setFade(true, 0.75);
      }

      if (!(await this.ensureKit())) {
        this.hud.showToast('Locked', 'The door will not budge.');
        if (firstEntry) await this.hud.setFade(false, 0.5);
        return;
      }

      const link = this.interiors?.door(id);
      const def = link ? this.interiors?.definition(link.interiorId) : null;

      const result = this.interiors!.open({
        doorId: id,
        hour,
        from: {
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
          facing: this.player.controller.facing,
        },
        decor: this.decorFor(link?.interiorId ?? ''),
      });

      if (!result.ok) {
        // Graceful closed state: the door tells you when to come back rather
        // than doing nothing and reading as a broken prompt.
        if (result.reason === 'closed') {
          this.hud.showToast(result.name, `Closed. Opens at ${result.opensAt}.`);
        } else if (result.reason === 'no-kit') {
          this.hud.showToast('Locked', 'The door will not budge.');
        }
        if (firstEntry) await this.hud.setFade(false, 0.5);
        return;
      }

      this.enterBuiltInterior(result.interior);
      // Already black on the first entry, so do not fade out twice.
      await this.transit(
        result.interior.spawn,
        result.interior.spawnFacing,
        true,
        firstEntry ? 0 : 0.75,
      );
      this.hud.showToast(def?.name ?? 'Inside', this.interiorGreeting(result.interior));
    } finally {
      this.transitioning = false;
    }
  }

  /** Attach a freshly built room to the scene, collision, audio and prompts. */
  private enterBuiltInterior(built: NonNullable<InteriorRegistry['active']>): void {
    this.scene.add(built.group);
    this.runtime.collision.setOverlay(built.colliders);
    this.audio.setInteriorProfile(built.def.audio);
    this.audio.setZone('indoor');

    // Where this room appears to sit when you look out of its windows. Only
    // the two hero interiors render a live view, but the anchor is cheap and
    // setting it unconditionally keeps the two paths identical.
    const view = new THREE.Vector3(12.5, 0, 30);
    view.y = this.runtime.heightAt(view.x, view.z);
    this.portal.setAnchor(built.origin, view, 0);

    this.syncInteractables();
  }

  private interiorGreeting(built: NonNullable<InteriorRegistry['active']>): string {
    const money = this.economy.wallet.cash;
    switch (built.def.service) {
      case 'grocery':
        return `Shelves are stocked. You have $${money}.`;
      case 'police':
        return 'The desk sergeant looks up.';
      case 'clinic':
        return 'Quiet. Somebody will see you shortly.';
      case 'garage':
        return 'Smell of oil and warm metal.';
      case 'cafe':
        return 'Coffee, and somebody else’s conversation.';
      case 'clothing':
        return 'Racks, and a mirror at the back.';
      case 'airstrip':
        return 'The radio crackles. No aircraft yet.';
      case 'apartment':
        return 'Yours, more or less.';
      default:
        return 'Quiet in here.';
    }
  }

  private async exitInterior(): Promise<void> {
    if (this.transitioning || !this.indoors) return;
    this.transitioning = true;
    try {
      const built = this.interiors?.active ?? null;
      if (built) {
        this.scene.remove(built.group);
        this.runtime.collision.setOverlay(null);
        this.audio.setInteriorProfile(null);
      }
      // A shift you walk out of is a shift you abandoned.
      if (this.tasks.active) this.tasks.fail('abandoned');

      const ctx = this.interiors?.close() ?? null;
      this.seatPoint = null;
      const to = ctx
        ? new THREE.Vector3(ctx.x, ctx.y, ctx.z)
        : this.runtime.spawn.clone();
      await this.transit(to, ctx?.facing ?? this.runtime.spawnFacing, false);
      this.syncInteractables();
    } finally {
      this.transitioning = false;
    }
  }

  /** The door the player is standing at, for the test bridge and fallbacks. */
  private nearestDoorId(): string | null {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const it of this.runtime.interactables) {
      const d = Math.hypot(
        it.position.x - this.player.position.x,
        it.position.z - this.player.position.z,
      );
      if (d < bestDist) {
        bestDist = d;
        best = it.doorId;
      }
    }
    return bestDist <= 6 ? best : null;
  }

  private decorFor(interiorId: string): Map<string, KitPart> {
    const placed = this.decor.get(interiorId);
    const out = new Map<string, KitPart>();
    if (!placed) return out;
    for (const [slot, item] of placed) out.set(slot, this.interiorApi!.DECOR_PARTS[item]);
    return out;
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

    const built = this.interiors?.active ?? null;
    const bedPoint = built?.points.find((p) => p.kind === 'bed');
    if (!built || !bedPoint) {
      this.sleeping = false;
      return;
    }

    // Lie down on the mattress and frame it from the side. This is the *feet*
    // position: tipping onto the back swings the head about 1.36 m along -Z,
    // so facing must stay at 0 for the head to land on the pillow. Every bed
    // in the kit is placed at yaw 0 with its headboard at -Z, which is what
    // makes one offset correct for all of them.
    this.player.motor.teleport(bedPoint.world.x, built.origin.y + 0.56, bedPoint.world.z + 0.9);
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

    // Rent falls due while you sleep, which is both realistic and the only
    // moment the player is reliably standing in the flat they rent.
    this.chargeRentIfDue(built.def.service === 'apartment');

    // Get up at the entry spawn. It is the one spot in the room the layout
    // validator guarantees is clear, and a hand-picked bedside offset is a
    // hand-picked chance to stand somebody inside a wardrobe.
    this.player.setLying(false);
    this.player.motor.teleport(built.spawn.x, built.spawn.y, built.spawn.z);
    this.player.controller.facing = built.spawnFacing;
    this.camera.resetBehind(this.player.lookTarget, built.spawnFacing);
    this.camera.setDistance(2.3);
    this.stepQuiet();

    await this.hud.setFade(false, 1.5);
    this.sleeping = false;
    this.hud.showToast('Morning', 'You slept until the light came back.');
  }

  /** A shower: cleanliness, a little mood, no transition. */
  private shower(): void {
    this.needs.shower();
    this.hud.showToast('Better', 'Clean clothes and a clear head.');
  }

  private chargeRentIfDue(inApartment: boolean): void {
    if (!inApartment) return;
    const day = this.worldClock.day;
    if (this.economy.rentDue(day, RENT_PERIOD_DAYS) <= 0) return;

    const r = this.economy.chargeRent(day, RENT_PERIOD_DAYS, SERVICE_FEES.rent, Date.now());
    if (r.ok) {
      this.hud.showToast('Rent', `Paid $${-r.transaction.amount}.`);
    } else {
      this.hud.showToast('Rent overdue', `You owe $${SERVICE_FEES.rent}. Find the money.`);
    }
  }

  // ---- services and tasks --------------------------------------------------

  /**
   * The host `ServiceSystem` executes against.
   *
   * Rebuilt per call rather than held, because half of it — the age, the
   * clock, whether the shop is open — is only true for an instant.
   */
  private serviceHost(): ServiceHost {
    const built = this.interiors?.active ?? null;
    const owned = [...this.garage.owned()].map((r) => ({
      id: r.id,
      kind: r.kind,
      condition: r.condition,
      label: r.kind,
    }));
    const selected = owned.find((v) => v.id === this.garageSelection) ?? owned[0] ?? null;

    return {
      economy: this.economy,
      inventory: this.inventory,
      needs: this.needs,
      age: this.life.ageYears,
      now: Date.now(),
      service: built?.def.service ?? 'home',
      // Already inside, so the hours question is only about the counter --
      // and a place with no hours at all is always serving.
      open:
        built !== null &&
        (built.def.hours === null ||
          (this.interiors?.isDoorOpen(
            this.interiors.returnContext?.doorId ?? '',
            this.env.time * 24,
          ) ??
            false)),
      selectedVehicle: selected,
      ownedVehicles: owned,
      buyVehicle: (kind) => this.purchaseVehicle(kind),
      repairVehicle: (id) => this.garage.repair(id) >= 0,
      recolourVehicle: (id) => this.garage.get(id) !== null,
      // The full path, not a bare record move: it also rights the live body
      // and puts the player out of it if they were sitting in the thing.
      recoverVehicle: (id) => this.recoverVehicle(id),
      selectVehicle: (id) => {
        this.garageSelection = id;
        return true;
      },
      sleep: () => void this.sleep(),
      shower: () => this.shower(),
      saveGame: () => void this.saveWithRollback('autosave'),
      placeDecor: (itemId) => this.placeDecor(itemId),
      talk: (topic) => {
        const live = this.policeDeskTopic(topic);
        this.hud.showToast('Talk', live ?? TOPIC_LINES[topic] ?? '…');
      },
      startTask: (taskId) => this.startTask(taskId),
      treat: () => this.hud.showToast('Clinic', 'Patched up and sent on your way.'),
    };
  }

  // -------------------------------------------------------------------------
  // The authored story
  // -------------------------------------------------------------------------

  /**
   * Bring the story in, once.
   *
   * Lazy for the reason everything else in this repository is lazy: a Free
   * Roam player never needs 35 quests, 15 dialogue trees and a canvas
   * renderer. Story Mode reaches this behind the mode selector's own loading
   * screen, so the download sits in a gap the player is already waiting
   * through -- the same argument the interior kit rides on.
   */
  private ensureStory(): Promise<void> {
    if (this.director) return Promise.resolve();
    if (this.storyLoading) return this.storyLoading;

    // The catalogue rides along: a chapter-2 stage is a *real* grocery shift,
    // so `work_shift` cannot resolve before the definitions exist.
    this.storyLoading = Promise.all([import('../story/StorySubsystem'), loadTasks()]).then(([api]) => {
      this.storyApi = api;
      this.director = new api.StoryDirector(this.story, this.storyDirectorHost());
      this.panels = new api.StoryPanels();
      this.gameScope.addTeardown(
        this.panels.wire({
          onLeaveDialogue: () => {
            this.director?.dialogue.end();
            this.panels?.closeDialogue();
          },
          onSaveReel: () => void this.saveReel(),
        }),
      );
      this.director.afterRestore();
    });
    return this.storyLoading;
  }

  /**
   * Everything the director cannot know on its own.
   *
   * Rebuilt once and held, unlike `serviceHost()`: the director keeps a
   * reference for the life of the run and every field here is either a getter
   * or a call, so nothing goes stale.
   */
  private storyDirectorHost(): import('../story/StoryDirector').StoryDirectorHost {
    // The four live values are read through arrow functions rather than by
    // aliasing `this` into the literal: a getter's `this` is the literal, not
    // the class, so it has to close over something. Arrows capture the class
    // scope for free.
    const age = () => this.life.ageYears;
    const money = () => this.economy.wallet.cash;
    const mode = () => this.mode;
    const chapter = () => this.storyClock.chapter;

    return {
      get age() {
        return age();
      },
      get money() {
        return money();
      },
      get mode() {
        return mode();
      },
      get chapter() {
        return chapter();
      },
      relationship: (id) => this.relationships.get(id),
      adjustRelationship: (id, axes) => this.relationships.adjust(id, axes),
      unlockZone: (zone) => {
        this.unlockedZones.add(zone);
      },
      completeChapter: (id) => {
        this.completedChapters.add(id);
      },
      /**
       * Pay a quest reward.
       *
       * Money goes through `Economy.award` with the quest's own key, so the
       * economy's idempotency and the story's agree rather than being two
       * separate opinions. A reward that cannot fit in the bag returns false
       * and the director releases the key, so it can be paid later.
       */
      grant: (reward, key) => {
        for (const item of reward.items ?? []) {
          if (this.inventory.add(item.id, item.count).added < item.count) return false;
        }
        if (reward.money) {
          this.economy.award(key, reward.money, 'Story reward', Date.now());
        }
        this.syncTaskProgress();
        return true;
      },

      toast: (title, body) => this.hud.showToast(title, body),
      setObjective: (text) => this.hud.setObjective(text),
      npcName: (id) => this.population?.namedById(id)?.definition?.displayName ?? id,
      activeZone: () => this.zones.activeZoneId,
      interiorPoint: (name) => {
        // `world`, not the layout-space position: the interior cell sits 600 m
        // above the terrain and a distance check against local coordinates
        // would place every room at the origin.
        const point = this.interiors?.active?.points.find((p) => p.id === name);
        return point ? { x: point.world.x, y: point.world.y, z: point.world.z } : null;
      },
      holds: (itemId) => this.inventory.count(itemId),
      // `Inventory.remove` is all-or-nothing and says so with a boolean, which
      // is the behaviour a delivery wants: handing over two of three parcels
      // is not a partial delivery, it is a mistake.
      take: (itemId, count) => {
        const ok = this.inventory.remove(itemId, count);
        if (ok) this.syncTaskProgress();
        return ok;
      },

      // -- cutscene host ----------------------------------------------------
      place: (name) => this.director?.resolvePlace(name) ?? null,
      playerPosition: () => this.player.position,
      npcPosition: (id) => this.population?.namedById(id)?.position ?? null,
      setCamera: (at, lookAt) => this.camera.placeAt(at, lookAt),
      releaseCamera: () => {
        this.camera.resetBehind(this.player.lookTarget, this.player.controller.facing);
      },
      setCaption: (text) => this.hud.setCaption(text),
      playGesture: (name) => this.player.playGesture(name),
      fade: (on, seconds) => this.hud.setFade(on, seconds),
      setControlsEnabled: (on) => {
        this.storyBlocking = !on;
        if (!on) this.input.releaseAll();
      },
    };
  }

  /**
   * The story's frame.
   *
   * Runs after interactions so a counter used this frame has already been
   * reported, and before physics so a cutscene that takes the camera does it
   * in the same frame the stage changed rather than one later.
   */
  private updateStory(dt: number): void {
    const director = this.director;
    if (!director) return;

    director.update(dt);

    if (director.hasPendingScene && !this.transitioning) {
      void director.playPendingScene();
    }

    // `collect` objectives read off the bag every frame, for the reason Phase 7
    // gave: items arrive from a shop, a pickup, a reward and a save restore,
    // and wiring four sources is four chances to miss one.
    for (const view of director.quests.activeQuests()) {
      for (const o of view.objectives) {
        if (o.kind !== 'collect' || !o.itemId) continue;
        const held =
          o.itemId === 'keepsake'
            ? (this.village?.collectibles.count ?? 0)
            : this.inventory.count(o.itemId);
        director.quests.setProgress(view.id, o.id, held);
      }
    }
  }

  /**
   * What the reel is made of.
   *
   * Assembled from the systems that already own each fact rather than from a
   * running tally: the wallet knows the money, the garage knows the vehicles,
   * `Collectibles` knows the keepsakes. A second copy of any of them would be
   * a second copy that can be wrong.
   */
  private reelFacts(): import('../story/LifeReel').ReelFacts {
    const property: string[] = [];
    if (this.story.has('ch4_has_apartment')) property.push('Apartment');
    if (this.completedChapters.has('village_departure')) property.push('Family home');

    return {
      age: this.life.ageYears,
      money: this.economy.wallet.cash + this.economy.wallet.bank,
      shiftsWorked: jobIds().reduce((n, id) => n + this.tasks.completionsOf(id), 0),
      vehiclesOwned: this.garage.owned().length,
      keepsakes: this.village?.collectibles.count ?? 0,
      keepsakeTotal: this.village?.collectibles.total ?? 5,
      property,
      friends: this.director?.friends(this.relationships.toJSON()) ?? [],
      reputation: this.story.reputation,
    };
  }

  /** Open the reel, drawing straight onto the panel's canvas. */
  private openReel(): void {
    const director = this.director;
    if (!director || !this.storyApi) return;
    const model = director.reel(this.reelFacts());
    this.panels?.openReel(true, (ctx) => this.storyApi!.renderReel(ctx, model));
  }

  /**
   * Write the reel to a file, locally.
   *
   * `exportReel` renders the same model onto a detached canvas and hands back
   * a blob; `downloadReel` turns that into a click on an object URL. There is
   * no network call anywhere on this path and no upload service in the
   * repository, which is what the brief asks for.
   */
  private async saveReel(): Promise<void> {
    const director = this.director;
    if (!director || !this.storyApi) return;
    const model = director.reel(this.reelFacts());
    const blob = await this.storyApi.exportReel(model, () => document.createElement('canvas'));
    if (blob) this.storyApi.downloadReel(blob);
    else this.hud.showToast('Not saved', 'This browser would not give us a canvas.');
  }

  /** Metres covered, for `drive` objectives. Reads the live body, not input. */
  private reportDriving(): void {
    const riding = this.riding;
    const controller = riding ? this.vehicles.get(riding.id) : null;
    if (!controller || !this.director) {
      this.lastVehiclePos = null;
      return;
    }

    const now = controller.position(new THREE.Vector3());
    if (this.lastVehiclePos) {
      const moved = now.distanceTo(this.lastVehiclePos);
      // A teleport -- a reset, a recovery, a zone change -- is not driving.
      if (moved < 30) this.director.reportDriving(moved, controller.def.id);
    }
    this.lastVehiclePos = now;
  }

  // -------------------------------------------------------------------------
  // Weapons and the police
  // -------------------------------------------------------------------------

  /**
   * Bring the combat systems in, once.
   *
   * Lazy for the strongest reason in the project: **every player under
   * eighteen has no use for any of it**, and most players over eighteen never
   * draw anything. The 65 kB of weapon models are fetched alongside, on the
   * same first draw.
   */
  /**
   * Bring flying in, once.
   *
   * The code and the art in parallel, the way `ensureKit` does it: neither
   * depends on the other and this is the one moment that pays for both. A
   * player who never walks out to the airstrip never reaches this at all.
   */
  private ensureFlight(): Promise<void> {
    if (this.flight) return Promise.resolve();
    if (this.flightLoading) return this.flightLoading;

    this.flightLoading = Promise.all([
      import('../flight/FlightSubsystem'),
      this.assetManager?.loadAircraft() ?? Promise.resolve(new Map<string, THREE.Object3D>()),
    ]).then(([api, models]) => {
      this.flight = new api.FlightDirector(this.flightState, {
        groundAt: (x, z) => this.runtime.heightAt(x, z),
        recover: (to) => this.recoverAircraft(to),
        say: (title, body) => this.hud.showToast(title, body),
        // Getter over an arrow function for the same reason the combat host
        // does it: a getter's `this` is the object literal, not the class.
        get blocked() {
          return blocked();
        },
      });
      this.buildPlaneVisual(models);
    });

    const blocked = () => this.storyBlocking || this.transitioning || this.sleeping;
    return this.flightLoading;
  }

  /** Put the aeroplane and its propeller in the scene, once. */
  private buildPlaneVisual(models: Map<string, THREE.Object3D>): void {
    const proto = models.get('Plane');
    if (!proto) return;
    const body = proto.clone(true);
    body.name = 'aircraft:plane';
    this.scene.add(body);
    this.planeMesh = body;
    this.gameScope.addTeardown(() => {
      body.removeFromParent();
    });

    const prop = models.get('Plane_Prop');
    if (prop) {
      const spinner = prop.clone(true);
      spinner.name = 'aircraft:prop';
      // Parented to the body, so it inherits the aeroplane's attitude and only
      // has to spin about its own axis.
      body.add(spinner);
      spinner.position.set(0, 0.02, 2.9);
      this.planeProp = spinner;
    }
  }

  /**
   * Put the aeroplane and the player back somewhere safe.
   *
   * The order is `performArrest`'s, for the same reason: fade first so nothing
   * is seen teleporting, move everything, then save. A recovery that saved
   * first would persist the state it was recovering from.
   */
  private async recoverAircraft(to: { x: number; y: number; z: number; facing: number }): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    await this.hud.setFade(true, 0.4);

    const ground = this.runtime.heightAt(to.x, to.z);
    this.player.motor.teleport(to.x, ground, to.z);
    this.player.controller.facing = to.facing;
    this.camera.resetBehind(this.player.position, to.facing);

    await this.hud.setFade(false, 0.4);
    this.transitioning = false;
  }

  /**
   * The flight frame.
   *
   * Nothing here loads the flight chunk on its own — it arrives when the
   * player asks to fly, and until then this is one null check.
   */
  private updateFlight(dt: number): void {
    const flight = this.flight;
    if (!flight) return;

    flight.update(dt, {
      pitch: flight.riding ? -this.input.move.y : 0,
      roll: flight.riding ? this.input.move.x : 0,
      yaw: 0,
      throttle: flight.riding ? this.flightThrottle : 0,
      brake: flight.riding && this.input.interactHeld,
    });

    const s = flight.snapshot();
    if (this.planeMesh) {
      this.planeMesh.position.set(s.position.x, s.position.y, s.position.z);
      // Yaw about up, then pitch, then roll about the nose. YXZ is the order
      // that reads as an aeroplane rather than as a gimbal.
      this.planeMesh.rotation.set(s.pitch, s.yaw, -s.roll, 'YXZ');
    }
    if (this.planeProp) this.planeProp.rotation.z = s.propRadians;

    // The player rides in the aeroplane rather than beside it.
    if (flight.riding) {
      this.player.motor.teleport(s.position.x, s.position.y - 0.6, s.position.z);
      this.player.controller.facing = s.yaw;
    }
  }

  /** Throttle is a held axis rather than a rate, so it lives on the game. */
  private flightThrottle = 0;

  private ensureCombat(): Promise<void> {
    if (this.combat) return Promise.resolve();
    if (this.combatLoading) return this.combatLoading;

    // A getter's `this` is the object literal, so the corps host closes over
    // this instead. Same shape as `storyDirectorHost`.
    const indoors = () => this.indoors;

    this.combatLoading = Promise.all([
      import('../combat/CombatSubsystem'),
      this.assetManager?.loadWeapons() ?? Promise.resolve(new Map<string, THREE.Object3D>()),
    ]).then(([api, models]) => {
      this.combatApi = api;
      this.weaponModels = models;
      // The corps before the director: the host reads `this.corps` and the
      // director calls the host during construction.
      this.corps = new api.OfficerCorps({
        heightAt: (x, z) => this.runtime.heightAt(x, z),
        occluded: (from, to) => {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dz = to.z - from.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 0.5) return false;
          _officerEye.set(from.x, from.y, from.z);
          _officerDir.set(dx / d, dy / d, dz / d);
          // The same collision proxy the player bumps into, shortened so a
          // wall an officer is leaning on does not blind them — exactly the
          // `- 0.35` `Population.occluded` uses, for the same reason.
          return this.runtime.collision.raycast(_officerEye, _officerDir, d - 0.4) !== null;
        },
        playerEye: () => {
          const p = this.player.lookTarget;
          return { x: p.x, y: p.y, z: p.z };
        },
        get playerIndoors() {
          return indoors();
        },
      });
      this.combat = new api.CombatDirector(this.combatState, this.combatHost());
      this.applyCombatSettings();
    });
    return this.combatLoading;
  }

  /** Push the accessibility options onto the director. */
  private applyCombatSettings(): void {
    const s = this.settings.current;
    this.combat?.configure({
      aimAssist: s.aimAssist,
      cameraShake: s.cameraShake,
      flashes: s.flashes,
      difficulty: s.combatDifficulty,
    });
  }

  /**
   * Everything the combat director cannot know on its own.
   *
   * The two methods worth reading are `targets` and `police.sees`. Between
   * them they are the whole of acceptance criterion 2 and the child rule:
   * nothing can be shot that is not in `targets`, and no officer learns a
   * position except through `sees`, which asks the same `Perception` layer
   * every shopkeeper uses.
   */
  private combatHost(): import('../combat/CombatDirector').CombatHost {
    const eye = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    // Live values through arrow functions rather than by aliasing `this`: a
    // getter's `this` is the literal, not the class. Same shape as
    // `storyDirectorHost`.
    const age = () => this.life.ageYears;
    const safe = () => this.inSafeZone();
    const driving = () => this.riding !== null;

    return {
      // -- WeaponHost -------------------------------------------------------
      get age() {
        return age();
      },
      get inSafeZone() {
        return safe();
      },
      reserveOf: (itemId) => this.inventory.count(itemId),
      takeAmmo: (itemId, count) => {
        const have = this.inventory.count(itemId);
        const take = Math.min(have, count);
        if (take > 0) this.inventory.remove(itemId, take);
        return take;
      },
      giveAmmo: (itemId, count) => {
        this.inventory.add(itemId, count);
      },

      // -- the player -------------------------------------------------------
      playerEye: () => {
        const p = this.player.lookTarget;
        return { x: p.x, y: p.y, z: p.z };
      },
      aimDirection: () => {
        this.camera.camera.getWorldDirection(dir);
        return { x: dir.x, y: dir.y, z: dir.z };
      },
      aimBasis: () => {
        this.camera.camera.getWorldDirection(dir);
        up.set(0, 1, 0);
        right.crossVectors(dir, up).normalize();
        up.crossVectors(right, dir).normalize();
        return {
          right: { x: right.x, y: right.y, z: right.z },
          up: { x: up.x, y: up.y, z: up.z },
        };
      },
      get playerDriving() {
        return driving();
      },

      // -- the world --------------------------------------------------------
      targets: () => this.shotTargets(),
      worldDistance: (from, direction, max) => {
        eye.set(from.x, from.y, from.z);
        dir.set(direction.x, direction.y, direction.z);
        const hit = this.runtime.collision.raycast(eye, dir, max);
        return hit ? hit.distance : Infinity;
      },
      applyImpact: (targetId, amount, from) => this.applyComposure(targetId, amount, from),
      spawnImpact: (at, struckWorld) => this.spawnImpact(at, struckWorld),
      emitPerception: (kind, at, loudness) => {
        this.population?.emit(
          kind as PerceptionKind,
          new THREE.Vector3(at.x, at.y, at.z),
          'player',
          loudness > 0 ? { loudness } : undefined,
        );
      },

      // -- police -----------------------------------------------------------
      police: {
        sees: (id) => this.corps?.sees(id) ?? null,
        positionOf: (id) => this.corps?.positionOf(id) ?? { x: 0, y: 0, z: 0 },
        moveTo: (id, to, speed) => this.corps?.moveTo(id, to, speed),
        halt: (id) => this.corps?.halt(id),
        hasVehicle: (id) => this.motorised(id),
        say: () => {},
        arrest: () => {},
        pathFailed: () => false,
      },
      spawnOfficer: (near) => this.corps?.spawn(near) ?? null,
      despawnOfficer: (id) => this.corps?.despawn(id),
      officerPositions: () => this.corps?.positions() ?? [],

      // -- presentation -----------------------------------------------------
      toast: (title, body) => this.hud.showToast(title, body),
      onArrest: () => void this.performArrest(),
      onRefusal: (reason) => this.reportWeaponRefusal(reason),
    };
  }

  /**
   * The combat frame: input, then systems, then the officers.
   *
   * Nothing here loads the combat chunk on its own. It arrives on the first
   * *deliberate* act — drawing a weapon or picking one up — so a player who
   * never does either never pays for any of it. Until then this is four
   * branches that all fall through.
   */
  private updateCombat(dt: number): void {
    // Drawing is the one input that can bring the systems in. Everything else
    // is ignored until they are here.
    if (this.input.consumeDraw()) {
      void this.ensureCombat().then(() => this.toggleDrawn());
    }

    // The one combat binding that works with nothing loaded, because it is a
    // camera preference rather than a combat action: a player who has never
    // held anything may still want the character on the other side of frame.
    if (this.input.consumeShoulderSwap()) this.camera.swapShoulder();

    const combat = this.combat;
    if (!combat) {
      this.camera.setAiming(false);
      return;
    }

    const slot = this.input.consumeWeaponSlot();
    if (slot >= 0) {
      const id = combat.carried[slot];
      if (id) combat.equip(id);
    }
    if (this.input.consumeReload()) combat.reload();

    // Aiming and firing are ignored while driving, indoors in a safe zone, or
    // while a panel owns the input — all of which `releaseAll` has already
    // dealt with by the time this runs.
    const canAct = this.riding === null && !this.storyBlocking;
    if (canAct) {
      combat.weapons.setAiming(this.input.aimHeld);
      if (this.input.fireHeld && combat.weapons.stance !== 'holstered') combat.fire();
    } else {
      combat.weapons.setAiming(false);
    }
    // The camera follows the weapon rather than the button, so a request the
    // system refused — indoors, holstered, mid-reload — does not pull the
    // camera in anyway. `WeaponSystem.aiming` is the one that was honoured.
    this.camera.setAiming(combat.weapons.aiming);

    combat.update(dt);
    this.corps?.advance(dt);
    this.syncHeldWeapon();
    this.player.controller.speedScale *= combat.weapons.moveScale;

    this.hud.setHeat(this.combatState.heatLevel);
    this.hud.setWeaponReadout({
      rounds: combat.weapons.rounds,
      reserve: combat.weapons.reserve,
      drawn: combat.weapons.stance !== 'holstered' && combat.weapons.equipped.conspicuous,
      aiming: combat.weapons.aiming,
      spread: combat.weapons.spread,
    });
  }

  /**
   * Somebody noticed something. Decide whether the police ever hear about it.
   *
   * This is the join between Phase 6's perception and Phase 9's Heat, and the
   * four judgements it makes are the whole of "police are not omniscient":
   *
   * - **Which crime is it?** Only events the crime table recognises count. A
   *   greeting or a collision is noticed and forgotten.
   * - **Could they identify anybody?** Sight above a confidence floor, yes.
   *   Hearing, never — somebody who heard a bang and saw nothing raises Heat
   *   but gives the police nowhere to look.
   * - **Can they reach help?** Indoors at night with the shops shut, no.
   * - **How far is help?** That is the call delay, and the player's chance to
   *   leave.
   */
  private onWitness(w: import('../npc/Perception').Witness): void {
    const combat = this.combat;
    const api = this.combatApi;
    if (!combat || !api) return;

    const crime = CRIME_BY_PERCEPTION[w.event.kind];
    if (!crime || !w.event.criminal) return;
    if (w.event.actor !== 'player') return;

    // The event id the crime was committed under. Without one this witness has
    // nothing to report *about*, which happens when a perception was raised
    // outside the crime path — a stray gunshot in a test, say.
    const eventId = combat.lastEventFor(crime);
    if (eventId === undefined) return;
    void api;

    const observer = this.population?.namedById(w.observerId);
    const help = observer ? this.distanceToHelp(observer.position) : 40;

    combat.witnessed({
      eventId,
      crime,
      at: w.event.at,
      observerId: w.observerId,
      confidence: w.perception.confidence,
      // Seeing it is what lets you say who. Hearing it is not.
      identified: w.perception.via === 'sight' && w.perception.confidence >= 0.35,
      distanceToHelp: help,
      canReachHelp: !!observer,
    });
  }

  /**
   * How far this witness has to go to tell somebody.
   *
   * The nearest police station door, or a long way if there is not one in this
   * zone. It is the only input to the call delay, and it is why a crime in a
   * back field takes longer to reach anybody than one outside the station.
   */
  private distanceToHelp(from: THREE.Vector3): number {
    const station = this.runtime.interactables.find((i) => i.service === 'police');
    if (!station) return 60;
    return Math.min(60, from.distanceTo(station.position));
  }

  /**
   * The two desk topics that read live state.
   *
   * Handled here rather than in `TOPIC_LINES` for exactly that reason: a
   * record with nothing on it and a record with four arrests on it are
   * different sentences, and a canned line would be wrong for one of them.
   * Returns null for anything else, so the canned lines still work.
   */
  private policeDeskTopic(topic: string): string | null {
    if (topic === 'record') {
      const owed = this.combatState.finesOwed;
      const arrests = this.combat?.heat.arrests ?? 0;
      const offences = this.combat?.heat.record.length ?? 0;
      if (offences === 0 && owed === 0) return 'Nothing on it. Keep it that way.';
      const parts: string[] = [];
      if (offences > 0) parts.push(`${offences} on record`);
      if (arrests > 0) parts.push(`${arrests} brought in`);
      if (owed > 0) parts.push(`$${owed} outstanding`);
      return parts.join(', ') + '.';
    }

    if (topic === 'impound') {
      const held = this.garage.all().filter((v) => v.impounded);
      if (held.length === 0) return 'Nothing of yours in the yard.';
      if (this.economy.wallet.cash < IMPOUND_FEE) {
        return `${held.length} in the yard. Release is $${IMPOUND_FEE}, and you are short.`;
      }
      const paid = this.economy.pay('fine', IMPOUND_FEE, 'Impound release', Date.now());
      if (!paid.ok) return 'That did not go through.';
      // `recover` is the release path: it clears `impounded` and puts the
      // vehicle back in a garage bay, which is exactly what collecting it from
      // the yard means. Phase 5 built it and nothing had reason to call it.
      this.garage.recover(held[0].id, 'impounded');
      return `Released. $${IMPOUND_FEE}.`;
    }

    return null;
  }

  /** Q: draw the last weapon, or put away what is drawn. */
  private toggleDrawn(): void {
    const combat = this.combat;
    if (!combat) return;
    if (combat.weapons.stance !== 'holstered') {
      combat.holster();
      return;
    }
    // Prefer the last firearm carried; fall back to hands, which is always
    // owned and always allowed.
    const firearm = combat.carried.find((id) => id !== 'unarmed');
    combat.equip(firearm ?? 'unarmed');
  }

  /**
   * Put the right model in the right hand, or none.
   *
   * Rebuilt only when the answer changes, not per frame: attaching to a socket
   * walks the skeleton, and doing that sixty times a second for an object that
   * has not moved is exactly the kind of cost Phase 6 found in the occlusion
   * raycast.
   */
  private syncHeldWeapon(): void {
    const combat = this.combat;
    if (!combat) return;

    const want =
      combat.weapons.stance !== 'holstered' && combat.weapons.equipped.conspicuous
        ? combat.weapons.equipped.id
        : null;
    const have = this.heldWeapon?.name ?? null;
    const wantName = want ? want.charAt(0).toUpperCase() + want.slice(1) : null;
    if (have === wantName) return;

    if (this.heldWeapon) {
      this.heldWeapon.removeFromParent();
      this.heldWeapon = null;
    }
    if (!wantName) return;

    const proto = this.weaponModels.get(wantName);
    if (!proto) return;
    const model = proto.clone(true);
    model.name = wantName;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        // Weapons can never be occluders: the fade only touches materials made
        // `fadeable`, and Phase 6 took every character mesh out of that
        // raycast for the same reason.
        mesh.raycast = () => undefined;
      }
    });
    if (this.player.attachToSocket('weapon', model)) this.heldWeapon = model;
  }

  /**
   * Does this officer have a car?
   *
   * The Heat tiers have always declared how many cars each level allows; until
   * now the host answered "none", so `pursue_vehicle` was a state the system
   * could reach in a unit test and never in the game. This decides it by the
   * officer's position in the corps against the current tier — deterministic,
   * no extra state to keep in sync, and it shrinks as Heat falls.
   *
   * Only the speed differs. There is no patrol car in the world: `OfficerCorps`
   * walks a body toward a goal and that is all it does. An officer chasing a
   * car at driving speed while visibly on foot is the one place this phase
   * asks the player to look away, and it is recorded in the Phase 9 report
   * rather than hidden.
   */
  private motorised(officerId: string): boolean {
    const cars = this.combat?.police.wanted(this.combat.heat.heat).vehicles ?? 0;
    if (cars <= 0) return false;
    const index = this.corps?.ids.indexOf(officerId) ?? -1;
    return index >= 0 && index < cars;
  }

  /**
   * Where weapons are refused.
   *
   * Every interior except the police station and the garage, plus any moment
   * the story owns the screen. Deliberately generous: the brief asks for the
   * family home and ordinary shops, and the honest reading of "ordinary shop"
   * in a village where every building is a shop is *indoors*.
   */
  private inSafeZone(): boolean {
    if (this.storyBlocking || this.sleeping || this.transitioning) return true;
    if (!this.indoors) return false;
    const service = this.interiors?.active?.def.service;
    return service !== 'police' && service !== 'garage';
  }

  /**
   * Everybody who could be hit.
   *
   * **Children are excluded here as well as in the NPC catalogue**, which is
   * two independent refusals for one rule — a catalogue mistake cannot become
   * a targetable child, because `Ballistics.traceShot` also refuses anything
   * whose `targetable` is false. `docs/GAME_VISION.md` has said no child NPC
   * is combat-capable since Phase 6; this is the second lock on that door.
   */
  private shotTargets(): import('../combat/Ballistics').ShotTarget[] {
    const out: import('../combat/Ballistics').ShotTarget[] = [];
    for (const agent of this.population?.namedList() ?? []) {
      if (agent.indoors) continue;
      const def = agent.definition;
      const child = def?.ageBand === 'child';
      out.push({
        id: agent.id,
        at: { x: agent.position.x, y: agent.position.y + 0.95, z: agent.position.z },
        radius: 0.42,
        height: 1.8,
        targetable: !child,
      });
    }
    for (const id of this.corps?.ids ?? []) {
      const at = this.corps!.positionOf(id);
      out.push({
        id,
        at: { x: at.x, y: at.y + 0.95, z: at.z },
        radius: 0.42,
        height: 1.8,
        targetable: true,
      });
    }
    return out;
  }

  /**
   * Take composure off somebody.
   *
   * Not damage, and not health. At zero they sit down, stop being a target,
   * and get back up after a while — or sooner, if somebody takes them to the
   * clinic. There is no state below zero and nothing to render but a slump.
   */
  private applyComposure(targetId: string, amount: number, from: { x: number; y: number; z: number }): void {
    const now = this.composure.get(targetId) ?? 1;
    const next = Math.max(0, now - amount);
    this.composure.set(targetId, next);

    const agent = this.population?.namedById(targetId);
    if (agent) {
      agent.react(next <= 0 ? 'flee' : 'watch', new THREE.Vector3(from.x, from.y, from.z));
    }

    // Attacking an officer is its own offence, and the loudest one there is.
    if (targetId.startsWith('officer_')) {
      this.combat?.commitCrime('attack_police', { x: from.x, y: from.y, z: from.z });
    } else if (next <= 0) {
      this.combat?.commitCrime('assault', { x: from.x, y: from.y, z: from.z });
    }
  }

  /**
   * A puff where a projectile stopped.
   *
   * Deliberately the cheapest thing that reads: a few points on a shared
   * geometry, faded out by the same `gsap` the collectibles use. No decals, no
   * blood, no material lookup — the brief asks for "lightweight particles and
   * decals" and the decals are the part that would have cost a render target.
   */
  private spawnImpact(at: { x: number; y: number; z: number }, struckWorld: boolean): void {
    void struckWorld;
    const hud = this.hud;
    // Presentation only, and skipped entirely when the player has asked for no
    // flashes. Nothing about the simulation depends on it.
    if (!this.settings.current.flashes) return;
    hud.pulseImpact(at.x, at.y, at.z);
  }

  private reportWeaponRefusal(reason: string): void {
    const lines: Record<string, [string, string]> = {
      'too-young': ['Not yet', 'That is not something you can carry.'],
      'not-owned': ['Nothing there', 'You do not have one.'],
      'safe-zone': ['Not in here', 'Put it away first.'],
      empty: ['Click', 'Empty.'],
      'no-reserve': ['Nothing left', 'No rounds to load.'],
      'magazine-full': ['Full', 'It is already loaded.'],
      holstered: ['Put away', 'Draw it first.'],
    };
    const line = lines[reason];
    if (line) this.hud.showToast(line[0], line[1]);
  }

  /**
   * Taken in.
   *
   * The order is deliberate and every step of it is a rule from the brief:
   * fade first so nothing is seen teleporting, impound the vehicle *before*
   * the player is moved so it is not left running in the street, advance the
   * clock, charge the fine, put them outside the station, then save. Saving
   * last is what makes "an arrest never corrupts a quest or a save" true —
   * every other mutation has already settled by then.
   */
  private async performArrest(): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    await this.hud.setFade(true, 0.5);

    const riding = this.riding?.id ?? null;
    if (riding) {
      await this.exitVehicle();
      this.garage.impound(riding);
    }

    // Four hours in a cell, and the day moves on.
    await this.testAdvanceLife(60 * 4);

    const owed = this.combatState.finesOwed;
    const paid = Math.min(owed, this.economy.wallet.cash);
    if (paid > 0) {
      this.economy.pay('fine', paid, 'Fine', Date.now());
      this.combat?.settleAtDesk(paid);
    }

    // Outside the police station, on foot, with nothing drawn.
    this.combat?.clearEncounter();
    const station = this.runtime.interactables.find((i) => i.service === 'police');
    if (station) {
      this.player.motor.teleport(station.position.x, station.position.y + 0.05, station.position.z + 2);
      this.camera.resetBehind(this.player.lookTarget, this.player.controller.facing);
    }

    this.hud.showToast(
      'Taken in',
      paid > 0 ? `Four hours, and $${paid} of it settled.` : 'Four hours, and a fine still owing.',
    );

    await this.hud.setFade(false, 0.5);
    this.transitioning = false;
    await this.saveWithRollback('autosave');
  }

  /** Feed the life clock. Shared by the arrest and the test bridge. */
  private async testAdvanceLife(seconds: number): Promise<void> {
    const tick = this.life.advance(seconds);
    this.needs.advance(tick.consumed);
    if (tick.birthdayReached !== null) await this.handleBirthday(tick.birthdayReached);
  }

  /**
   * Use a counter.
   *
   * The first press opens the menu; with the panel already open on the same
   * service, it runs the first available offer. That keeps every service
   * reachable from one button on a gamepad and one tap on a phone, which is
   * acceptance criterion 1 and not something to bolt on later.
   */
  private useService(serviceId: string, pointId: string): void {
    const host = this.serviceHost();
    const menu = this.interiorApi!.buildMenu(serviceId, host);
    if (!menu) return;

    if (this.lastServiceId !== serviceId) {
      this.lastServiceId = serviceId;
      const affordable = menu.entries.filter((e) => e.available).length;
      this.hud.showToast(
        menu.title,
        menu.open
          ? `${affordable} of ${menu.entries.length} available. Press again to take the first.`
          : 'Closed for now.',
      );
      return;
    }

    const first = menu.entries.find((e) => e.available);
    if (!first) {
      this.hud.showToast(menu.title, menu.entries[0]?.reason ?? 'Nothing available.');
      return;
    }

    const result = this.interiorApi!.executeOffer(serviceId, first.id, host);
    this.lastServiceId = null;
    if (result.ok) {
      const money =
        result.spent > 0 ? ` −$${result.spent}` : result.gained > 0 ? ` +$${result.gained}` : '';
      this.hud.showToast(menu.title, `${result.label}${money}`);
      // A purchase can satisfy a "collect" objective.
      this.syncTaskProgress();
      this.reportTaskPlace(pointId);
      // And a story `buy` objective, which names the offer rather than the
      // item -- "buy a meal" is about the transaction, not about holding food.
      this.director?.report({ kind: 'buy', serviceOffer: first.id });
      this.director?.report({ kind: 'interact', place: pointId });
    } else {
      this.hud.showToast(menu.title, SERVICE_FAILURES[result.reason]);
    }
    this.syncInteractables();
  }

  private startTask(taskId: string): boolean {
    const r = this.tasks.start(taskId, {
      age: this.life.ageYears,
      hasVehicle: this.riding !== null || this.garage.owned().length > 0,
    });
    if (!r.ok) {
      this.hud.showToast('Not now', TASK_REFUSALS[r.reason]);
      return false;
    }
    this.hud.showToast(r.run.def.name, r.run.def.summary);
    this.syncTaskProgress();
    return true;
  }

  /** A physical interaction with no menu behind it. */
  private usePoint(pointId: string, kind: BuiltPoint['kind']): void {
    const point = this.interiors?.active?.points.find((p) => p.id === pointId);
    switch (kind) {
      case 'bed':
        void this.sleep();
        break;
      case 'chair':
        if (point) this.sit(true, point);
        break;
      case 'wardrobe':
        this.hud.openWardrobe(true);
        break;
      case 'shower':
        this.shower();
        break;
      case 'shelf':
      case 'lift':
      case 'desk':
        this.reportTaskPlace(pointId);
        break;
      case 'cell':
        this.hud.showToast('Holding cell', 'Empty, and the door is locked.');
        break;
      default:
        this.reportTaskPlace(pointId);
    }
  }

  /**
   * Tell the active task, and the story, that a named place was used.
   *
   * Both, always. A shelf stocked during a grocery shift is a task objective
   * *and* possibly a quest one, and deciding which of the two "owns" the press
   * would mean a quest that watches a job cannot see it happen.
   */
  private reportTaskPlace(place: string): void {
    this.director?.report({ kind: 'interact', place });
    if (!this.tasks.active) return;
    if (this.tasks.report({ place })) this.afterTaskChange();
  }

  /**
   * Re-read every `collect` objective off the bag.
   *
   * Absolute rather than incremental, because the truth of "carry three
   * boxes" is how many you are holding — and selling one has to move the bar
   * back down.
   */
  private syncTaskProgress(): void {
    const run = this.tasks.active;
    if (!run) return;
    for (const p of run.progress) {
      if (p.kind !== 'collect' || !p.itemId) continue;
      this.tasks.setProgress(p.id, this.inventory.count(p.itemId));
    }
    this.afterTaskChange();
  }

  private afterTaskChange(): void {
    const outcome = this.tasks.outcome;
    if (!outcome || outcome.state !== 'completed') return;

    const paid = this.economy.award(
      outcome.awardKey,
      outcome.pay,
      taskLabel(outcome.taskId),
      Date.now(),
    );
    if (paid.ok) {
      this.hud.showToast('Paid', `${taskLabel(outcome.taskId)} — $${outcome.pay}`);
    }
    // A finished shift is what a `work_shift` objective is waiting for. Sent
    // after the award so a quest that also pays cannot land first and make the
    // ledger read backwards.
    this.director?.report({ kind: 'work_shift', taskId: outcome.taskId });
    this.tasks.clear();
  }

  private placeDecor(itemId: string): boolean {
    const built = this.interiors?.active ?? null;
    const slots = built?.def.decorSlots ?? [];
    if (!built || slots.length === 0) return false;
    if (!(this.interiorApi !== null && itemId in this.interiorApi.DECOR_PARTS)) return false;

    const placed = this.decor.get(built.def.id) ?? new Map<string, DecorItemId>();
    const free = slots.find((s) => !placed.has(s.id));
    if (!free) {
      this.hud.showToast('No room', 'Every corner is taken already.');
      return false;
    }
    placed.set(free.id, itemId as DecorItemId);
    this.decor.set(built.def.id, placed);
    this.hud.showToast('Placed', 'It suits the room.');
    return true;
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
    // Only the hero interiors pay for a live view. Everywhere else the pane
    // is an ordinary toon material and this pass would re-render the outdoor
    // world -- ~300 k triangles -- for a window nobody is looking through.
    if (!this.indoors || !this.interiors?.active?.def.livePortal) return;
    this.portal.render(
      this.renderer.renderer,
      this.scene,
      this.camera.camera,
      [
        ...(this.interiors?.active ? [this.interiors.active.group] : []),
        this.player.root,
        this.contact.mesh,
      ],
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

    // The story owns no GPU or WASM memory — it is arithmetic, DOM and a
    // string table — so there is nothing to release. Dropping the handles
    // stops a stray frame from driving a torn-down world, and the panels'
    // listeners come off through `gameScope` below, where they were
    // registered. `this.story` deliberately survives: it is save data, and a
    // dispose is not a new game.
    this.director = null;
    this.panels = null;
    this.storyApi = null;
    this.storyLoading = null;
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

/**
 * What the toast says when a service refuses.
 *
 * A table rather than a string per call site, so a new failure reason is a
 * compile error here instead of a silent empty toast in the game.
 */
const SERVICE_FAILURES: Readonly<Record<ServiceFailure, string>> = {
  'unknown-service': 'Nobody is serving.',
  'unknown-offer': 'They cannot do that here.',
  closed: 'Closed for now.',
  'too-young': 'Not at your age.',
  unsupported: 'Not yet.',
  'no-vehicle': 'Bring a vehicle round first.',
  'nothing-to-sell': 'You have nothing they want.',
  'not-needed': 'It is already fine.',
  'insufficient-funds': 'You cannot afford that.',
  'no-room': 'Your bag is full.',
  refused: 'They shake their head.',
};

const TASK_REFUSALS: Readonly<Record<StartRefusal, string>> = {
  'unknown-task': 'No work going.',
  'already-active': 'Finish what you started first.',
  'too-young': 'Come back when you are older.',
  'needs-vehicle': 'You would need something to drive.',
  'not-retryable': 'That one is done.',
};

/** What a closed door calls itself, before the layouts have been fetched. */
const DOOR_NAMES: Readonly<Record<ServiceType, string>> = {
  home: 'Family home',
  apartment: 'Starter apartment',
  grocery: 'Village grocery',
  police: 'Police station',
  clinic: 'Village clinic',
  garage: 'Garage and forecourt',
  cafe: 'Corner cafe',
  clothing: 'Clothing shop',
  airstrip: 'Airstrip office',
};

/** The placeholder lines a counter says. Phase 11 owns the real dialogue UI. */
const TOPIC_LINES: Readonly<Record<string, string>> = {
  cafe: 'Somebody nods at you over their cup.',
  clinic: 'Rest and eat properly, is the advice.',
  police: 'Nothing doing today. Keep it that way.',
  fitting: 'The mirror is round the back.',
  airstrip: 'Strip is quiet. Nothing flying yet.',
};

function taskLabel(taskId: string): string {
  return taskDef(taskId)?.name ?? 'Work';
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

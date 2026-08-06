import * as THREE from 'three';
import { createRendererBackend, type RendererBackend } from './RendererBackend';
import { Settings, QualityLevel, TimeMode } from './Settings';
import type { LifeSnapshot, TestSurface } from './TestMode';
import { DisposalRegistry } from './DisposalRegistry';
import { ZoneManager } from '../world/zones/ZoneManager';
import { buildCityChunk, buildCitySkyline } from '../world/zones/CityBuilder';
import { CityRuntime } from '../world/zones/CityRuntime';
import type { ZoneId } from '../world/zones/Manifest';
import type { ZoneRuntime } from '../world/zones/ZoneRuntime';
import { LifeClock } from './clocks/LifeClock';
import { WorldClock } from './clocks/WorldClock';
import { StoryClock } from './clocks/StoryClock';
import { SaveService } from '../save/SaveService';
import { createSaveDriver } from '../save/SaveDriver';
import { CONTENT_VERSION, type SaveData, type SaveSlotId } from '../save/SaveSchema';
import { canEnterZone, type GameMode, type GateContext } from './Gates';
import { WORLD_MANIFEST } from '../world/zones/worldManifest';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { AssetManager } from './AssetManager';
import { World, Interactable } from '../world/World';
import { Environment } from '../world/Environment';
import { Player } from '../player/Player';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { ContactShadow } from '../graphics/StylizedShadows';
import { PostProcessing } from '../graphics/PostProcessing';
import { WindowPortal } from '../graphics/WindowPortal';
import { INTERIOR_ORIGIN } from '../world/Interiors';
import { setToonPlayer, updateToonTime } from '../graphics/ToonMaterial';
import { HUD } from '../ui/HUD';
import { LoadingScreen } from '../ui/LoadingScreen';
import { Minimap } from '../ui/Minimap';
import { clamp } from '../utils/MathUtils';

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

  private readonly saves = new SaveService(createSaveDriver());
  private mode: GameMode = 'story';
  /** The spawn the player last arrived at; saved rather than a raw position. */
  private lastSpawnId = 'village_start';
  private readonly completedChapters = new Set<string>();
  /** True once an autosave has been applied, so mode selection defers to it. */
  private resumedFromSave = false;
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
  private activeInteractable: Interactable | null = null;
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
      onInteract: () => this.input.queueInteract(),
      onOutfit: (patch) => {
        this.player.setOutfit(patch);
        this.hud.syncOutfit(this.player.outfit);
      },
    });
    this.hud.syncOutfit(this.player.outfit);
    this.hud.setCounter(this.village!.collectibles.count, this.village!.collectibles.total);
    // Runs every frame, including while a district is active — a district has
    // no keepsakes, so this must degrade rather than assert.
    this.minimap = new Minimap(this.runtime.mapData, () => this.village?.keepsakeMarkers ?? []);

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
  begin(mode: GameMode = 'story'): void {
    if (this.running) return;
    this.running = true;
    if (!this.resumedFromSave) this.mode = mode;

    this.input.attach(this.canvas);
    this.hud.show();
    this.audio.start();
    this.audio.setMuted(this.settings.current.muted);

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

    this.hud.setAge(this.life.ageYears, this.life.yearProgress);
  }

  /**
   * A birthday has been reached.
   *
   * The clock has already paused itself, so nothing ages while this runs and
   * the next birthday cannot race it. Acknowledging is the last step, and is
   * what makes the delivery once-only across a reload.
   */
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
      money: 0,
      inventory: [],
      wardrobe: { ...this.player.outfit },
      vehicles: [],
      needs: { hunger: 1, energy: 1, cleanliness: 1, mood: 1 },
      relationships: [],
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

    this.village?.collectibles.restoreFound(data.collectibles);
    if (this.village) {
      this.hud.setCounter(this.village.collectibles.count, this.village.collectibles.total);
    }
    this.player.setOutfit(data.wardrobe);
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

    this.hud.setAge(this.life.ageYears, this.life.yearProgress);
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

    // Appearance stage, NPC milestones and age-gated story checks attach
    // here as those systems land.
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
    try {
      const result = await this.zones.travel.travel({ to, context: { fromZone: from } });

      if (!result.ok) {
        this.hud.showToast('Not that way', result.message);
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

      // Leaving a zone leaves these pointing at content that no longer exists.
      this.indoors = false;
      this.sleeping = false;
      this.activeInteractable = null;
      this.hud.setPrompt(null);
      this.player.controller.boundsEnabled = true;
      this.audio.setZone('outdoor');

      const zone = this.zones.activeZone;
      if (zone) this.hud.showToast('Arrived', zone.displayName);
      // Stream the first rings before handing control back, so the player does
      // not spawn into an empty district.
      await this.zones.update(spawn.x, spawn.z);
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
        if (tick.birthdayReached !== null) await this.handleBirthday(tick.birthdayReached);
        return this.lifeSnapshot();
      },
      forceBirthday: async () => {
        const reached = this.life.forceBirthday();
        if (reached !== null) await this.handleBirthday(reached);
        return this.lifeSnapshot();
      },
      lifeState: () => this.lifeSnapshot(),
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
    };
  }

  private update(dt: number): void {
    const uiBlocking =
      this.hud.infoOpen || this.hud.wardrobeOpen || this.sleeping || this.transitioning;
    if (uiBlocking) this.input.releaseAll();

    this.advanceClocks(dt);

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
    this.camera.update(dt, this.player.lookTarget, this.input, this.runtime.collision, this.scene);

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

    // 6. radar — hidden indoors, where it has nothing useful to show
    this.minimap.setVisible(!this.indoors);
    if (!this.indoors) {
      this.minimap.update(dt, this.player.position, this.player.controller.facing);
    }

    // 7. interactables
    this.updateInteraction();

    // 8. audio
    this.updateAudio(dt);
  }

  /**
   * Offer the nearest thing in reach, and act on it if asked.
   *
   * Distance is measured against the player's chest rather than their feet so
   * a bed you're standing beside still counts.
   */
  private updateInteraction(): void {
    if (this.sleeping || this.transitioning || this.hud.wardrobeOpen) return;

    // Seated, the only thing on offer is getting back up — and any attempt to
    // walk counts as asking for that too.
    if (this.player.isSitting) {
      this.hud.setPrompt('Stand up');
      this.activeInteractable = null;
      if (this.input.consumeInteract() || this.input.anyMovement) {
        this.sit(false);
      }
      return;
    }

    let best: Interactable | null = null;
    let bestDist = Infinity;
    const p = this.player.lookTarget;
    for (const it of this.runtime.interactables) {
      const d = it.position.distanceTo(p);
      if (d < it.radius && d < bestDist) {
        best = it;
        bestDist = d;
      }
    }

    if (best !== this.activeInteractable) {
      this.activeInteractable = best;
      this.hud.setPrompt(best ? best.prompt : null);
    }

    // Consume unconditionally so a press aimed at nothing can't fire later.
    if (!this.input.consumeInteract()) return;

    if (best?.kind === 'sleep') {
      void this.sleep();
    } else if (best?.kind === 'enter') {
      void this.enterInterior();
    } else if (best?.kind === 'sit') {
      this.sit(true);
    } else if (best?.kind === 'wardrobe') {
      this.hud.openWardrobe(true);
    } else if (this.indoors) {
      // Any interact indoors that isn't the bed means "let me out". Gating
      // this on a proximity radius is how you strand someone in a room.
      void this.exitInterior();
    }
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
    this.activeInteractable = null;
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
    this.activeInteractable = null;
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
    this.hud.setDebug(
      [
        `${this.fps.toFixed(0)} fps · ${this.renderer.info}`,
        `veg ${s.vegetation} · grass ${s.grass} · collider ${(s.colliderTris / 1000).toFixed(0)}k`,
        `state ${this.player.state} · ${this.player.speed.toFixed(2)} m/s · ${
          this.player.motor.grounded ? 'ground' : 'air'
        }`,
        `time ${this.env.clockLabel} · day ${this.env.dayFactor.toFixed(2)}`,
      ].join('\n'),
    );
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.player?.dispose();

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

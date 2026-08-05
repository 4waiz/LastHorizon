import * as THREE from 'three';
import { createRendererBackend, type RendererBackend } from './RendererBackend';
import { Settings, QualityLevel, TimeMode } from './Settings';
import type { TestSurface } from './TestMode';
import { ZoneManager } from '../world/zones/ZoneManager';
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
  private camera!: ThirdPersonCamera;
  private post!: PostProcessing;
  private env!: Environment;
  private world!: World;
  private player!: Player;
  private contact!: ContactShadow;
  private portal!: WindowPortal;
  private hud!: HUD;
  private minimap!: Minimap;

  private readonly input = new InputManager();
  private readonly audio = new AudioManager();
  private readonly settings = new Settings();

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
        if (zone.id !== 'village_coast') {
          // City districts are declared in the manifest but have no geometry
          // yet; entering one would produce an empty zone, so refuse rather
          // than strand the player somewhere blank.
          throw new Error(`zone ${zone.id} has no builder yet`);
        }
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
        this.world = world;
      },
      buildChunk: () => {
        // Authored zones do not stream; city chunk building lands with the
        // city prototype.
      },
    });
    await this.zones.enter('village_coast');

    loading.setProgress(0.94, 'the explorer');
    await frame();

    this.player = new Player(assets.player.scene, assets.player.clips, this.input);
    this.scene.add(this.player.root);
    this.player.setSpawn(this.world.spawn, this.world.spawnFacing);
    this.camera.resetBehind(this.player.lookTarget, this.world.spawnFacing);

    this.contact = new ContactShadow(0.66);
    this.scene.add(this.contact.mesh);

    // Where the room appears to sit when you look out of it: on the east
    // verge, so the back window frames the road climbing toward the hill.
    const view = new THREE.Vector3(12.5, 0, 30);
    view.y = this.world.terrain.heightAt(view.x, view.z);
    this.portal.setAnchor(INTERIOR_ORIGIN, view, 0);

    this.world.onCollect = (def, count, total) => {
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
        this.world.collectibles.restoreAll();
        this.hud.setCounter(0, this.world.collectibles.total);
      },
      onInteract: () => this.input.queueInteract(),
      onOutfit: (patch) => {
        this.player.setOutfit(patch);
        this.hud.syncOutfit(this.player.outfit);
      },
    });
    this.hud.syncOutfit(this.player.outfit);
    this.hud.setCounter(this.world.collectibles.count, this.world.collectibles.total);
    this.minimap = new Minimap(this.world.mapData, () => this.world.keepsakeMarkers);

    this.post.setEnabled(this.settings.current.quality === 'high');
    this.applyViewport();

    if (assetManager.failures.length) {
      console.warn('[LastHorizon] some packs failed to load:', assetManager.failures);
    }
    loading.setProgress(1, 'the afternoon');
    loading.ready();
  }

  /** Called once the player dismisses the loading screen. */
  begin(): void {
    if (this.running) return;
    this.running = true;

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
    if (!document.hidden) {
      // Discard the elapsed background time so dt stays sane.
      this.clock.getDelta();
    }
  };

  private applyQuality(q: QualityLevel): void {
    const preset = this.settings.preset;
    void q;
    this.renderer.applyQuality(preset);
    this.env.applyQuality(preset);
    this.world.applyQuality(preset);
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
      groundAt: (x, z) => this.world.terrain.heightAt(x, z),
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
      collectedCount: () => this.world.collectibles.count,
    };
  }

  private update(dt: number): void {
    const uiBlocking =
      this.hud.infoOpen || this.hud.wardrobeOpen || this.sleeping || this.transitioning;
    if (uiBlocking) this.input.releaseAll();

    // 1. character
    this.camForward.copy(this.camera.forward);
    this.camRight.copy(this.camera.right);
    const wasAir = !this.player.motor.grounded;
    this.player.update(dt, this.world.collision, this.camForward, this.camRight,
                       this.world.inBounds);

    if (this.player.controller.jumpedThisFrame) this.audio.playJump();
    if (this.player.motor.justLanded && wasAir) {
      this.audio.playLand(this.player.motor.lastImpactSpeed);
    }
    if (this.player.controller.respawnedThisFrame) {
      this.camera.resetBehind(this.player.lookTarget, this.player.controller.facing);
      this.hud.showToast('Back on the road', 'You wandered a little too far.');
    }

    // 2. camera (reads the already-resolved player position)
    this.camera.update(dt, this.player.lookTarget, this.input, this.world.collision, this.scene);

    // 3. atmosphere
    this.env.update(dt, this.elapsed, this.player.position, this.camera.camera.position);
    const windStrength = 0.85 + Math.sin(this.elapsed * 0.17) * 0.35;
    updateToonTime(this.elapsed, windStrength);
    setToonPlayer(this.player.position);

    // 4. world
    this.world.update(
      dt,
      this.elapsed,
      this.player.position,
      this.camera.camera.position,
      this.env.lampFactor,
    );

    // 5. contact shadow, dimmed as the sun goes down
    const groundY = this.player.motor.grounded
      ? this.player.position.y
      : this.world.collision.groundBelow(
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
    for (const it of this.world.interactables) {
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
    const room = this.world.interiors;
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

    this.world.interiors.setVisible(indoors);
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

    await this.transit(this.world.interiors.spawn, Math.PI, true);
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

    const room = this.world.interiors;

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
    const surface = this.indoors ? 0.3 : this.world.surfaceHardness(p.x, p.z);
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
      [this.world.interiors.group, this.player.root, this.contact.mesh],
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
    const s = this.world.stats;
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
    // The active zone owns the world now: leaving it disposes the geometry
    // and removes the group from the scene. Awaiting is not an option in a
    // synchronous dispose, so report a failure rather than drop it silently.
    void this.zones?.dispose().catch((err) => {
      console.warn('[LastHorizon] zone teardown failed', err);
    });
    this.env?.dispose();
    this.contact?.dispose();
    this.post?.dispose();
    this.portal?.dispose();
    this.renderer?.dispose();
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

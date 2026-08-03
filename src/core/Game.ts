import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Settings, QualityLevel, TimeMode } from './Settings';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { AssetManager } from './AssetManager';
import { World } from '../world/World';
import { Environment } from '../world/Environment';
import { Player } from '../player/Player';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { ContactShadow } from '../graphics/StylizedShadows';
import { PostProcessing } from '../graphics/PostProcessing';
import { setToonPlayer, updateToonTime } from '../graphics/ToonMaterial';
import { HUD } from '../ui/HUD';
import { LoadingScreen } from '../ui/LoadingScreen';
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
  private renderer!: Renderer;
  private camera!: ThirdPersonCamera;
  private post!: PostProcessing;
  private env!: Environment;
  private world!: World;
  private player!: Player;
  private contact!: ContactShadow;
  private hud!: HUD;

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
  private nearestPole = { distance: 999, pan: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async start(loading: LoadingScreen): Promise<void> {
    const preset = this.settings.preset;

    this.renderer = new Renderer(this.canvas, preset);
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

    this.world = new World(assets, preset);
    this.world.build();
    this.scene.add(this.world.group);

    loading.setProgress(0.94, 'the explorer');
    await frame();

    this.player = new Player(assets.player.scene, assets.player.clips, this.input);
    this.scene.add(this.player.root);
    this.player.setSpawn(this.world.spawn, this.world.spawnFacing);
    this.camera.resetBehind(this.player.lookTarget, this.world.spawnFacing);

    this.contact = new ContactShadow(0.66);
    this.scene.add(this.contact.mesh);

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
    });
    this.hud.setCounter(this.world.collectibles.count, this.world.collectibles.total);

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

  private update(dt: number): void {
    const uiBlocking = this.hud.infoOpen;
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

    // 6. audio
    this.updateAudio(dt);
  }

  private updateAudio(dt: number): void {
    const p = this.player.position;
    const surface = this.world.surfaceHardness(p.x, p.z);
    const moving = this.player.motor.grounded && this.player.speed > 0.3;

    // Cheap proximity check against the utility poles for the transformer hum.
    this.nearestPole.distance = 999;
    this.audio.update(
      dt,
      this.player.speed,
      surface,
      1 - this.env.dayFactor,
      this.nearestPole.distance,
      this.nearestPole.pan,
      moving,
    );
  }

  private render(): void {
    this.renderer.beginFrame();
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
    this.world?.dispose();
    this.env?.dispose();
    this.contact?.dispose();
    this.post?.dispose();
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

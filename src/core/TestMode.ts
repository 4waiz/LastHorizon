import * as THREE from 'three';
import type { TimeMode } from './Settings';
import type { AppearanceSnapshot } from '../player/AgeAppearance';

/**
 * Deterministic test mode: the `window.__LH_TEST__` bridge.
 *
 * Installed only when `?e2e=1` is present (see FeatureFlags). The bridge is
 * deliberately narrow — a fixed set of typed operations, no arbitrary eval and
 * no handle to the scene graph — so it cannot become a back door into the
 * running game.
 *
 * Why it exists: ad-hoc capture is not reproducible. Clouds drift and birds
 * animate off elapsed time, the day/night cycle advances, and the dev FPS
 * readout changes every frame, so two screenshots of the "same" scene never
 * match. `prepareShot()` pins all of that down, which is what makes visual
 * regression comparison meaningful.
 */

/** What the bridge needs from Game. Game builds this; nothing else may. */
export interface TestSurface {
  setTimeMode(mode: TimeMode): void;
  jumpToTime(t: number): void;
  getTime(): number;
  teleport(x: number, y: number, z: number, facing: number): void;
  groundAt(x: number, z: number): number;
  frameCamera(facing: number, distance: number, pitch?: number): void;
  step(dt: number): void;
  enterInterior(): Promise<void>;
  exitInterior(): Promise<void>;
  sit(on: boolean): void;
  setLying(on: boolean): void;
  openWardrobe(open: boolean): void;
  isIndoors(): boolean;
  isRunning(): boolean;
  playerPosition(): THREE.Vector3;
  playerFacing(): number;
  playerState(): string;
  playerSpeed(): number;
  isSitting(): boolean;
  isLying(): boolean;
  renderStats(): RenderStats;
  collectedCount(): number;
  travelTo(zoneId: string): Promise<boolean>;
  activeZoneId(): string | null;
  zoneDebug(): ZoneDebugSnapshot;
  releaseInput(): void;
  advanceLife(seconds: number): Promise<LifeSnapshot>;
  forceBirthday(): Promise<LifeSnapshot>;
  lifeState(): LifeSnapshot;
  interactionState(): InteractionSnapshot;
  pressInteract(held: boolean): void;
  needsState(): Record<string, number>;
  appearanceState(): AppearanceSnapshot;
  playGesture(name: string): boolean;
  gestureState(): { playing: string | null; weight: number };
  inventoryState(): ReadonlyArray<{ id: string; count: number }>;
  completeChapter(id: string): void;
  saveNow(slot: string): Promise<boolean>;
  loadNow(slot: string): Promise<boolean>;
}

/** A read-only view of what the interaction system is offering. */
export interface InteractionSnapshot {
  /** The label on screen, or null when nothing is in reach. */
  prompt: string | null;
  /** Action id of the thing a press would run. */
  actionId: string | null;
  /** Every offerable action, best first. */
  candidates: readonly string[];
  /** True when two or more distinct objects are offering something. */
  needsSelector: boolean;
  /** 0..1 through a hold. */
  holdProgress: number;
}

export interface LifeSnapshot {
  ageYears: number;
  yearProgress: number;
  pendingBirthday: number | null;
  blocked: readonly string[];
  rate: number | 'frozen';
}

export interface ZoneDebugSnapshot {
  zoneId: string | null;
  zoneName: string;
  kind: string;
  residentChunks: string[];
  residentCount: number;
  trackedResources: number;
  travelling: boolean;
}

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface PlayerSnapshot {
  x: number;
  y: number;
  z: number;
  facing: number;
  state: string;
  speed: number;
  sitting: boolean;
  lying: boolean;
  indoors: boolean;
}

export interface LHTestBridge {
  readonly version: 1;
  /** Resolves once assets are loaded and the frame loop is running. */
  ready(timeoutMs?: number): Promise<void>;
  /** Freeze the clock at a named mode ('day' | 'dusk' | 'night'). */
  setTimeMode(mode: TimeMode): void;
  /** Freeze the clock at an exact 0..1 position. */
  setTime(t: number): void;
  getTime(): number;
  /** Drop the player at a world x/z, snapped to the ground. */
  teleport(x: number, z: number, facing?: number): void;

  /**
   * Teleport to an exact point, terrain ignored.
   *
   * `teleport` drops the player onto the ground, which is the terrain height —
   * no use indoors, where the room floor sits 600 m above it.
   */
  teleportTo(x: number, y: number, z: number, facing?: number): void;
  frameCamera(facing: number, distance: number, pitch?: number): void;
  getPlayerState(): PlayerSnapshot;
  getRenderStats(): RenderStats;
  getCollected(): number;
  enterInterior(): Promise<void>;
  exitInterior(): Promise<void>;
  sit(on: boolean): void;
  lie(on: boolean): void;
  openWardrobe(open: boolean): void;
  /**
   * Age the character without waiting an hour of wall time. Feeds active
   * seconds straight to the life clock, so every gate still applies.
   */
  advanceLife(seconds: number): Promise<LifeSnapshot>;

  /** What the interact prompt is offering right now. */
  getInteraction(): InteractionSnapshot;

  /**
   * Hold or release the interact control, as a device with no key state would.
   * A press is `true` then `false`; a hold is `true`, some `step()`s, `false`.
   */
  pressInteract(held: boolean): void;

  /** The four soft needs, 0..1. */
  getNeeds(): Record<string, number>;

  /**
   * Age proportions as they actually sit on the rig, read back off the bones —
   * not the values that were requested.
   */
  getAppearance(): AppearanceSnapshot;

  /** Start an upper-body overlay clip. False if the clip is not in the GLB. */
  playGesture(name: string): boolean;

  /** Which overlay is running, and how far its weight has ramped. */
  getGesture(): { playing: string | null; weight: number };

  /** Carried stacks, for save round-trip assertions. */
  getInventory(): ReadonlyArray<{ id: string; count: number }>;

  /**
   * Jump straight to the next birthday. Resolves once it has been fully
   * handled, so consecutive calls each land instead of being dropped by the
   * in-progress guard.
   */
  forceBirthday(): Promise<LifeSnapshot>;
  getLifeState(): LifeSnapshot;
  /** Mark a story chapter complete, so age+chapter gates can be reached. */
  completeChapter(id: string): void;
  /** Write the current state to a slot. */
  saveNow(slot?: string): Promise<boolean>;
  /** Read a slot back into the running game. */
  loadNow(slot?: string): Promise<boolean>;
  /** Travel to another zone. Resolves false if the journey was refused. */
  travelTo(zoneId: string): Promise<boolean>;
  getActiveZone(): string | null;
  /** Zone, resident chunks and tracked resources — for streaming assertions. */
  getZoneDebug(): ZoneDebugSnapshot;
  /** Advance the simulation by a fixed number of 1/60 s steps. */
  settle(frames?: number): void;
  /**
   * Put the page into a reproducible state for a screenshot: hide the dev
   * readout, stop the wind and the clock, then settle. Idempotent.
   */
  prepareShot(frames?: number): void;
}

declare global {
  interface Window {
    __LH_TEST__?: LHTestBridge;
  }
}

const FIXED_DT = 1 / 60;
const STYLE_ID = 'lh-e2e-style';

/**
 * Hide everything that changes on its own. Injected as a stylesheet rather
 * than set inline so a later repaint (the debug readout refreshes twice a
 * second) cannot undo it.
 */
function pinPresentation(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #debug { visibility: hidden !important; }
    * { animation-play-state: paused !important; }
  `;
  document.head.appendChild(style);
}

export function installTestBridge(surface: TestSurface): LHTestBridge {
  const bridge: LHTestBridge = {
    version: 1,

    async ready(timeoutMs = 60000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      // The loading screen holds for a user gesture so audio may start; in
      // test mode press it automatically.
      const start = document.getElementById('startButton') as HTMLButtonElement | null;
      while (Date.now() < deadline) {
        if (surface.isRunning()) return;
        if (start && !start.hidden && !start.disabled) start.click();
        await new Promise((r) => window.setTimeout(r, 50));
      }
      throw new Error('__LH_TEST__.ready timed out');
    },

    setTimeMode(mode: TimeMode): void {
      surface.setTimeMode(mode);
    },

    setTime(t: number): void {
      // 'day' first so the cycle stops advancing, then pin the exact value.
      surface.setTimeMode('day');
      surface.jumpToTime(t);
    },

    getTime(): number {
      return surface.getTime();
    },

    teleport(x: number, z: number, facing = 0): void {
      surface.teleport(x, surface.groundAt(x, z) + 0.05, z, facing);
      surface.frameCamera(facing, 6.4);
    },

    teleportTo(x: number, y: number, z: number, facing = 0): void {
      surface.teleport(x, y, z, facing);
      surface.frameCamera(facing, 6.4);
    },

    frameCamera(facing: number, distance: number, pitch?: number): void {
      surface.frameCamera(facing, distance, pitch);
    },

    getPlayerState(): PlayerSnapshot {
      const p = surface.playerPosition();
      return {
        x: p.x,
        y: p.y,
        z: p.z,
        facing: surface.playerFacing(),
        state: surface.playerState(),
        speed: surface.playerSpeed(),
        sitting: surface.isSitting(),
        lying: surface.isLying(),
        indoors: surface.isIndoors(),
      };
    },

    getRenderStats(): RenderStats {
      return surface.renderStats();
    },

    getCollected(): number {
      return surface.collectedCount();
    },

    enterInterior(): Promise<void> {
      return surface.enterInterior();
    },

    exitInterior(): Promise<void> {
      return surface.exitInterior();
    },

    sit(on: boolean): void {
      surface.sit(on);
    },

    lie(on: boolean): void {
      surface.setLying(on);
    },

    openWardrobe(open: boolean): void {
      surface.openWardrobe(open);
    },

    advanceLife(seconds: number): Promise<LifeSnapshot> {
      return surface.advanceLife(seconds);
    },

    forceBirthday(): Promise<LifeSnapshot> {
      return surface.forceBirthday();
    },

    getLifeState(): LifeSnapshot {
      return surface.lifeState();
    },

    getInteraction(): InteractionSnapshot {
      return surface.interactionState();
    },

    pressInteract(held: boolean): void {
      surface.pressInteract(held);
    },

    getNeeds(): Record<string, number> {
      return surface.needsState();
    },

    getAppearance(): AppearanceSnapshot {
      return surface.appearanceState();
    },

    playGesture(name: string): boolean {
      return surface.playGesture(name);
    },

    getGesture(): { playing: string | null; weight: number } {
      return surface.gestureState();
    },

    getInventory(): ReadonlyArray<{ id: string; count: number }> {
      return surface.inventoryState();
    },

    completeChapter(id: string): void {
      surface.completeChapter(id);
    },

    saveNow(slot = 'autosave'): Promise<boolean> {
      return surface.saveNow(slot);
    },

    loadNow(slot = 'autosave'): Promise<boolean> {
      return surface.loadNow(slot);
    },

    travelTo(zoneId: string): Promise<boolean> {
      return surface.travelTo(zoneId);
    },

    getActiveZone(): string | null {
      return surface.activeZoneId();
    },

    getZoneDebug(): ZoneDebugSnapshot {
      return surface.zoneDebug();
    },

    settle(frames = 40): void {
      for (let i = 0; i < frames; i++) surface.step(FIXED_DT);
    },

    prepareShot(frames = 40): void {
      pinPresentation();
      // Stale keys otherwise walk the player out of frame while settling.
      surface.releaseInput();
      bridge.settle(frames);
    },
  };

  window.__LH_TEST__ = bridge;
  return bridge;
}

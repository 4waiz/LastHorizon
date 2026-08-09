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
  /**
   * Advance one simulation step, optionally drawing it.
   *
   * `render` defaults to true because a screenshot or a `getRenderStats` read
   * needs the canvas to be current. It is turned off for the intermediate
   * frames of a long settle: headless Chromium rasterises in software, and a
   * populated village is ~600 k triangles over ~480 draw calls, so drawing
   * every one of nine hundred frames nobody looks at was taking two minutes.
   */
  step(dt: number, render?: boolean): void;
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
  spawnVehicle(kind: string, x: number, z: number, facing?: number, atY?: number): Promise<string | null>;
  setVehicleInput(id: string, input: Partial<VehicleInputData>): void;
  vehicleTelemetry(id: string): VehicleSnapshot | null;
  resetVehicle(id: string, x: number, y: number, z: number, facing: number): void;
  despawnVehicle(id: string): void;
  enterVehicle(id: string, seatId?: string): Promise<boolean>;
  exitVehicle(): Promise<boolean>;
  ridingVehicle(): string | null;
  setVehicleLocked(id: string, locked: boolean): void;
  giveItem(id: string, count: number): boolean;
  recoverVehicle(id: string): boolean;
  rollVehicle(id: string): void;
  pressFlip(): void;
  testRoadMark(name: string): Promise<{ x: number; y: number; z: number; facing: number } | null>;
  vehicleRecord(id: string): unknown;
  setFuelEnabled(on: boolean): void;
  initPhysics(): Promise<PhysicsSnapshot>;
  physicsState(): PhysicsSnapshot;
  gestureState(): { playing: string | null; weight: number };
  inventoryState(): ReadonlyArray<{ id: string; count: number }>;
  completeChapter(id: string): void;
  saveNow(slot: string): Promise<boolean>;
  loadNow(slot: string): Promise<boolean>;

  // ---- population ---------------------------------------------------------
  /** Resolves once the population chunk and its navmesh have finished. */
  awaitPopulation(): Promise<PopulationSnapshot>;
  populationState(): PopulationSnapshot | null;
  /** Every named resident in the active zone, with where and what they are. */
  npcList(): readonly NpcSnapshot[];
  npcState(id: string): NpcSnapshot | null;
  /** Send a resident somewhere, bypassing their schedule. Test mode only. */
  npcSendTo(id: string, x: number, z: number): boolean;
  /** Force the schedule to be re-read at a given hour, without waiting. */
  npcApplyHour(hour: number): void;
  relationship(id: string): Record<string, number> | null;
  /** Raise a perception event from a position, as if the player caused it. */
  emitPerception(kind: string, x: number, y: number, z: number): void;
  trafficList(): readonly TrafficSnapshot[];
  populationActive(on: boolean): void;

  // ---- Phase 7: interiors, economy, jobs -----------------------------------
  doorList(): readonly DoorSnapshot[];
  enterDoor(doorId: string): Promise<boolean>;
  interiorState(): InteriorSnapshot | null;
  walletState(): WalletSnapshot;
  giveMoney(amount: number): void;
  serviceMenu(serviceId: string): ServiceMenuSnapshot | null;
  runService(serviceId: string, offerId: string): string;
  taskState(): TaskSnapshot | null;
  beginTask(taskId: string): boolean;
  reportTask(place: string): boolean;
  advanceTask(seconds: number): void;
  cancelTask(): void;

  // ---- Phase 8: the authored story -----------------------------------------
  //
  // The brief asks for "debug tooling to jump to any stage in test mode", and
  // `jumpToStage` is it. Everything here installs only under `?e2e=1`, via the
  // same dynamic import the rest of the bridge uses, so none of it is
  // reachable in ordinary play -- which matters more for these than for most:
  // `jumpToStage` and `setChoice` can skip authored content outright.
  /** Load the story subsystem and open chapter 1. Resolves when ready. */
  awaitStory(): Promise<StorySnapshot>;
  storyState(): StorySnapshot;
  startQuest(id: string): boolean;
  questState(id: string): QuestSnapshot | null;
  activeQuests(): readonly string[];
  jumpToStage(questId: string, stageId: string): boolean;
  reportObjective(questId: string, objectiveId: string, amount: number): boolean;
  advanceStory(seconds: number): void;
  setChoice(id: string, value: string): void;
  setFlag(id: string): void;
  adjustReputation(axis: string, delta: number): void;
  /** Returns true when an authored conversation opened rather than small talk. */
  talkToNpc(id: string): boolean;
  dialogueState(): DialogueSnapshot | null;
  /** Take a choice by its authored index. Returns whether the panel is still up. */
  chooseDialogue(index: number): boolean;
  sceneState(): string | null;
  skipScene(): void;
  reelModel(): ReelSnapshot | null;
  openReel(open: boolean): void;
  /** Bytes of the exported PNG. Zero when the browser refused a canvas. */
  exportReel(): Promise<number>;
  objectiveLine(): string | null;
  openJournal(open: boolean): void;
}

export interface StorySnapshot {
  loaded: boolean;
  chapter: number;
  completedChapters: readonly string[];
  flags: readonly string[];
  choices: Record<string, string>;
  reputation: { community: number; law: number };
  endingId: string | null;
  /** How many moments the reel has recorded. */
  reel: number;
  active: readonly string[];
  completed: readonly string[];
}

export interface QuestSnapshot {
  id: string;
  kind: string;
  chapter: number;
  stage: string;
  objectives: ReadonlyArray<{
    id: string;
    kind: string;
    done: number;
    target: number;
    complete: boolean;
    optional: boolean;
  }>;
}

export interface DialogueSnapshot {
  treeId: string;
  nodeId: string;
  speaker: string;
  text: string;
  choices: ReadonlyArray<{ index: number; text: string; available: boolean }>;
}

export interface ReelSnapshot {
  finalTitle: string;
  timeline: ReadonlyArray<{ age: number; kind: string; text: string }>;
  sections: ReadonlyArray<{
    title: string;
    rows: ReadonlyArray<{ label: string; value: string }>;
  }>;
}

/** A door in the active zone, and what is behind it. */
export interface DoorSnapshot {
  id: string;
  interiorId: string;
  x: number;
  y: number;
  z: number;
  label: string;
  open: boolean;
}

export interface InteriorSnapshot {
  id: string;
  name: string;
  service: string;
  /** Room-local origin, so a test can assert the cells stay distinct. */
  originX: number;
  originY: number;
  parts: number;
  triangles: number;
  colliderBoxes: number;
  points: readonly string[];
  livePortal: boolean;
  /** Where the player will be put on stepping back outside. */
  returnTo: { doorId: string; x: number; y: number; z: number; facing: number } | null;
}

export interface WalletSnapshot {
  cash: number;
  bank: number;
  ledger: number;
  /** Net of every entry in the log, for the balance-sheet checks. */
  net: number;
}

export interface ServiceMenuSnapshot {
  id: string;
  title: string;
  open: boolean;
  entries: readonly {
    id: string;
    label: string;
    price: number;
    available: boolean;
    reason?: string;
  }[];
}

export interface TaskSnapshot {
  id: string;
  name: string;
  status: string;
  runNumber: number;
  difficulty: number;
  pay: number;
  timeRemaining: number | null;
  objectives: readonly { id: string; label: string; done: number; target: number; complete: boolean }[];
}

/** Population counters, for assertions and for the profiler runs. */
export interface PopulationSnapshot {
  named: number;
  ambient: number;
  near: number;
  mid: number;
  far: number;
  bodies: number;
  navState: string;
  navBuildMs: number;
  navAgents: number;
  offMeshLinks: number;
  traffic: number;
  trafficParked: number;
  trafficBarges: number;
  witnessed: number;
  stuckRecoveries: number;
  farTickMs: number;
}

export interface NpcSnapshot {
  id: string;
  name: string;
  age: number;
  band: string;
  activity: string;
  indoors: boolean;
  reaction: string | null;
  x: number;
  y: number;
  z: number;
  speed: number;
  targetX: number | null;
  targetZ: number | null;
}

export interface TrafficSnapshot {
  /**
   * Stable per-vehicle id.
   *
   * Needed to answer "where did this car *first* appear", which is the
   * acceptance criterion about not spawning in the player's view. Identifying
   * cars by rounded position instead — the first attempt — counts a car
   * *driving* toward you as a new one every few metres, and then reports it as
   * having appeared under your nose.
   */
  id: number;
  x: number;
  z: number;
  radius: number;
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

/** Controls, as a device-independent request. */
export interface VehicleInputData {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
}

/** A vehicle's live state, for the dashboard and for assertions. */
export interface VehicleSnapshot {
  forwardSpeed: number;
  speedKmh: number;
  gear: string;
  steerAngle: number;
  wheelsOnGround: number;
  grounded: boolean;
  lean: number;
  fallen: boolean;
  fallenFor: number;
  upright: boolean;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Times PhysicsWorld had to rescue this body. Should stay at zero. */
  recoveries: number;
}

/** What the physics world is holding. */
export interface PhysicsSnapshot {
  /** False until something has triggered the lazy Rapier import. */
  loaded: boolean;
  bodies: number;
  colliders: number;
  steps: number;
  /** Times a body had to be rescued from a non-finite or absurd state. */
  recoveries: number;
  /** 0..1 render interpolation factor for the current partial step. */
  alpha: number;
  /** True once the zone's static geometry is resident in Rapier. */
  hasWorld: boolean;
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

  /**
   * Put a vehicle on the ground and return its instance id.
   *
   * Loads physics on first use, so the first call is slower than the rest.
   */
  spawnVehicle(kind: string, x: number, z: number, facing?: number, atY?: number): Promise<string | null>;

  /** Hold the controls. Fields left out are treated as released. */
  setVehicleInput(id: string, input: Partial<VehicleInputData>): void;

  /** Everything the dashboard and the tests need. Null for an unknown id. */
  getVehicle(id: string): VehicleSnapshot | null;

  /** Put a vehicle somewhere valid, upright and at rest. */
  resetVehicle(id: string, x: number, y: number, z: number, facing: number): void;

  despawnVehicle(id: string): void;

  /** Get in. False when the vehicle refuses -- locked, moving, no key. */
  enterVehicle(id: string, seatId?: string): Promise<boolean>;

  /** Get out. False when there is nowhere safe to stand. */
  exitVehicle(): Promise<boolean>;

  /** Instance id of whatever the player is riding, or null. */
  getRidingVehicle(): string | null;

  setVehicleLocked(id: string, locked: boolean): void;

  /**
   * Put an item in the player's inventory. False for an unknown id.
   *
   * Keys are the reason this exists: a car that requires one cannot be entered
   * in a test otherwise, and hard-coding a bypass would test a path players
   * never take.
   */
  giveItem(id: string, count?: number): boolean;

  /** Return a lost, flipped, submerged or impounded vehicle to the garage. */
  recoverVehicle(id: string): boolean;

  /** Lay a vehicle on its side, so the righting path can be exercised. */
  rollVehicle(id: string): void;

  /** Press the righting control, as R or the pad's d-pad down would. */
  pressFlip(): void;

  /**
   * World position of a named spot on the dev proving ground.
   *
   * Null unless the page was loaded with `?testroad=1`. Marks are `start`,
   * `slope5`, `slope12`, `slope20`, `junction`, `parking`, `jump` and
   * `barrierRun`.
   */
  getTestRoadMark(name: string): Promise<{ x: number; y: number; z: number; facing: number } | null>;

  /** Ownership, condition, fuel and where it was parked. Null if unknown. */
  getVehicleRecord(id: string): unknown;

  /** Fuel is optional; switching it off stops consumption entirely. */
  setFuelEnabled(on: boolean): void;

  /**
   * Bring Rapier up and hand it the zone's collision geometry.
   *
   * Physics is lazily imported -- 2.2 MB of inlined WebAssembly -- so nothing
   * loads it until a vehicle needs it. Tests have to ask explicitly.
   */
  initPhysics(): Promise<PhysicsSnapshot>;

  /** Body and step counts, and the render interpolation factor. */
  getPhysics(): PhysicsSnapshot;

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

  // ---- population ---------------------------------------------------------
  /**
   * Wait for the population chunk and its navmesh.
   *
   * The population is deliberately late — it carries Recast's WebAssembly and
   * loads after the world is standing — so a test that asserts on residents has
   * to say so rather than assume `ready()` covered it.
   */
  awaitPopulation(timeoutMs?: number): Promise<PopulationSnapshot>;
  getPopulation(): PopulationSnapshot | null;
  getNpcs(): readonly NpcSnapshot[];
  getNpc(id: string): NpcSnapshot | null;
  /** Override a resident's destination, bypassing their schedule. */
  sendNpc(id: string, x: number, z: number): boolean;
  /** Re-read every schedule at `hour`, without waiting for the world clock. */
  setNpcHour(hour: number): void;
  getRelationship(id: string): Record<string, number> | null;
  /** Ground height at a point, so a test can assert nobody is floating. */
  getGround(x: number, z: number): number;
  /**
   * Hold the population still and hide it.
   *
   * For measurements about something else — a draw-call assertion on the
   * player's rig cannot be made against a village of moving pedestrians.
   */
  setPopulationActive(on: boolean): void;
  /** Raise a perception event at a point, attributed to the player. */
  emitPerception(kind: string, x: number, y: number, z: number): void;
  getTraffic(): readonly TrafficSnapshot[];
  /**
   * Put the page into a reproducible state for a screenshot: hide the dev
   * readout, stop the wind and the clock, then settle. Idempotent.
   */
  prepareShot(frames?: number): void;

  // ---- Phase 7 --------------------------------------------------------------
  /** Every door in the active zone, with whether it is open right now. */
  getDoors(): readonly DoorSnapshot[];
  /**
   * Go through a named door.
   *
   * Resolves false when the building is shut or the door is unknown, which is
   * the same answer the prompt gives — so a test exercises the real path
   * rather than a bypass.
   */
  enterDoor(doorId: string): Promise<boolean>;
  /** What is open, what it contains, and where stepping outside leads. */
  getInterior(): InteriorSnapshot | null;
  getWallet(): WalletSnapshot;
  /** Top up, so a test can reach a price without doing a shift first. */
  giveMoney(amount: number): void;
  getServiceMenu(serviceId: string): ServiceMenuSnapshot | null;
  /** Run one offer. Returns 'ok' or the failure reason. */
  useService(serviceId: string, offerId: string): string;
  getTask(): TaskSnapshot | null;
  startTask(taskId: string): boolean;
  /** Report that a named place was used, as walking into it would. */
  reportTask(place: string): boolean;
  /** Feed the task clock without waiting. */
  advanceTask(seconds: number): void;
  cancelTask(): void;
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

    spawnVehicle(
      kind: string,
      x: number,
      z: number,
      facing = 0,
      atY?: number,
    ): Promise<string | null> {
      return surface.spawnVehicle(kind, x, z, facing, atY);
    },

    setVehicleInput(id: string, input: Partial<VehicleInputData>): void {
      surface.setVehicleInput(id, input);
    },

    getVehicle(id: string): VehicleSnapshot | null {
      return surface.vehicleTelemetry(id);
    },

    resetVehicle(id: string, x: number, y: number, z: number, facing = 0): void {
      surface.resetVehicle(id, x, y, z, facing);
    },

    despawnVehicle(id: string): void {
      surface.despawnVehicle(id);
    },

    enterVehicle(id: string, seatId?: string): Promise<boolean> {
      return surface.enterVehicle(id, seatId);
    },

    exitVehicle(): Promise<boolean> {
      return surface.exitVehicle();
    },

    getRidingVehicle(): string | null {
      return surface.ridingVehicle();
    },

    setVehicleLocked(id: string, locked: boolean): void {
      surface.setVehicleLocked(id, locked);
    },

    giveItem(id: string, count = 1): boolean {
      return surface.giveItem(id, count);
    },

    recoverVehicle(id: string): boolean {
      return surface.recoverVehicle(id);
    },

    rollVehicle(id: string): void {
      surface.rollVehicle(id);
    },

    pressFlip(): void {
      surface.pressFlip();
    },

    getTestRoadMark(name: string) {
      return surface.testRoadMark(name);
    },

    getVehicleRecord(id: string): unknown {
      return surface.vehicleRecord(id);
    },

    setFuelEnabled(on: boolean): void {
      surface.setFuelEnabled(on);
    },

    initPhysics(): Promise<PhysicsSnapshot> {
      return surface.initPhysics();
    },

    getPhysics(): PhysicsSnapshot {
      return surface.physicsState();
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

    /**
     * Advance the simulation, drawing only the frame that is left on screen.
     *
     * Nothing observes an intermediate frame — a screenshot, a
     * `getRenderStats` read or a visual assertion all happen after `settle`
     * returns, and the last frame is drawn. What this removes is 899 software
     * rasterisations of a scene nobody looks at.
     *
     * It is not a micro-optimisation. Headless Chromium has no GPU, and a
     * populated village is ~600 k triangles over ~480 draw calls; the browser
     * suite was spending minutes per scenario here and timing out on it.
     */
    settle(frames = 40): void {
      for (let i = 0; i < frames - 1; i++) surface.step(FIXED_DT, false);
      if (frames > 0) surface.step(FIXED_DT, true);
    },

    async awaitPopulation(timeoutMs = 30000): Promise<PopulationSnapshot> {
      const settled = await surface.awaitPopulation();
      // Navigation resolves after the population exists. Poll rather than
      // expose another promise: 'failed' is a legitimate terminal state and a
      // test should be able to assert on it.
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const now = surface.populationState();
        if (now && (now.navState === 'ready' || now.navState === 'failed')) return now;
        await new Promise((r) => window.setTimeout(r, 50));
      }
      return settled;
    },

    getPopulation(): PopulationSnapshot | null {
      return surface.populationState();
    },

    getNpcs(): readonly NpcSnapshot[] {
      return surface.npcList();
    },

    getNpc(id: string): NpcSnapshot | null {
      return surface.npcState(id);
    },

    sendNpc(id: string, x: number, z: number): boolean {
      return surface.npcSendTo(id, x, z);
    },

    setNpcHour(hour: number): void {
      surface.npcApplyHour(hour);
    },

    getRelationship(id: string): Record<string, number> | null {
      return surface.relationship(id);
    },

    getGround(x: number, z: number): number {
      return surface.groundAt(x, z);
    },

    setPopulationActive(on: boolean): void {
      surface.populationActive(on);
    },

    emitPerception(kind: string, x: number, y: number, z: number): void {
      surface.emitPerception(kind, x, y, z);
    },

    getTraffic(): readonly TrafficSnapshot[] {
      return surface.trafficList();
    },

    prepareShot(frames = 40): void {
      pinPresentation();
      // Stale keys otherwise walk the player out of frame while settling.
      surface.releaseInput();
      bridge.settle(frames);
    },

    getDoors(): readonly DoorSnapshot[] {
      return surface.doorList();
    },

    enterDoor(doorId: string): Promise<boolean> {
      return surface.enterDoor(doorId);
    },

    getInterior(): InteriorSnapshot | null {
      return surface.interiorState();
    },

    getWallet(): WalletSnapshot {
      return surface.walletState();
    },

    giveMoney(amount: number): void {
      surface.giveMoney(amount);
    },

    getServiceMenu(serviceId: string): ServiceMenuSnapshot | null {
      return surface.serviceMenu(serviceId);
    },

    useService(serviceId: string, offerId: string): string {
      return surface.runService(serviceId, offerId);
    },

    getTask(): TaskSnapshot | null {
      return surface.taskState();
    },

    startTask(taskId: string): boolean {
      return surface.beginTask(taskId);
    },

    reportTask(place: string): boolean {
      return surface.reportTask(place);
    },

    advanceTask(seconds: number): void {
      surface.advanceTask(seconds);
    },

    cancelTask(): void {
      surface.cancelTask();
    },
  };

  window.__LH_TEST__ = bridge;
  return bridge;
}

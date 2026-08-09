/**
 * Short scenes, made from the camera and things that already exist.
 *
 * No video files, and no new animation system. A cutscene here is a list of
 * shots; a shot is a camera move, a duration, an optional caption and an
 * optional gesture from the ten clips `player.glb` already carries. The
 * staging is the world as it stands — the sun where the clock has it, the
 * residents wherever their schedules put them.
 *
 * That is a deliberate ceiling rather than a shortcut. A scene that posed the
 * cast would need every one of them fetched from wherever they are, which is a
 * teleport the player watches happen; and a scene that pinned the sun would
 * contradict a life clock the whole game is built on. What this can do is
 * *point*, and pointing is most of what these beats need.
 *
 * Offsets are **relative to a named anchor**, in metres, so a scene survives
 * the village being re-laid out — the same reason the save records a spawn id
 * rather than a position.
 */

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CutsceneShot {
  readonly seconds: number;
  /** Camera offset from the anchor at the start of the shot. */
  readonly from: Vec3Like;
  /** Offset at the end. Absent means a held shot. */
  readonly to?: Vec3Like;
  /** `player`, `anchor`, or a named resident's id. */
  readonly look: string;
  readonly captionKey?: string;
  /** One of the clips in `player.glb`: Wave, CarryBox, UsePhone. */
  readonly gesture?: string;
}

export interface CutsceneDef {
  readonly id: string;
  /** Named place the offsets are measured from. */
  readonly anchor: string;
  readonly shots: readonly CutsceneShot[];
  /**
   * Every scene is skippable.
   *
   * There is no such thing as a cutscene worth trapping somebody in, and a
   * player on their second run has seen it. The field exists so the *rule* is
   * visible in the data rather than assumed in the player.
   */
  readonly skippable: true;
}

const scene = (
  id: string,
  anchor: string,
  shots: readonly CutsceneShot[],
): CutsceneDef => ({ id, anchor, shots, skippable: true });

/**
 * Nine scenes, all under thirty seconds.
 *
 * `storyValidation` enforces the ceiling. Thirty seconds is about the point at
 * which a browser game's audience reaches for the tab bar, and none of these
 * beats needs longer — the longest is the ending at 26 s and it is carrying a
 * decade.
 */
export const CUTSCENES: readonly CutsceneDef[] = [
  scene('cs_first_horizon', 'village_bench', [
    { seconds: 3.5, from: { x: 0, y: 1.6, z: 3.2 }, to: { x: 0, y: 1.8, z: 5.5 }, look: 'player',
      captionKey: 'scene.cs_first_horizon.1' },
    { seconds: 4, from: { x: -4, y: 2.4, z: 4 }, to: { x: 4, y: 3.2, z: 6 }, look: 'anchor',
      captionKey: 'scene.cs_first_horizon.2' },
  ]),

  scene('cs_the_road_out', 'village_junction', [
    { seconds: 3, from: { x: 2, y: 1.5, z: -4 }, to: { x: 2, y: 2.2, z: -9 }, look: 'player' },
    { seconds: 4.5, from: { x: 0, y: 14, z: -20 }, to: { x: 0, y: 20, z: -40 }, look: 'anchor',
      captionKey: 'scene.cs_the_road_out.1' },
  ]),

  scene('cs_the_survey_peg', 'village_field', [
    { seconds: 3, from: { x: 0.8, y: 0.6, z: 1.4 }, to: { x: 0.4, y: 0.35, z: 0.9 }, look: 'anchor',
      captionKey: 'scene.cs_the_survey_peg.1' },
    { seconds: 4, from: { x: -3, y: 6, z: 3 }, to: { x: -8, y: 11, z: 8 }, look: 'anchor',
      captionKey: 'scene.cs_the_survey_peg.2' },
  ]),

  scene('cs_leaving_the_village', 'village_home', [
    { seconds: 3, from: { x: 1.6, y: 1.5, z: 2.4 }, look: 'player', gesture: 'CarryBox',
      captionKey: 'scene.cs_leaving_the_village.1' },
    { seconds: 4, from: { x: 0, y: 2.2, z: 6 }, to: { x: 0, y: 4.5, z: 16 }, look: 'player' },
    { seconds: 4, from: { x: 0, y: 22, z: 26 }, to: { x: 0, y: 34, z: 52 }, look: 'anchor',
      captionKey: 'scene.cs_leaving_the_village.2' },
  ]),

  scene('cs_a_name_of_your_own', 'om_square', [
    { seconds: 3.5, from: { x: 3, y: 1.7, z: 3 }, to: { x: -3, y: 1.7, z: 3 }, look: 'player',
      captionKey: 'scene.cs_a_name_of_your_own.1' },
    { seconds: 4, from: { x: 0, y: 12, z: 10 }, to: { x: 0, y: 18, z: 20 }, look: 'anchor' },
  ]),

  scene('cs_the_letter', 'apartment_desk', [
    { seconds: 3.5, from: { x: 0.5, y: 1.3, z: 1.1 }, to: { x: 0.2, y: 1.0, z: 0.7 }, look: 'anchor',
      captionKey: 'scene.cs_the_letter.1', gesture: 'UsePhone' },
    { seconds: 3.5, from: { x: -1.4, y: 1.6, z: 1.8 }, look: 'player',
      captionKey: 'scene.cs_the_letter.2' },
  ]),

  scene('cs_what_the_road_costs', 'village_field', [
    { seconds: 4, from: { x: 4, y: 2, z: 4 }, to: { x: 1.5, y: 1.7, z: 2.2 }, look: 'player',
      captionKey: 'scene.cs_what_the_road_costs.1' },
    { seconds: 5, from: { x: -6, y: 9, z: 6 }, to: { x: -14, y: 18, z: 14 }, look: 'anchor',
      captionKey: 'scene.cs_what_the_road_costs.2' },
  ]),

  scene('cs_the_last_horizon', 'village_hill', [
    { seconds: 4, from: { x: 2.5, y: 1.7, z: 3 }, to: { x: 0.5, y: 1.7, z: 2 }, look: 'player',
      captionKey: 'scene.cs_the_last_horizon.1' },
    { seconds: 6, from: { x: 0, y: 3, z: 6 }, to: { x: 0, y: 8, z: 22 }, look: 'player',
      captionKey: 'scene.cs_the_last_horizon.2' },
    { seconds: 8, from: { x: 0, y: 30, z: 40 }, to: { x: 0, y: 60, z: 110 }, look: 'anchor',
      captionKey: 'scene.cs_the_last_horizon.3' },
    { seconds: 6, from: { x: 0, y: 70, z: 130 }, to: { x: 0, y: 90, z: 190 }, look: 'anchor',
      captionKey: 'scene.cs_the_last_horizon.4' },
  ]),

  scene('cs_the_lookout', 'village_hill', [
    { seconds: 3, from: { x: 1.5, y: 1.6, z: 2.5 }, look: 'player' },
    { seconds: 5, from: { x: 0, y: 4, z: 8 }, to: { x: 0, y: 12, z: 34 }, look: 'anchor',
      captionKey: 'scene.cs_the_lookout.1' },
  ]),
];

const BY_ID = new Map(CUTSCENES.map((c) => [c.id, c]));

export function cutscene(id: string): CutsceneDef | null {
  return BY_ID.get(id) ?? null;
}

export function sceneLength(def: CutsceneDef): number {
  return def.shots.reduce((sum, s) => sum + s.seconds, 0);
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** What a scene needs from the game, and nothing more. */
export interface CutsceneHost {
  /** World position of a named place, or null when it is not in this zone. */
  place(name: string): Vec3Like | null;
  playerPosition(): Vec3Like;
  /** World position of a named resident, or null when they are not around. */
  npcPosition(id: string): Vec3Like | null;
  /** Put the camera exactly here, looking exactly there. */
  setCamera(at: Vec3Like, lookAt: Vec3Like): void;
  /** Hand the camera back to the player. */
  releaseCamera(): void;
  setCaption(text: string | null): void;
  playGesture(name: string): void;
  fade(on: boolean, seconds: number): Promise<void>;
  /** Player control is off for the duration. */
  setControlsEnabled(on: boolean): void;
}

const FADE_SECONDS = 0.45;

/**
 * Plays one scene, driven by `advance(dt)`.
 *
 * **Reads no clock**, like everything else in this phase, so a scene can be
 * stepped through in a unit test without a browser and without waiting eight
 * real seconds for a shot to end.
 *
 * The camera is *set* rather than tweened toward: interpolating between shots
 * would smear the cut, and a cut is the one bit of grammar this has. Within a
 * shot the position lerps, which is the move.
 */
export class CutscenePlayer {
  private def: CutsceneDef | null = null;
  private shotIndex = 0;
  private shotTime = 0;
  private anchor: Vec3Like = { x: 0, y: 0, z: 0 };
  private finished: (() => void) | null = null;

  constructor(private readonly host: CutsceneHost) {}

  get playing(): boolean {
    return this.def !== null;
  }

  get currentScene(): string | null {
    return this.def?.id ?? null;
  }

  /**
   * Start a scene. Resolves when it ends, however it ends.
   *
   * A scene whose anchor is not in the loaded zone **does not play** and
   * resolves immediately. That is the honest failure: the alternative is a
   * camera flying to the origin, which reads as a crash.
   */
  async play(def: CutsceneDef): Promise<void> {
    const anchor = this.host.place(def.anchor);
    if (!anchor || def.shots.length === 0) return;

    this.def = def;
    this.anchor = anchor;
    this.shotIndex = 0;
    this.shotTime = 0;

    // Control is taken *before* the first await, and the completion promise is
    // created before it too. Both matter, and a test found out why: building
    // the promise after `await fade()` meant a scene skipped during its own
    // fade called `stop()` while `finished` was still null, so nothing ever
    // resolved and the stage awaiting the scene stalled for good. Taking
    // control synchronously also stops the player walking off during the fade.
    this.host.setControlsEnabled(false);
    const done = new Promise<void>((resolve) => {
      this.finished = resolve;
    });

    await this.host.fade(true, FADE_SECONDS);
    // Still ours? A skip during the fade already tore the scene down, and
    // applying a shot now would grab a camera nobody is going to give back.
    if (this.def === def) this.applyShot(0);
    await this.host.fade(false, FADE_SECONDS);

    return done;
  }

  advance(dt: number): void {
    const def = this.def;
    if (!def || !Number.isFinite(dt) || dt <= 0) return;

    this.shotTime += dt;
    const shot = def.shots[this.shotIndex];
    if (!shot) {
      this.stop();
      return;
    }

    if (this.shotTime >= shot.seconds) {
      this.shotIndex++;
      this.shotTime = 0;
      if (this.shotIndex >= def.shots.length) {
        this.stop();
        return;
      }
      this.applyShot(this.shotIndex);
      return;
    }

    this.frame(shot, this.shotTime / shot.seconds);
  }

  /** Skip to the end. Every scene allows it. */
  skip(): void {
    if (this.def) this.stop();
  }

  private applyShot(index: number): void {
    const shot = this.def?.shots[index];
    if (!shot) return;
    this.host.setCaption(shot.captionKey ?? null);
    if (shot.gesture) this.host.playGesture(shot.gesture);
    this.frame(shot, 0);
  }

  private frame(shot: CutsceneShot, u: number): void {
    const a = shot.from;
    const b = shot.to ?? shot.from;
    const at = {
      x: this.anchor.x + a.x + (b.x - a.x) * u,
      y: this.anchor.y + a.y + (b.y - a.y) * u,
      z: this.anchor.z + a.z + (b.z - a.z) * u,
    };
    this.host.setCamera(at, this.lookTarget(shot.look));
  }

  private lookTarget(look: string): Vec3Like {
    if (look === 'anchor') return this.anchor;
    if (look === 'player') {
      const p = this.host.playerPosition();
      return { x: p.x, y: p.y + 1.1, z: p.z };
    }
    const npc = this.host.npcPosition(look);
    return npc ? { x: npc.x, y: npc.y + 1.1, z: npc.z } : this.anchor;
  }

  private stop(): void {
    if (!this.def && !this.finished) return;
    this.def = null;
    this.shotIndex = 0;
    this.shotTime = 0;
    this.host.setCaption(null);
    this.host.releaseCamera();
    this.host.setControlsEnabled(true);
    const done = this.finished;
    this.finished = null;
    done?.();
  }
}

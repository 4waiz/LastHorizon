import type { Vec3Like } from '../nav/NavTypes';

/**
 * What an NPC notices, and how sure they are.
 *
 * This is the layer Phase 9's police system will read. It is built now, without
 * heat, arrests or dispatch, because the expensive and easy-to-get-wrong part
 * is not the police — it is deciding honestly whether somebody *could* have
 * seen a thing. Building that first means the police can never be omniscient
 * later: there will be no code path that hands them a position nobody
 * witnessed.
 *
 * Four gates, and all four are real:
 *
 * - **distance**, against the observer's sight range
 * - **field of view**, so somebody facing away sees nothing
 * - **occlusion**, resolved by the caller's raycast — a wall stops sight
 * - **hearing**, which ignores facing, survives occlusion at reduced strength,
 *   and is the only way a gunshot behind a building gets noticed
 *
 * Everything here is pure. `perceive` takes the occlusion answer as an argument
 * rather than casting a ray itself, so the whole matrix of angles, distances
 * and walls is unit-testable without a scene.
 */

export type PerceptionKind =
  | 'greeting'
  | 'collision'
  | 'dangerous_driving'
  | 'theft'
  | 'weapon_display'
  | 'gunshot'
  | 'injured'
  | 'crime';

export type PerceptionChannel = 'sight' | 'hearing';

export interface PerceptionEvent {
  readonly id: number;
  readonly kind: PerceptionKind;
  readonly at: Vec3Like;
  /** 'player', or a named NPC id. Never a raw object reference. */
  readonly actor: string;
  /**
   * How far the sound carries, in metres. Zero for a silent event, which then
   * can only be seen.
   */
  readonly loudness: number;
  /** 0..1. How much this should matter to whoever notices it. */
  readonly severity: number;
  /** Whether this is a crime for Phase 9's purposes. Data, unused here. */
  readonly criminal: boolean;
}

export interface Observer {
  readonly id: string;
  /** Eye position, not foot position. */
  readonly eye: Vec3Like;
  /** Facing in radians, glTF convention: atan2(dir.x, dir.z). */
  readonly facing: number;
  readonly sightRange: number;
  /** Full cone width in radians. */
  readonly fov: number;
  readonly hearingRange: number;
}

export interface Perception {
  readonly perceived: boolean;
  readonly via: PerceptionChannel | null;
  /** 0..1: how well. Feeds witness reliability in Phase 9. */
  readonly confidence: number;
  readonly distance: number;
}

const NOT_PERCEIVED: Perception = {
  perceived: false,
  via: null,
  confidence: 0,
  distance: Infinity,
};

/** A person facing forward, awake, not paying special attention. */
export const DEFAULT_SENSES = {
  sightRange: 26,
  /** 140 degrees. Human useful field, not the 180 that lets people see sideways. */
  fov: (140 * Math.PI) / 180,
  hearingRange: 34,
} as const;

/**
 * Can `observer` notice `event`?
 *
 * `occluded` is what a raycast between the two found. It is only consulted for
 * sight; hearing is attenuated rather than blocked, because a shout through a
 * wall is quieter and not silent, and a system where a thin fence makes a
 * gunshot inaudible reads as a bug.
 */
export function perceive(
  observer: Observer,
  event: PerceptionEvent,
  occluded: boolean,
): Perception {
  const dx = event.at.x - observer.eye.x;
  const dy = event.at.y - observer.eye.y;
  const dz = event.at.z - observer.eye.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const flat = Math.hypot(dx, dz);

  // --- sight -------------------------------------------------------------
  if (!occluded && distance <= observer.sightRange && flat > 1e-4) {
    const bearing = Math.atan2(dx, dz);
    const off = Math.abs(angleDelta(bearing, observer.facing));
    if (off <= observer.fov / 2) {
      // Falls off with distance and with how far off-centre it was. Something
      // at the very edge of vision at the very edge of range is noticed, but
      // not well enough to describe afterwards.
      const byRange = 1 - distance / observer.sightRange;
      const byAngle = 1 - off / (observer.fov / 2);
      const confidence = clamp01(0.35 + 0.65 * byRange * (0.4 + 0.6 * byAngle));
      return { perceived: true, via: 'sight', confidence, distance };
    }
  }

  // --- hearing -----------------------------------------------------------
  if (event.loudness > 0) {
    const reach = Math.min(observer.hearingRange, event.loudness) * (occluded ? 0.55 : 1);
    if (distance <= reach) {
      // Heard, never seen: enough to turn and look, not enough to identify.
      const confidence = clamp01(0.15 + 0.4 * (1 - distance / Math.max(reach, 1e-3)));
      return { perceived: true, via: 'hearing', confidence, distance };
    }
  }

  return { ...NOT_PERCEIVED, distance };
}

/** Signed smallest angle from `b` to `a`, in (-pi, pi]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/**
 * What a witness does about it.
 *
 * Six behaviours, all cheap, all readable at a glance from across a street.
 * That readability is the whole design constraint: an ambient pedestrian has no
 * dialogue and no persistence, so the only thing that tells a player they were
 * noticed is the shape of the reaction.
 */
export type ReactionKind = 'step_aside' | 'greet' | 'watch' | 'flee' | 'call_help' | 'resume';

export interface ReactionInput {
  readonly kind: PerceptionKind;
  readonly confidence: number;
  readonly distance: number;
  /** 0..1. A frightened NPC flees from things a calm one only watches. */
  readonly fear: number;
  /** 0..1. Familiar faces get greeted; strangers get watched. */
  readonly familiarity: number;
}

/**
 * Pure reaction selection.
 *
 * Ordered by urgency, not by likelihood: the dangerous cases are decided first
 * so a marginal confidence on a gunshot cannot fall through into "greet".
 */
export function chooseReaction(input: ReactionInput): ReactionKind {
  const { kind, confidence, distance, fear, familiarity } = input;

  if (confidence < 0.12) return 'resume';

  switch (kind) {
    case 'gunshot':
    case 'weapon_display':
      return distance < 18 || fear > 0.3 ? 'flee' : 'call_help';

    case 'crime':
    case 'theft':
      // Close enough to be in danger, or already frightened, and they run.
      if (distance < 8 || fear > 0.5) return 'flee';
      return confidence > 0.45 ? 'call_help' : 'watch';

    case 'dangerous_driving':
      return distance < 6 ? 'step_aside' : 'watch';

    case 'injured':
      return confidence > 0.4 ? 'call_help' : 'watch';

    case 'collision':
      return 'step_aside';

    case 'greeting':
      if (fear > 0.45) return 'watch';
      return familiarity > 0.15 ? 'greet' : distance < 4 ? 'greet' : 'watch';
  }
}

// ---------------------------------------------------------------------------
// The bus
// ---------------------------------------------------------------------------

export interface Witness {
  readonly observerId: string;
  readonly event: PerceptionEvent;
  readonly perception: Perception;
}

/**
 * A one-frame queue of things that happened.
 *
 * Events live for exactly one simulation tick. Nothing accumulates, because the
 * moment a perception layer starts remembering is the moment it becomes the
 * police system, and that is Phase 9's job.
 */
export class PerceptionBus {
  private queue: PerceptionEvent[] = [];
  private nextId = 1;
  /** Rolling count, for the debug overlay and for tests. */
  emitted = 0;
  witnessed = 0;

  emit(
    kind: PerceptionKind,
    at: Vec3Like,
    actor: string,
    opts: { loudness?: number; severity?: number; criminal?: boolean } = {},
  ): PerceptionEvent {
    const event: PerceptionEvent = {
      id: this.nextId++,
      kind,
      at: { x: at.x, y: at.y, z: at.z },
      actor,
      loudness: opts.loudness ?? DEFAULT_LOUDNESS[kind],
      severity: opts.severity ?? DEFAULT_SEVERITY[kind],
      criminal: opts.criminal ?? CRIMINAL_BY_DEFAULT.has(kind),
    };
    this.queue.push(event);
    this.emitted++;
    return event;
  }

  get pending(): readonly PerceptionEvent[] {
    return this.queue;
  }

  /**
   * Match this tick's events against observers and clear the queue.
   *
   * `isOccluded` is injected: the caller owns the collision world and can
   * short-circuit the raycast for events that are obviously too far away, which
   * matters because this runs against every near-tier NPC.
   */
  resolve(
    observers: readonly Observer[],
    isOccluded: (from: Vec3Like, to: Vec3Like) => boolean,
  ): Witness[] {
    if (this.queue.length === 0) return [];
    const out: Witness[] = [];

    for (const event of this.queue) {
      for (const observer of observers) {
        if (observer.id === event.actor) continue;

        // Cheap rejection before the raycast: nothing beyond both ranges can
        // be perceived by any channel, and the square test avoids a sqrt.
        const reach = Math.max(observer.sightRange, Math.min(observer.hearingRange, event.loudness));
        const dx = event.at.x - observer.eye.x;
        const dy = event.at.y - observer.eye.y;
        const dz = event.at.z - observer.eye.z;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;

        const occluded = isOccluded(observer.eye, event.at);
        const perception = perceive(observer, event, occluded);
        if (perception.perceived) {
          out.push({ observerId: observer.id, event, perception });
          this.witnessed++;
        }
      }
    }

    this.queue = [];
    return out;
  }

  /** Drop everything without resolving. Used on zone change and on pause. */
  clear(): void {
    this.queue = [];
  }
}

/** Metres each kind carries. Zero means it can only be seen. */
const DEFAULT_LOUDNESS: Record<PerceptionKind, number> = {
  greeting: 8,
  collision: 6,
  dangerous_driving: 20,
  theft: 0,
  weapon_display: 0,
  gunshot: 90,
  injured: 14,
  crime: 4,
};

const DEFAULT_SEVERITY: Record<PerceptionKind, number> = {
  greeting: 0.05,
  collision: 0.15,
  dangerous_driving: 0.45,
  theft: 0.6,
  weapon_display: 0.75,
  gunshot: 1,
  injured: 0.7,
  crime: 0.65,
};

const CRIMINAL_BY_DEFAULT = new Set<PerceptionKind>([
  'theft',
  'weapon_display',
  'gunshot',
  'crime',
]);

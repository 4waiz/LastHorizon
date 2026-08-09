import type { RelationshipData } from '../save/SaveSchema';
import { clamp } from '../utils/MathUtils';

/**
 * Five axes, and no sixth.
 *
 * The brief for this system was "avoid dozens of opaque meters", and the way
 * that promise is kept is by making the axes answer different questions rather
 * than shades of the same one:
 *
 * - **familiarity** — do they know you? Only ever rises, and only by meeting.
 * - **trust** — will they rely on you? Earned slowly, lost fast.
 * - **affection** — do they like you? Warmth, independent of trust.
 * - **fear** — do they avoid you? Drives flee-versus-watch reactions.
 * - **respect** — do they take you seriously? Competence, not kindness.
 *
 * All five are 0..1 and clamp on write, so no amount of accumulated deltas can
 * put a value somewhere the reaction code has not been written for.
 */

export const RELATIONSHIP_AXES = [
  'familiarity',
  'trust',
  'affection',
  'fear',
  'respect',
] as const;

export type RelationshipAxis = (typeof RELATIONSHIP_AXES)[number];

export type RelationshipAxes = Record<RelationshipAxis, number>;

export const NEUTRAL: Readonly<RelationshipAxes> = Object.freeze({
  familiarity: 0,
  trust: 0,
  affection: 0,
  fear: 0,
  respect: 0,
});

/**
 * How much one greeting is worth.
 *
 * Deliberately small. Familiarity is the only axis a greeting moves, because
 * saying hello to somebody twenty times should make you a known face and not a
 * trusted friend.
 */
export const GREETING_FAMILIARITY = 0.02;

export class RelationshipStore {
  private readonly axes = new Map<string, RelationshipAxes>();

  /** A copy, so a caller cannot write through the return value. */
  get(npcId: string): RelationshipAxes {
    const found = this.axes.get(npcId);
    return found ? { ...found } : { ...NEUTRAL };
  }

  has(npcId: string): boolean {
    return this.axes.has(npcId);
  }

  /** Overwrite, clamped. Used by seeding and by save restore. */
  set(npcId: string, values: Partial<RelationshipAxes>): void {
    const current = this.axes.get(npcId) ?? { ...NEUTRAL };
    for (const axis of RELATIONSHIP_AXES) {
      const v = values[axis];
      if (typeof v === 'number' && Number.isFinite(v)) current[axis] = clamp(v, 0, 1);
    }
    this.axes.set(npcId, current);
  }

  /** Add signed deltas, clamped. Returns the result. */
  adjust(npcId: string, deltas: Partial<RelationshipAxes>): RelationshipAxes {
    const current = this.axes.get(npcId) ?? { ...NEUTRAL };
    for (const axis of RELATIONSHIP_AXES) {
      const d = deltas[axis];
      if (typeof d === 'number' && Number.isFinite(d)) {
        current[axis] = clamp(current[axis] + d, 0, 1);
      }
    }
    this.axes.set(npcId, current);
    return { ...current };
  }

  /** Meeting somebody. Familiarity only, and with diminishing returns. */
  greet(npcId: string): RelationshipAxes {
    const current = this.get(npcId);
    // The closer to fully familiar, the less a further greeting adds; a
    // stranger becomes an acquaintance quickly and never becomes a friend by
    // repetition alone.
    const gain = GREETING_FAMILIARITY * (1 - current.familiarity);
    return this.adjust(npcId, { familiarity: gain });
  }

  /**
   * Names for the axes, for a UI that has to say something out loud.
   *
   * Bands rather than numbers: "a familiar face" tells a player more than 0.42,
   * and it keeps the UI honest about how coarse the underlying model is.
   */
  static describe(axes: RelationshipAxes): string {
    if (axes.fear > 0.6) return 'wary of you';
    if (axes.affection > 0.7 && axes.trust > 0.6) return 'a close friend';
    if (axes.trust > 0.6) return 'trusts you';
    if (axes.affection > 0.5) return 'fond of you';
    if (axes.respect > 0.6) return 'respects you';
    if (axes.familiarity > 0.5) return 'a familiar face';
    if (axes.familiarity > 0.1) return 'someone you have met';
    return 'a stranger';
  }

  get size(): number {
    return this.axes.size;
  }

  /** Sorted by id, so two saves of the same state are byte-identical. */
  toJSON(): RelationshipData[] {
    return [...this.axes.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([npcId, v]) => ({ npcId, ...v }));
  }

  /**
   * Replace everything from a save.
   *
   * Tolerant of rows for NPCs that no longer exist: content changes between
   * versions and a removed resident should not cost the player their save. The
   * simulation looks relationships up by id and simply never asks for that one.
   */
  fromJSON(rows: readonly RelationshipData[] | undefined): void {
    this.axes.clear();
    for (const row of rows ?? []) {
      if (typeof row?.npcId !== 'string' || row.npcId.length === 0) continue;
      this.set(row.npcId, row);
    }
  }

  clear(): void {
    this.axes.clear();
  }
}

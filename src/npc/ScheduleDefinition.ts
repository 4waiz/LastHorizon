/**
 * What a named resident is doing, by the hour.
 *
 * A schedule is a sorted list of blocks keyed on the hour they begin. The block
 * in force at hour *h* is the last one that began at or before *h* — and if no
 * block has begun yet today, it is the last block of the previous day, still
 * running. That single rule is what makes midnight free: a schedule that starts
 * its day at 07:00 with a `sleep` block ending it at 22:00 needs no special
 * case for 02:00, because 02:00 falls through to yesterday's 22:00 block.
 *
 * No Three.js, no clock, no randomness. Everything here is a pure function of
 * (schedule, hour), which is what lets the whole day be walked in a unit test
 * in under a millisecond instead of over twenty real minutes.
 */

export type ActivityKind =
  | 'sleep'
  | 'home'
  | 'commute'
  | 'work'
  | 'meal'
  | 'leisure'
  | 'social'
  | 'quest';

/** Which of an NPC's anchors an activity happens at. */
export type AnchorSlot = 'home' | 'work' | 'leisure' | 'social';

export interface ScheduleBlock {
  /** Hour of day this block begins, 0 <= from < 24. Fractions allowed. */
  readonly from: number;
  readonly kind: ActivityKind;
  readonly place: AnchorSlot;
}

export interface ScheduleDefinition {
  readonly id: string;
  /** Sorted ascending by `from`, first block at 0 or later. */
  readonly blocks: readonly ScheduleBlock[];
}

export const HOURS_PER_DAY = 24;

/** Day fraction (WorldClock's 0..1) to hour of day. */
export function hourOfDay(dayFraction: number): number {
  const wrapped = dayFraction - Math.floor(dayFraction);
  return wrapped * HOURS_PER_DAY;
}

/**
 * The block in force at `hour`.
 *
 * Returns the *last* block that has begun. When the hour precedes every block's
 * start the answer is the final block of the list, which is yesterday's
 * evening still in progress — the midnight wrap, without a branch for it.
 */
export function resolveActivity(
  schedule: ScheduleDefinition,
  hour: number,
): ScheduleBlock {
  const h = normaliseHour(hour);
  const { blocks } = schedule;
  let active = blocks[blocks.length - 1];
  for (const block of blocks) {
    if (block.from <= h) active = block;
    else break;
  }
  return active;
}

export interface Transition {
  /** Hours from `hour` until the next block begins. Always > 0. */
  readonly inHours: number;
  /** Hour of day the next block begins. */
  readonly at: number;
  readonly block: ScheduleBlock;
}

/**
 * When the schedule next changes, and to what.
 *
 * Used by the far tier to sleep until something is actually going to happen
 * instead of re-deciding every tick. Never returns zero hours: at exactly a
 * boundary the answer is the *following* boundary, or the far tier would spin.
 */
export function nextTransition(schedule: ScheduleDefinition, hour: number): Transition {
  const h = normaliseHour(hour);
  for (const block of schedule.blocks) {
    if (block.from > h) return { inHours: block.from - h, at: block.from, block };
  }
  const first = schedule.blocks[0];
  return { inHours: HOURS_PER_DAY - h + first.from, at: first.from, block: first };
}

export function normaliseHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const h = hour % HOURS_PER_DAY;
  return h < 0 ? h + HOURS_PER_DAY : h;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ScheduleIssue {
  readonly schedule: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Structural checks on a schedule.
 *
 * The two that matter are ordering — `resolveActivity` reads the list in order
 * and stops early, so an unsorted list silently returns the wrong block — and
 * having somewhere to sleep. A resident with no `sleep` block stands in the
 * street all night, which is the single most obvious way for a village to stop
 * looking alive.
 */
export function validateSchedule(s: ScheduleDefinition): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const push = (code: string, message: string) =>
    issues.push({ schedule: s.id, code, message });

  if (s.blocks.length === 0) {
    push('empty-schedule', 'schedule has no blocks');
    return issues;
  }

  let previous = -1;
  for (const b of s.blocks) {
    if (!Number.isFinite(b.from) || b.from < 0 || b.from >= HOURS_PER_DAY) {
      push('bad-hour', `block at ${b.from} is outside 0..24`);
    }
    if (b.from <= previous) {
      push('unsorted', `block at ${b.from} does not follow the one at ${previous}`);
    }
    if (b.from === previous) {
      push('duplicate-hour', `two blocks begin at ${b.from}`);
    }
    previous = b.from;
  }

  if (!s.blocks.some((b) => b.kind === 'sleep')) {
    push('no-sleep', 'schedule never sleeps; this NPC will stand outdoors all night');
  }
  if (s.blocks.length < 3) {
    push('too-coarse', 'a day of fewer than three blocks does not read as a routine');
  }

  return issues;
}

export function validateSchedules(all: readonly ScheduleDefinition[]): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.id)) {
      issues.push({ schedule: s.id, code: 'duplicate-id', message: `schedule ${s.id} declared twice` });
    }
    seen.add(s.id);
    issues.push(...validateSchedule(s));
  }
  return issues;
}

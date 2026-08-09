import { describe, it, expect } from 'vitest';
import {
  HOURS_PER_DAY,
  hourOfDay,
  normaliseHour,
  nextTransition,
  resolveActivity,
  validateSchedule,
  validateSchedules,
  type ScheduleDefinition,
} from '../src/npc/ScheduleDefinition';
import { SCHEDULES, scheduleById } from '../src/npc/schedules';

/**
 * A day is twenty real minutes, so every one of these would take that long to
 * observe in the running game. They take a millisecond here, which is the whole
 * argument for `resolveActivity` being a pure function of (schedule, hour).
 */

const simple: ScheduleDefinition = {
  id: 'simple',
  blocks: [
    { from: 7, kind: 'home', place: 'home' },
    { from: 9, kind: 'work', place: 'work' },
    { from: 17, kind: 'leisure', place: 'leisure' },
    { from: 22, kind: 'sleep', place: 'home' },
  ],
};

describe('schedule resolution', () => {
  it('returns the block in force at an hour', () => {
    expect(resolveActivity(simple, 7).kind).toBe('home');
    expect(resolveActivity(simple, 8.99).kind).toBe('home');
    expect(resolveActivity(simple, 9).kind).toBe('work');
    expect(resolveActivity(simple, 16.5).kind).toBe('work');
    expect(resolveActivity(simple, 17).kind).toBe('leisure');
    expect(resolveActivity(simple, 22).kind).toBe('sleep');
  });

  it('wraps past midnight onto the previous evening', () => {
    // The failure this guards: 02:00 precedes every block's start hour. Without
    // the wrap rule the answer is undefined, or the *first* block, which puts
    // everybody at home and awake at two in the morning.
    expect(resolveActivity(simple, 0).kind).toBe('sleep');
    expect(resolveActivity(simple, 2).kind).toBe('sleep');
    expect(resolveActivity(simple, 6.99).kind).toBe('sleep');
  });

  it('treats hours outside 0..24 as the same time of day', () => {
    expect(resolveActivity(simple, 24 + 10).kind).toBe(resolveActivity(simple, 10).kind);
    expect(resolveActivity(simple, -2).kind).toBe(resolveActivity(simple, 22).kind);
  });

  it('never returns a block for a non-finite hour', () => {
    expect(resolveActivity(simple, NaN).kind).toBe('sleep');
    expect(resolveActivity(simple, Infinity).kind).toBe('sleep');
  });

  it('covers every hour of the day with something', () => {
    for (let h = 0; h < HOURS_PER_DAY; h += 0.25) {
      expect(resolveActivity(simple, h)).toBeTruthy();
    }
  });
});

describe('next transition', () => {
  it('finds the following block', () => {
    const t = nextTransition(simple, 8);
    expect(t.at).toBe(9);
    expect(t.inHours).toBe(1);
    expect(t.block.kind).toBe('work');
  });

  it('wraps to tomorrow past the last block', () => {
    const t = nextTransition(simple, 23);
    expect(t.at).toBe(7);
    expect(t.inHours).toBe(8);
  });

  it('never returns zero hours when sitting exactly on a boundary', () => {
    // A zero would spin the far tier: it would wake, find nothing has changed,
    // and schedule itself to wake again immediately.
    for (const block of simple.blocks) {
      expect(nextTransition(simple, block.from).inHours).toBeGreaterThan(0);
    }
  });
});

describe('hour helpers', () => {
  it('converts the world clock day fraction to an hour', () => {
    expect(hourOfDay(0)).toBe(0);
    expect(hourOfDay(0.5)).toBe(12);
    expect(hourOfDay(0.615)).toBeCloseTo(14.76, 5);
    // The world clock wraps; so does this.
    expect(hourOfDay(1.25)).toBe(6);
  });

  it('normalises negatives into the day', () => {
    expect(normaliseHour(-1)).toBe(23);
    expect(normaliseHour(-25)).toBe(23);
    expect(normaliseHour(48)).toBe(0);
  });
});

describe('validation', () => {
  it('accepts every shipped schedule', () => {
    expect(validateSchedules(SCHEDULES)).toEqual([]);
  });

  it('ships a schedule for every id the catalogue can name', () => {
    for (const s of SCHEDULES) expect(scheduleById(s.id)).toBe(s);
    expect(scheduleById('nonexistent')).toBeNull();
  });

  it('rejects an unsorted block list', () => {
    // `resolveActivity` reads in order and stops early, so unsorted is not a
    // style problem — it silently returns the wrong block.
    const bad: ScheduleDefinition = {
      id: 'bad',
      blocks: [
        { from: 9, kind: 'work', place: 'work' },
        { from: 7, kind: 'home', place: 'home' },
        { from: 22, kind: 'sleep', place: 'home' },
      ],
    };
    expect(validateSchedule(bad).map((i) => i.code)).toContain('unsorted');
  });

  it('rejects a schedule that never sleeps', () => {
    const bad: ScheduleDefinition = {
      id: 'insomniac',
      blocks: [
        { from: 7, kind: 'home', place: 'home' },
        { from: 9, kind: 'work', place: 'work' },
        { from: 17, kind: 'leisure', place: 'leisure' },
      ],
    };
    expect(validateSchedule(bad).map((i) => i.code)).toContain('no-sleep');
  });

  it('rejects hours outside the day and duplicate ids', () => {
    const bad: ScheduleDefinition = {
      id: 'dup',
      blocks: [
        { from: 0, kind: 'sleep', place: 'home' },
        { from: 25, kind: 'work', place: 'work' },
        { from: 26, kind: 'home', place: 'home' },
      ],
    };
    expect(validateSchedule(bad).map((i) => i.code)).toContain('bad-hour');
    expect(validateSchedules([bad, bad]).map((i) => i.code)).toContain('duplicate-id');
  });

  it('rejects an empty schedule without throwing', () => {
    expect(validateSchedule({ id: 'empty', blocks: [] }).map((i) => i.code)).toEqual([
      'empty-schedule',
    ]);
  });
});

describe('the night shift', () => {
  const nightShift = scheduleById('night_shift')!;

  it('is at work in the small hours', () => {
    // The schedule's first block is at 07:00 and its last starts at 21:00, so
    // every hour from midnight to seven resolves through the wrap.
    for (const h of [0, 1, 3, 5, 6.9]) {
      expect(resolveActivity(nightShift, h).kind).toBe('work');
    }
  });

  it('is asleep in the middle of the day', () => {
    expect(resolveActivity(nightShift, 12).kind).toBe('sleep');
  });
});

import type { ScheduleDefinition } from './ScheduleDefinition';

/**
 * The routines, as data.
 *
 * Seven of them cover twenty residents because a routine is a *shape* of day,
 * not a person: the shopkeeper and the barista both open early and close late,
 * and what makes them different is where their anchors are, not what hour they
 * get up. Adding an eighth resident should mean adding a row to the catalogue,
 * not a schedule.
 *
 * Hours are local to the world clock, which runs a day every twenty real
 * minutes. Blocks are sorted; `resolveActivity` depends on it and
 * `validateSchedules` enforces it.
 */

const earlyTrade: ScheduleDefinition = {
  id: 'early_trade',
  blocks: [
    { from: 5.5, kind: 'home', place: 'home' },
    { from: 6.5, kind: 'commute', place: 'work' },
    { from: 7, kind: 'work', place: 'work' },
    { from: 12.5, kind: 'meal', place: 'work' },
    { from: 13.5, kind: 'work', place: 'work' },
    { from: 18, kind: 'commute', place: 'home' },
    { from: 18.5, kind: 'meal', place: 'home' },
    { from: 19.5, kind: 'social', place: 'social' },
    { from: 21.5, kind: 'home', place: 'home' },
    { from: 22.5, kind: 'sleep', place: 'home' },
  ],
};

const officeDay: ScheduleDefinition = {
  id: 'office_day',
  blocks: [
    { from: 6.75, kind: 'home', place: 'home' },
    { from: 8, kind: 'commute', place: 'work' },
    { from: 8.75, kind: 'work', place: 'work' },
    { from: 13, kind: 'meal', place: 'leisure' },
    { from: 14, kind: 'work', place: 'work' },
    { from: 17.5, kind: 'commute', place: 'home' },
    { from: 18.25, kind: 'leisure', place: 'leisure' },
    { from: 20, kind: 'meal', place: 'home' },
    { from: 21, kind: 'social', place: 'social' },
    { from: 23, kind: 'sleep', place: 'home' },
  ],
};

const nightShift: ScheduleDefinition = {
  id: 'night_shift',
  blocks: [
    // Begins the list mid-shift on purpose: the wrap rule means 02:00 resolves
    // to the previous day's 21:00 block without this needing to say so.
    { from: 7, kind: 'commute', place: 'home' },
    { from: 7.75, kind: 'meal', place: 'home' },
    { from: 8.5, kind: 'sleep', place: 'home' },
    { from: 16, kind: 'home', place: 'home' },
    { from: 17, kind: 'leisure', place: 'leisure' },
    { from: 19, kind: 'meal', place: 'home' },
    { from: 20.25, kind: 'commute', place: 'work' },
    { from: 21, kind: 'work', place: 'work' },
  ],
};

const shoreDay: ScheduleDefinition = {
  id: 'shore_day',
  blocks: [
    { from: 4.5, kind: 'home', place: 'home' },
    { from: 5, kind: 'commute', place: 'work' },
    { from: 5.5, kind: 'work', place: 'work' },
    { from: 11, kind: 'meal', place: 'work' },
    { from: 12, kind: 'work', place: 'work' },
    { from: 15.5, kind: 'commute', place: 'home' },
    { from: 16, kind: 'leisure', place: 'leisure' },
    { from: 18.5, kind: 'meal', place: 'home' },
    { from: 19.5, kind: 'social', place: 'social' },
    { from: 21, kind: 'sleep', place: 'home' },
  ],
};

const homeKeeper: ScheduleDefinition = {
  id: 'home_keeper',
  blocks: [
    { from: 6.5, kind: 'home', place: 'home' },
    { from: 9, kind: 'leisure', place: 'leisure' },
    { from: 11, kind: 'home', place: 'home' },
    { from: 12.5, kind: 'meal', place: 'home' },
    { from: 14, kind: 'social', place: 'social' },
    { from: 16.5, kind: 'home', place: 'home' },
    { from: 19, kind: 'meal', place: 'home' },
    { from: 20, kind: 'leisure', place: 'leisure' },
    { from: 22, kind: 'sleep', place: 'home' },
  ],
};

const student: ScheduleDefinition = {
  id: 'student',
  blocks: [
    { from: 7, kind: 'home', place: 'home' },
    { from: 8, kind: 'commute', place: 'work' },
    { from: 8.5, kind: 'work', place: 'work' },
    { from: 12.5, kind: 'meal', place: 'leisure' },
    { from: 13.5, kind: 'work', place: 'work' },
    { from: 15.5, kind: 'leisure', place: 'leisure' },
    { from: 18, kind: 'meal', place: 'home' },
    { from: 19, kind: 'social', place: 'social' },
    { from: 21.5, kind: 'home', place: 'home' },
    { from: 22.5, kind: 'sleep', place: 'home' },
  ],
};

const retired: ScheduleDefinition = {
  id: 'retired',
  blocks: [
    { from: 6, kind: 'home', place: 'home' },
    { from: 7.5, kind: 'leisure', place: 'leisure' },
    { from: 10, kind: 'social', place: 'social' },
    { from: 12, kind: 'meal', place: 'home' },
    { from: 14, kind: 'leisure', place: 'leisure' },
    { from: 17, kind: 'home', place: 'home' },
    { from: 18.5, kind: 'meal', place: 'home' },
    { from: 19.5, kind: 'social', place: 'social' },
    { from: 21, kind: 'sleep', place: 'home' },
  ],
};

export const SCHEDULES: readonly ScheduleDefinition[] = [
  earlyTrade,
  officeDay,
  nightShift,
  shoreDay,
  homeKeeper,
  student,
  retired,
];

const BY_ID = new Map(SCHEDULES.map((s) => [s.id, s]));

export function scheduleById(id: string): ScheduleDefinition | null {
  return BY_ID.get(id) ?? null;
}

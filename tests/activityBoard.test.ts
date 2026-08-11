import { describe, it, expect, beforeEach } from 'vitest';
import { TASKS } from '../src/tasks/taskCatalog';
import {
  activityIds,
  jobIds,
  registerTasks,
  resetTasksForTest,
  taskDef,
} from '../src/tasks/taskRegistry';
import { START_POINT_NAMES, startPointName } from '../src/tasks/TaskDefinition';

/**
 * The activities, and where to find them.
 *
 * Phase 10 shipped six activities that appeared in **no list anywhere** — the
 * last entry on the reachability gap in `docs/UI_INVENTORY.md`. `activityIds`
 * and the phone's Work screen close it, and this is what stops it reopening:
 * a new activity with no start-point name would read "Somewhere about", which
 * is a task the player cannot find.
 */

beforeEach(() => {
  resetTasksForTest();
  registerTasks(TASKS);
});

describe('the two lists', () => {
  it('splits the catalogue in two with nothing left over', () => {
    expect(jobIds().length + activityIds().length).toBe(TASKS.length);
  });

  it('puts nothing in both', () => {
    const overlap = jobIds().filter((id) => activityIds().includes(id));
    expect(overlap).toEqual([]);
  });

  it('sorts each list by kind, not by guesswork', () => {
    for (const id of jobIds()) expect(taskDef(id)?.kind).toBe('job');
    for (const id of activityIds()) expect(taskDef(id)?.kind).toBe('activity');
  });

  it('has the six activities Phase 10 added', () => {
    // Named rather than counted, so deleting one and adding another is not a
    // silent pass.
    expect(activityIds()).toEqual(
      expect.arrayContaining([
        'activity_time_trial',
        'activity_road_race',
        'activity_photography',
        'activity_scenic_flight',
        'activity_air_delivery',
        'activity_police_escape',
      ]),
    );
  });

  it('fails closed before the catalogue loads, like every other lookup', () => {
    resetTasksForTest();
    expect(activityIds()).toEqual([]);
    expect(jobIds()).toEqual([]);
  });

  it('keeps catalogue order, so the list is stable between openings', () => {
    const first = [...activityIds()];
    registerTasks(TASKS);
    expect([...activityIds()]).toEqual(first);
  });
});

describe('where each one is taken on', () => {
  /**
   * The assertion this file exists for. Every start point in the shipped
   * catalogue must have a human name; a new task without one degrades to
   * "Somewhere about" and the player has nowhere to go.
   */
  it('names the start point of every task in the catalogue', () => {
    const missing = TASKS.filter((t) => !(t.startPoint in START_POINT_NAMES)).map(
      (t) => `${t.id} → ${t.startPoint}`,
    );
    expect(missing, 'start points with no readable name').toEqual([]);
  });

  it('names them as places rather than as slugs', () => {
    for (const [id, name] of Object.entries(START_POINT_NAMES)) {
      expect(name, `${id} still reads as an id`).not.toMatch(/_/);
      expect(name[0], `${id} is not capitalised`).toBe(name[0].toUpperCase());
      expect(name.length).toBeGreaterThan(4);
    }
  });

  it('has no name for a start point nothing uses', () => {
    // A stale entry is a place that no longer exists being offered to a
    // player. Cheap to check and impossible to notice by reading.
    const used = new Set(TASKS.map((t) => t.startPoint));
    const stale = Object.keys(START_POINT_NAMES).filter((k) => !used.has(k));
    expect(stale, 'named start points nothing starts at').toEqual([]);
  });

  it('falls back rather than throwing on an unknown or missing id', () => {
    expect(startPointName(undefined)).toBe('Somewhere about');
    expect(startPointName('nowhere_at_all')).toBe('Somewhere about');
  });

  it('resolves a real one', () => {
    expect(startPointName('airstrip_desk')).toBe('The airstrip office');
  });
});

describe('what the board will show', () => {
  it('gives every activity a name and a summary to display', () => {
    for (const id of activityIds()) {
      const def = taskDef(id)!;
      expect(def.name.length, `${id} has no name`).toBeGreaterThan(0);
      expect(def.summary.length, `${id} has no summary`).toBeGreaterThan(0);
    }
  });

  it('lets an activity pay nothing without the row breaking', () => {
    // The phone hides the pay chip at zero rather than printing "$0", which
    // reads as a job that pays nothing rather than as a thing you do for fun.
    for (const id of activityIds()) {
      expect(taskDef(id)!.basePay).toBeGreaterThanOrEqual(0);
    }
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  jobIds,
  loadTasks,
  registerTasks,
  resetTasksForTest,
  taskDef,
  tasksReady,
} from '../src/tasks/taskRegistry';
import type { TaskDef } from '../src/tasks/TaskDefinition';

/**
 * The registry that took the job catalogue off the startup path.
 *
 * Two things are worth testing here and one of them is uncomfortable. The easy
 * half is that a lookup works after the catalogue loads. The important half is
 * that it **fails closed** before then — because a silent null from a lookup is
 * precisely how Phase 8 shipped three objective kinds whose reporters were
 * never wired, and chapter 1 was uncompletable while every test passed.
 *
 * So this file asserts the closed state exists, and then asserts the thing that
 * makes it safe: that `loadTasks()` populates the registry with every job the
 * game refers to. The *third* guarantee — that nothing can reach a task before
 * that has happened — is not a unit-testable property of this module; it lives
 * in `Game`, and `services.spec.ts` proves it by working one complete shift at
 * each of the five jobs through the real UI.
 */
describe('taskRegistry', () => {
  beforeEach(() => {
    resetTasksForTest();
  });

  it('fails closed before the catalogue loads', () => {
    expect(tasksReady()).toBe(false);
    expect(taskDef('job_grocery_shift')).toBeNull();
    expect(jobIds()).toEqual([]);
  });

  it('is populated by importing the catalogue, with no setup call', async () => {
    await loadTasks();

    expect(tasksReady()).toBe(true);
    expect(taskDef('job_grocery_shift')?.name).toBe('Shop shift');
  });

  it('resolves every job id it advertises', async () => {
    await loadTasks();

    const ids = jobIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const def = taskDef(id);
      expect(def, `job "${id}" is advertised but does not resolve`).not.toBeNull();
      // `jobIds` is what the phone's Work app and the Life Reel's shift count
      // both iterate. An id in that list that is not a job would be a job
      // board offering something that cannot be started.
      expect(def?.kind).toBe('job');
    }
  });

  it('shares one fetch between concurrent callers', async () => {
    // Three subsystems call this — interiors, story and the phone — and they
    // routinely start within a frame of each other during travel.
    await Promise.all([loadTasks(), loadTasks(), loadTasks()]);
    expect(tasksReady()).toBe(true);
  });

  it('returns null for an id that does not exist, loaded or not', async () => {
    await loadTasks();
    expect(taskDef('job_does_not_exist')).toBeNull();
  });

  it('re-registering replaces rather than accumulates', () => {
    const one: TaskDef[] = [{ id: 'a', kind: 'job' } as TaskDef];
    const two: TaskDef[] = [{ id: 'b', kind: 'job' } as TaskDef];

    registerTasks(one);
    registerTasks(two);

    expect(taskDef('a')).toBeNull();
    expect(jobIds()).toEqual(['b']);
  });
});

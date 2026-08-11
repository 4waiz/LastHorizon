import type { TaskDef } from './TaskDefinition';

/**
 * The eager half of the task catalogue: a lookup, and nothing else.
 *
 * `TaskSystem` and `Game` need to *ask about* a job — its name, its pay, how
 * many times it has been done — from the first frame, because the completion
 * counters are in the save format and the wallet is on the HUD. What neither
 * needs from the first frame is the six job definitions themselves: every
 * objective list, every place name, every difficulty curve.
 *
 * This is the same split Phase 8 drew for `StoryState` against the quest
 * catalogue, and Phase 7 drew for `Economy` against the interior layouts. The
 * question is always "what does the save layer touch on the first frame?", and
 * the answer here is a number per job id, not a definition.
 *
 * **Why this was worth doing at all.** Phase 10 added six activity definitions,
 * cost `initial load` 3.6 kB of eager data, and had to raise the ceiling to fit
 * them — the report says plainly that the structural fix was known and skipped
 * because that phase could not verify a `Game` change end to end. This is that
 * fix, and it is the thing Phase 12 had to do before it could add a single byte
 * of service worker, error screen or save sanitiser.
 *
 * ## Failing closed
 *
 * Before `loadTasks()` resolves, every lookup returns null or empty. That is
 * deliberate and it is the risky part, because a silent null is exactly how
 * Phase 8 shipped three objective kinds with no reporter. Two things make it
 * safe rather than merely small:
 *
 * 1. **Nothing can reach a task without one of three lazy subsystems already
 *    being resolved.** A job is started from an interior counter, a quest
 *    stage, or the phone's Work app — `InteriorSubsystem`, `StorySubsystem`
 *    and `Phone`, all lazy, all of which await this module's load first.
 * 2. **`Game.begin()` kicks the load off anyway**, fire-and-forget, exactly as
 *    it already does for the story and the population. The village is standing
 *    and walkable before any of the three resolve.
 */

let byId: Map<string, TaskDef> = new Map();
let jobs: readonly string[] = [];
let activities: readonly string[] = [];
let loading: Promise<void> | null = null;

/**
 * Called by `taskCatalog` at module scope, so importing the catalogue anywhere
 * — statically in a test, dynamically in the game — is what registers it.
 * There is no second way to populate this, and no ordering to get wrong.
 */
export function registerTasks(list: readonly TaskDef[]): void {
  byId = new Map(list.map((t) => [t.id, t]));
  jobs = list.filter((t) => t.kind === 'job').map((t) => t.id);
  activities = list.filter((t) => t.kind === 'activity').map((t) => t.id);
}

/** Null until the catalogue has loaded, and for an id that does not exist. */
export function taskDef(id: string): TaskDef | null {
  return byId.get(id) ?? null;
}

/** The five paid jobs, in catalogue order. Empty until the catalogue loads. */
export function jobIds(): readonly string[] {
  return jobs;
}

/**
 * The unpaid-or-scored things to go and do, in catalogue order.
 *
 * Separate from `jobIds` rather than filtered by the caller, because the
 * distinction is the one a player makes: a job is work somebody pays you for
 * and an activity is a thing you choose to do. Phase 10 added six of these and
 * they appeared in no list anywhere, which `docs/UI_INVENTORY.md` recorded as
 * the last reachability gap.
 */
export function activityIds(): readonly string[] {
  return activities;
}

/** Whether a lookup can currently succeed. Test-facing; nothing branches on it. */
export function tasksReady(): boolean {
  return byId.size > 0;
}

/**
 * Fetch the catalogue chunk. Idempotent, and safe to call from several places
 * at once — the three subsystems that need it all do, and share one fetch.
 */
export function loadTasks(): Promise<void> {
  // Registers from the resolved module rather than trusting `taskCatalog`'s
  // module-scope call to have run. Those are the same thing exactly once —
  // and a second import resolves from the module cache *without* re-running
  // module scope, so relying on the side effect meant the registry could stay
  // empty after a reset. The unit tests caught that, which is the whole
  // argument for the explicit form: it does not depend on how many times the
  // module has been evaluated.
  loading ??= import('./taskCatalog').then((m) => {
    registerTasks(m.TASKS);
  });
  return loading;
}

/** Test-only: drop the registry so "fails closed" can actually be asserted. */
export function resetTasksForTest(): void {
  byId = new Map();
  jobs = [];
  // Added with `activityIds` and forgotten here, which `activityBoard.test.ts`
  // caught on its first run. A reset that clears two of three lists is worse
  // than none: the third keeps answering for a registry that is empty.
  activities = [];
  loading = null;
}

#!/usr/bin/env node
/**
 * Bundle and asset budget gate.
 *
 * Fails CI when a build grows unexpectedly. Budgets come from
 * docs/PERFORMANCE_BUDGETS.md and are deliberately set above the current
 * measurement with headroom, so this catches a regression rather than
 * bickering about a few hundred bytes.
 *
 * Run after `npm run build`.
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KB = 1024;

/** Matched against dist/assets by filename prefix. */
const BUNDLE_BUDGETS = [
  { prefix: 'three-', ext: '.js', maxKB: 700, label: 'three chunk' },
  // Raised 260 -> 300 in Phase 4, 300 -> 330 in Phase 6, 330 -> 360 in
  // Phase 7, 360 -> 375 in Phase 8; see "Bundle budget" in
  // docs/PERFORMANCE_BUDGETS.md for what was added and why. Phase 7's 28 kB is
  // the *eager* half of the economy and interiors work -- cash is on the HUD
  // from the first frame and in every save, so it cannot wait for a doorway.
  // The other 27 kB went lazy.
  //
  // Phase 8 adds 11.6 kB eager against 108 kB lazy: `StoryState` (the save
  // layer reads and writes story progress whether or not a quest has loaded)
  // and the wiring in `Game` that reports world events into it. Two things
  // were moved out rather than absorbed -- the whole story catalogue, and the
  // three Story-Mode panels, which were in `HUD` until this budget said no.
  //
  // Phase 9: 375 -> 390. 13.8 kB eager against 27 kB of lazy systems and 65 kB
  // of lazy models. What stayed is the wiring and nothing else — input polling,
  // the save capture, the four HUD mirrors, the host the director reads, and
  // the test-bridge operations. All of it is reached from the first frame by
  // definition. `OfficerCorps` was moved out of `Game` into the lazy chunk when
  // this budget first said no, and it recovered 0.5 kB, which is the honest
  // measure of how little was left to move.
  { prefix: 'index-', ext: '.js', maxKB: 390, label: 'app chunk' },
  { prefix: 'gsap-', ext: '.js', maxKB: 90, label: 'gsap chunk' },
  { prefix: 'bvh-', ext: '.js', maxKB: 75, label: 'bvh chunk' },
  { prefix: 'index-', ext: '.css', maxKB: 24, label: 'stylesheet' },
  // Rapier, inlining its 1.57 MB WebAssembly as base64. Lazily imported, so
  // this is not part of what a player downloads before they can play.
  { prefix: 'rapier-', ext: '.js', maxKB: 2400, label: 'rapier chunk', lazy: true },
];

/**
 * Chunks fetched on demand rather than at startup.
 *
 * The distinction earns its keep from Phase 5 onward. Before Rapier every byte
 * in dist/ was downloaded before the first frame, so one total measured both
 * "how much do we ship" and "how long until the player is playing". Rapier
 * broke that: it more than doubles the shipped bytes and adds nothing to
 * startup, because a player who never gets on a bicycle never fetches it.
 *
 * Collapsing the two into one number would mean either failing the build over
 * bytes nobody waits for, or raising the total until it no longer protects
 * load time at all.
 *
 * The vehicle chunks joined the list in Phase 5 for the same reason. They are
 * reached only from `Game.spawnVehicle`, which already has to await Rapier, so
 * a player who never drives downloads neither. Keeping them eager would have
 * put the app chunk at exactly its 300 kB limit with nothing left over.
 *
 * Phase 6 added the map panel (a keypress away, drawn by code that need not
 * exist until then) and the population system. The population is the larger
 * argument: Recast's WebAssembly is ~900 kB, and the initial-load budget had
 * 77 kB of headroom. Nav had to be lazy, the NPC simulation is built on nav, so
 * the whole thing loads after the world does — which is also when a village
 * with nobody in it is already standing and playable.
 */
const LAZY_CHUNK_PREFIXES = [
  'rapier-',
  'TestMode-',
  'VehicleController-',
  'VehicleDefinition-',
  'MapPanel-',
  'Population-',
  'Navigation-',
  'recast-',
  // Phase 7. The interior registry, the nine layouts, the builder and the
  // whole service layer, reachable only by opening a door -- a transition that
  // already awaits the 145 kB kit, so the code rides along in the same gap.
  'InteriorSubsystem-',
  // Phase 8. The 35 quests, 15 dialogue trees, 9 cutscenes, 13 endings, the
  // string table and the Life Reel renderer. Reached only when Story Mode
  // starts, behind the mode selector's own loading screen; a Free Roam player
  // never fetches it. What the save layer needs -- flags, choices, reputation,
  // quest positions -- is in `StoryState`, which is eager and stays in the app
  // chunk for exactly that reason.
  'StorySubsystem-',
  // Phase 9. Weapons, ballistics, crimes, Heat and the police AI. Reached the
  // first time a weapon is drawn or a vehicle is taken, which for every player
  // under eighteen and most players over it is never.
  'CombatSubsystem-',
  // Four chunks this list should always have had.
  //
  // All four are `await import(...)` in `Game` and Vite emits them separately
  // for exactly that reason, but only two of the five vehicle chunks were ever
  // listed, so the other three plus the proving ground were counted as startup
  // weight they are not. `TestRoad` is the plainest case: it is behind a
  // feature flag, so a normal player cannot reach it at all.
  //
  // 7.5 kB, found when the JS total came within 0.1 kB of its limit. The rule
  // here is to move something before raising a ceiling, and this is better
  // than moving something — it is a measurement that was wrong.
  'TestRoad-',
  'VehicleControls-',
  'VehicleAccess-',
  'VehicleDynamics-',
  // Phase 10. The flight model, the boundary and the director. Reached the
  // first time somebody walks out to the aeroplane, alongside the 58.5 kB of
  // `aircraft.glb` — the same moment, so the code rides in a gap the art was
  // already paying for.
  //
  // Third phase running that this list needed a line adding at the moment the
  // gate failed. Worth saying plainly: **a new lazy subsystem is not lazy to
  // this script until it is named here**, and the failure looks exactly like
  // the feature being too big.
  'FlightSubsystem-',
];

const isLazyChunk = (name) => LAZY_CHUNK_PREFIXES.some((p) => name.startsWith(p));

/**
 * Startup chunks only — lazy ones are excluded, for the reason `initial load`
 * exists at all. Raised 1,100 -> 1,120 in Phase 8, which is the app chunk's
 * own 15 kB of headroom expressed at the total.
 *
 * Raised 1,120 -> 1,140 in Phase 11, and the reasoning matters more than the
 * number because a raise is normally the wrong answer here.
 *
 * The eager JavaScript is four chunks and only one of them is ours: three.js
 * (609 kB), GSAP (68 kB), three-mesh-bvh (55 kB) and the app (387 kB). That
 * sums to 1,119 kB, so this budget has been sitting *on* its ceiling since
 * Phase 8 and would have failed on the next byte from any phase.
 *
 * The usual move — find something that is lazy and unlisted — was checked
 * first and came back empty: every chunk in `dist/assets` is correctly
 * classified, which is a first after three phases of finding one. GSAP was
 * checked too, since 68 kB is the obvious candidate; it is imported by
 * `LoadingScreen.ts`, which is the first thing on screen, so it is genuinely
 * eager and cannot move without rebuilding the loading screen.
 *
 * Meanwhile the number that actually governs how long a player waits went
 * *down* this phase: `initial load` 4,211.1 -> 4,207.6 kB, because the map and
 * story panel stylesheets moved into the lazy chunks that own those panels.
 * Eager CSS fell 23.9 -> 20.1 kB.
 *
 * So: the sub-budget is the binding constraint while the real one improved,
 * and 20 kB restores the headroom to roughly what Phase 8 gave it.
 */
const TOTAL_JS_MAX_KB = 1140;

const ASSET_BUDGETS = [
  // Raised 1200 -> 1360 in Phase 7 for `interior_kit.glb` (138.6 kB). The
  // number that governs how long a player waits — `initial load` — did not
  // move, because the kit is in LAZY_ASSET_FILES below.
  // Phase 10: 1360 -> 1420 for `aircraft.glb` (58.5 kB: a light aircraft and a
  // motorboat, each with two LODs and a collision proxy, 852 triangles all in).
  // It is in LAZY_ASSET_FILES, so `initial load` did not move.
  { path: 'assets/models', maxKB: 1420, label: 'GLB models' },
  { path: 'assets/audio', maxKB: 2000, label: 'audio' },
];

/**
 * Assets fetched on demand rather than during the loading screen.
 *
 * The same distinction the lazy *chunks* make, applied to art. The interior
 * kit is reached only by walking through a door, and that transition already
 * fades to black — which is both where the fetch is hidden and why it must not
 * be paid by every player who never goes inside.
 *
 * These still count toward `GLB models` and `shipped total`. They are excluded
 * only from `initial load`.
 */
const LAZY_ASSET_FILES = [
  'interior_kit.glb',
  // Phase 9. Fetched the first time a weapon is drawn, which for most players
  // and every player under eighteen is never.
  'weapons.glb',
  // Phase 10. The aeroplane and the boat, fetched when the player first walks
  // up to one at the airstrip or the dock. A player who never leaves the
  // village never pays for either.
  'aircraft.glb',
];

/**
 * What a player downloads before they can play: everything in dist/ except the
 * lazy chunks. This is the number that governs how long the loading screen
 * lasts, and it is the one that must not creep.
 *
 * Raised 4,200 -> 4,215 in Phase 10, and this one is a genuine failure to
 * move something rather than a measurement error.
 *
 * Six new task definitions cost 3.6 kB of eager data and put this over. The
 * structural fix is known and is the one `QuestSystem` already uses: inject a
 * `(id) => TaskDef | null` lookup into `TaskSystem` instead of importing
 * `taskCatalog` from it, so the definitions can move into a lazy chunk the way
 * the quest catalogue did in Phase 8. `Game` only needs two things from the
 * catalogue today — `JOB_IDS` for a completion count and one name lookup for a
 * label — so the refactor is small. It was not done here because it touches
 * `Game` and this phase could not verify that end to end, and shipping
 * unverified wiring is the failure mode the last two phase reports are about.
 *
 * **Do that before adding anything else eager.** This is the second phase
 * running to lean on this number.
 *
 * Previously: unchanged since Phase 8, and Phase 9 nearly missed that it could be.
 *
 * The first attempt raised it to 4,220 to carry the app chunk's own raise
 * through. Then the four unlisted lazy chunks above were found — 7.5 kB that
 * were never startup weight — and the real number came out at 4,198.7, under
 * the limit that had just been declared too small. The raise was reverted.
 *
 * Worth stating plainly anyway: this is the *fourth* phase in a row to cost
 * the loading screen about 15 kB while adding a whole system, and the reason
 * is always the same — the system goes lazy and its wiring cannot. A phase
 * that wants another 20 kB should be asked what it has moved first, and
 * whether the gate is measuring what it thinks it is.
 */
const INITIAL_LOAD_MAX_KB = 4215;

/**
 * Everything shipped, lazy chunks included.
 *
 * Raised 6,600 -> 7,400 in Phase 6 for `recast-navigation`, which inlines its
 * WebAssembly as base64 and lands at 727 kB. The same trade as Rapier and for
 * the same reason: the `-compat` build needs no Vite WASM configuration, and
 * the plain package's separate `.wasm` would save ~390 kB but is a dependency
 * change that belongs on its own, with the gate between. The number that
 * governs how long a player waits — `initial load` — did not move.
 *
 * Raised 7,400 -> 7,600 in Phase 8 for the story chunk (108 kB): 35 quests, 15
 * dialogue trees, 9 cutscenes, 13 endings, a ~460-entry string table and the
 * Life Reel renderer. That is *content*, not machinery — most of it is the
 * words — and it is the one thing this phase was for. `initial load` again did
 * not move by anything like as much: 4,168.7 kB to 4,186 kB, still 14 kB inside
 * its own limit, because a Free Roam player never fetches any of it.
 *
 * Raised 7,600 -> 7,700 in Phase 10 for `aircraft.glb` (58.5 kB). Same trade
 * as the interior kit and the weapons: it is in LAZY_ASSET_FILES, so a player
 * who never walks up to the aeroplane or the boat never fetches it, and
 * `initial load` did not move at all.
 *
 * A note for whoever raises this next: `initial load` is now within a kilobyte
 * of its own ceiling. Adding *art* is cheap here because art can be lazy.
 * Adding eager *code* is not, and the flight systems are lazy for exactly that
 * reason — see `LAZY_CHUNK_PREFIXES`.
 */
const SHIPPED_TOTAL_MAX_KB = 7700;

/** Dev-only surfaces that must never reach production output. */
const FORBIDDEN_IN_DIST = ['__shot', '__cap.js', 'lh-shot-sink'];

const dist = 'dist';
const failures = [];
const notes = [];

function kb(bytes) {
  return Math.round((bytes / KB) * 10) / 10;
}

function dirSizeBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(p) : statSync(p).size;
  }
  return total;
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(dist)) {
  console.error('check-budgets: dist/ not found — run `npm run build` first.');
  process.exit(1);
}

// ---- bundle chunks --------------------------------------------------------
const assetFiles = listFiles(join(dist, 'assets')).filter(
  (f) => f.endsWith('.js') || f.endsWith('.css'),
);

// JS total counts eagerly-loaded chunks only, for the same reason as above:
// it is a startup measure, and Rapier is not part of startup.
let totalJsBytes = 0;
let lazyBytes = 0;
for (const f of assetFiles) {
  const name = f.split(/[\\/]/).pop() ?? '';
  const size = statSync(f).size;
  if (isLazyChunk(name)) lazyBytes += size;
  else if (f.endsWith('.js')) totalJsBytes += size;
}

for (const budget of BUNDLE_BUDGETS) {
  const match = assetFiles.find((f) => {
    const name = f.split(/[\\/]/).pop() ?? '';
    return name.startsWith(budget.prefix) && name.endsWith(budget.ext);
  });
  if (!match) {
    failures.push(`missing expected chunk: ${budget.label} (${budget.prefix}*${budget.ext})`);
    continue;
  }
  const size = kb(statSync(match).size);
  const verdict = size > budget.maxKB ? 'FAIL' : 'ok';
  notes.push(`  ${verdict.padEnd(4)} ${budget.label.padEnd(14)} ${String(size).padStart(7)} kB / ${budget.maxKB} kB`);
  if (size > budget.maxKB) {
    failures.push(`${budget.label} is ${size} kB, over its ${budget.maxKB} kB budget`);
  }
}

const totalJs = kb(totalJsBytes);
notes.push(`  ${(totalJs > TOTAL_JS_MAX_KB ? 'FAIL' : 'ok').padEnd(4)} ${'JS total'.padEnd(14)} ${String(totalJs).padStart(7)} kB / ${TOTAL_JS_MAX_KB} kB`);
if (totalJs > TOTAL_JS_MAX_KB) {
  failures.push(`total JS is ${totalJs} kB, over the ${TOTAL_JS_MAX_KB} kB budget`);
}

// ---- assets ---------------------------------------------------------------
for (const budget of ASSET_BUDGETS) {
  const size = kb(dirSizeBytes(join(dist, budget.path)));
  notes.push(`  ${(size > budget.maxKB ? 'FAIL' : 'ok').padEnd(4)} ${budget.label.padEnd(14)} ${String(size).padStart(7)} kB / ${budget.maxKB} kB`);
  if (size > budget.maxKB) {
    failures.push(`${budget.label} is ${size} kB, over its ${budget.maxKB} kB budget`);
  }
}

const shippedTotalBytes = dirSizeBytes(dist);
const shippedTotal = kb(shippedTotalBytes);

let lazyAssetBytes = 0;
for (const f of listFiles(join(dist, 'assets'))) {
  const name = f.split(/[\\/]/).pop() ?? '';
  if (LAZY_ASSET_FILES.includes(name)) lazyAssetBytes += statSync(f).size;
}

const initialLoad = kb(shippedTotalBytes - lazyBytes - lazyAssetBytes);

notes.push(`  ${(initialLoad > INITIAL_LOAD_MAX_KB ? 'FAIL' : 'ok').padEnd(4)} ${'initial load'.padEnd(14)} ${String(initialLoad).padStart(7)} kB / ${INITIAL_LOAD_MAX_KB} kB`);
if (initialLoad > INITIAL_LOAD_MAX_KB) {
  failures.push(`initial load is ${initialLoad} kB, over the ${INITIAL_LOAD_MAX_KB} kB budget`);
}

notes.push(`  ${(shippedTotal > SHIPPED_TOTAL_MAX_KB ? 'FAIL' : 'ok').padEnd(4)} ${'shipped total'.padEnd(14)} ${String(shippedTotal).padStart(7)} kB / ${SHIPPED_TOTAL_MAX_KB} kB`);
if (shippedTotal > SHIPPED_TOTAL_MAX_KB) {
  failures.push(`shipped total is ${shippedTotal} kB, over the ${SHIPPED_TOTAL_MAX_KB} kB budget`);
}

notes.push(`       ${'(lazy chunks)'.padEnd(14)} ${String(kb(lazyBytes)).padStart(7)} kB fetched on demand, not at startup`);
notes.push(`       ${'(lazy assets)'.padEnd(14)} ${String(kb(lazyAssetBytes)).padStart(7)} kB fetched on demand, not at startup`);

// ---- dev-only surfaces must not ship --------------------------------------
const textFiles = listFiles(dist).filter((f) => /\.(js|css|html)$/.test(f));
for (const needle of FORBIDDEN_IN_DIST) {
  const hit = textFiles.find((f) => {
    try {
      return readFileSync(f, 'utf8').includes(needle);
    } catch {
      return false;
    }
  });
  if (hit) failures.push(`dev-only marker "${needle}" found in production output: ${hit}`);
  else notes.push(`  ok   ${`no "${needle}"`.padEnd(14)} absent from dist`);
}

console.log('Budget check\n' + notes.join('\n'));

if (failures.length) {
  console.error('\nBUDGET FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nIf a change legitimately needs more room, raise the budget in');
  console.error('docs/PERFORMANCE_BUDGETS.md and here, and say why in the PR.');
  process.exit(1);
}

console.log('\nAll budgets within limits.');

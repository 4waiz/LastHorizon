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
  // Raised from 260 in Phase 4; see "Bundle budget" in
  // docs/PERFORMANCE_BUDGETS.md for what was added and why.
  { prefix: 'index-', ext: '.js', maxKB: 300, label: 'app chunk' },
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
 */
const LAZY_CHUNK_PREFIXES = ['rapier-', 'TestMode-', 'VehicleController-', 'VehicleDefinition-'];

const isLazyChunk = (name) => LAZY_CHUNK_PREFIXES.some((p) => name.startsWith(p));

const TOTAL_JS_MAX_KB = 1100;

const ASSET_BUDGETS = [
  { path: 'assets/models', maxKB: 1200, label: 'GLB models' },
  { path: 'assets/audio', maxKB: 2000, label: 'audio' },
];

/**
 * What a player downloads before they can play: everything in dist/ except the
 * lazy chunks. This is the number that governs how long the loading screen
 * lasts, and it is the one that must not creep.
 */
const INITIAL_LOAD_MAX_KB = 4200;

/** Everything shipped, lazy chunks included. */
const SHIPPED_TOTAL_MAX_KB = 6600;

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
const initialLoad = kb(shippedTotalBytes - lazyBytes);

notes.push(`  ${(initialLoad > INITIAL_LOAD_MAX_KB ? 'FAIL' : 'ok').padEnd(4)} ${'initial load'.padEnd(14)} ${String(initialLoad).padStart(7)} kB / ${INITIAL_LOAD_MAX_KB} kB`);
if (initialLoad > INITIAL_LOAD_MAX_KB) {
  failures.push(`initial load is ${initialLoad} kB, over the ${INITIAL_LOAD_MAX_KB} kB budget`);
}

notes.push(`  ${(shippedTotal > SHIPPED_TOTAL_MAX_KB ? 'FAIL' : 'ok').padEnd(4)} ${'shipped total'.padEnd(14)} ${String(shippedTotal).padStart(7)} kB / ${SHIPPED_TOTAL_MAX_KB} kB`);
if (shippedTotal > SHIPPED_TOTAL_MAX_KB) {
  failures.push(`shipped total is ${shippedTotal} kB, over the ${SHIPPED_TOTAL_MAX_KB} kB budget`);
}

notes.push(`       ${'(lazy chunks)'.padEnd(14)} ${String(kb(lazyBytes)).padStart(7)} kB fetched on demand, not at startup`);

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

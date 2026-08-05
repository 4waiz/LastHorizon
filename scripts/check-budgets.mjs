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
  { prefix: 'index-', ext: '.js', maxKB: 260, label: 'app chunk' },
  { prefix: 'gsap-', ext: '.js', maxKB: 90, label: 'gsap chunk' },
  { prefix: 'bvh-', ext: '.js', maxKB: 75, label: 'bvh chunk' },
  { prefix: 'index-', ext: '.css', maxKB: 24, label: 'stylesheet' },
];

const TOTAL_JS_MAX_KB = 1100;

const ASSET_BUDGETS = [
  { path: 'assets/models', maxKB: 1200, label: 'GLB models' },
  { path: 'assets/audio', maxKB: 2000, label: 'audio' },
];

// dist = JS/CSS (~939 kB) + GLB (953 kB) + audio (1668 kB) + icon + html
// ≈ 3828 kB today. Budget carries ~10% headroom over that.
const SHIPPED_TOTAL_MAX_KB = 4200;

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

let totalJsBytes = 0;
for (const f of assetFiles) if (f.endsWith('.js')) totalJsBytes += statSync(f).size;

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

const shippedTotal = kb(dirSizeBytes(dist));
notes.push(`  ${(shippedTotal > SHIPPED_TOTAL_MAX_KB ? 'FAIL' : 'ok').padEnd(4)} ${'dist total'.padEnd(14)} ${String(shippedTotal).padStart(7)} kB / ${SHIPPED_TOTAL_MAX_KB} kB`);
if (shippedTotal > SHIPPED_TOTAL_MAX_KB) {
  failures.push(`dist total is ${shippedTotal} kB, over the ${SHIPPED_TOTAL_MAX_KB} kB budget`);
}

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

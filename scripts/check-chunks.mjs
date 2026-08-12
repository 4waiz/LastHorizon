#!/usr/bin/env node
/**
 * Every emitted chunk must be *deliberately* eager or *deliberately* lazy.
 *
 * ## Why this script exists
 *
 * Five phases in a row shipped a lazy chunk that `check-budgets.mjs` counted as
 * startup weight, because a chunk is not lazy to that script until somebody
 * remembers to name it in `LAZY_CHUNK_PREFIXES`:
 *
 * | Phase | What was miscounted |
 * | --- | --- |
 * | 8  | `StorySubsystem-` |
 * | 9  | `CombatSubsystem-`, and four vehicle chunks — 7.5 kB |
 * | 10 | `FlightSubsystem-` |
 * | 11 | `SettingsPanel-`, `Phone-`, `PauseMenu-` |
 * | 12 | `taskCatalog-`, `CitySubsystem-` |
 *
 * The failure mode is nasty because it is *silent and displaced*: the omission
 * shows up as the **next** change being over budget, so it looks like that
 * change's fault, and the fix that suggests itself is raising a ceiling. Phase
 * 9's report puts it exactly right — "a gate that under-reports headroom pushes
 * you toward exactly the wrong decision".
 *
 * So: fail when a chunk matches neither list. A new lazy subsystem now has to
 * be classified before the build is green, at the moment its author knows the
 * answer, rather than three phases later by somebody who does not.
 *
 * This is deliberately a *separate* script from the budget gate. The budget
 * gate answers "is it too big"; this answers "do we know what it is". Merging
 * them would mean a classification mistake reported as a size failure, which
 * is the confusion the whole thing is about.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const dist = 'dist';

/**
 * Chunks that are genuinely part of startup. Everything here is imported
 * statically from `main.ts` or `Game.ts` and reached before the first frame.
 */
const EAGER_PREFIXES = [
  'index-', // the app itself, and its stylesheet
  'three-',
  'gsap-',
  'bvh-',
  // A *shared* chunk, and the first one this script ever caught — on the merge
  // that brought the village and airstrip splits together with the city one.
  //
  // Rollup emitted it separately because `CollisionWorld` is imported by both
  // eager code (`ThirdPersonCamera` and `Player`, reached from `Game`) and
  // several lazy runtimes (`VillageSubsystem`, `CitySubsystem`,
  // `AirstripRuntime`). A chunk reached from *any* eager path is eager: the
  // player downloads it before the first frame however many lazy modules also
  // want it.
  //
  // Worth stating because the convenient answer is the wrong one. Adding this
  // to `LAZY_CHUNK_PREFIXES` would have made the gate green and quietly
  // under-reported `initial load` by 3.1 kB — which is precisely the class of
  // mistake this script was written to stop, arriving by a new route. Splitting
  // more subsystems out will produce more shared chunks like it, and every one
  // needs the same question asked rather than the same answer assumed.
  'CollisionWorld-',
];

/** Read the lazy list out of the budget gate rather than keeping a second copy. */
function lazyPrefixes() {
  const src = readFileSync('scripts/check-budgets.mjs', 'utf8');
  const block = /const LAZY_CHUNK_PREFIXES = \[([\s\S]*?)\];/.exec(src);
  if (!block) {
    console.error('check-chunks: could not find LAZY_CHUNK_PREFIXES in check-budgets.mjs');
    process.exit(1);
  }
  // Whole entry lines only. Scanning for any quoted run inside the block picks
  // up apostrophes in the prose — that list is more comment than code — and an
  // odd one pairs with the next real quote and swallows the entries between.
  // It reported seven correctly-listed chunks as unclassified before this was
  // anchored, which would have been a very confusing first failure.
  return [...block[1].matchAll(/^\s*'([^']+)',\s*$/gm)].map((m) => m[1]);
}

if (!existsSync(dist)) {
  console.error('check-chunks: dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const lazy = lazyPrefixes();
const assetsDir = join(dist, 'assets');
const files = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith('.js') || f.endsWith('.css'))
  : [];

const unclassified = [];
const rows = [];

for (const name of files) {
  const isEager = EAGER_PREFIXES.some((p) => name.startsWith(p));
  const isLazy = lazy.some((p) => name.startsWith(p));
  const kb = Math.round((statSync(join(assetsDir, name)).size / 1024) * 10) / 10;

  if (isEager && isLazy) {
    unclassified.push(`${name} matches BOTH an eager and a lazy prefix — one of them is wrong`);
  } else if (!isEager && !isLazy) {
    unclassified.push(`${name} (${kb} kB) is classified as neither eager nor lazy`);
  } else {
    rows.push(`  ${(isLazy ? 'lazy ' : 'eager').padEnd(6)} ${name.padEnd(46)} ${String(kb).padStart(8)} kB`);
  }
}

console.log(`Chunk classification (${files.length} files)\n${rows.join('\n')}`);

if (unclassified.length) {
  console.error('\nUNCLASSIFIED CHUNKS:');
  for (const u of unclassified) console.error(`  - ${u}`);
  console.error(`
Every chunk has to be one or the other, and the answer is obvious now and
will not be later. Add the prefix to LAZY_CHUNK_PREFIXES in
scripts/check-budgets.mjs if it is reached through an \`await import(...)\`,
or to EAGER_PREFIXES here if it is genuinely on the startup path.

Getting this wrong does not fail here — it fails on somebody else's commit,
as a budget overrun that looks like their fault. That has happened in five
consecutive phases, which is why this script exists.`);
  process.exit(1);
}

console.log('\nEvery chunk is deliberately eager or deliberately lazy.');

// ---------------------------------------------------------------------------
// The stylesheet must parse to the end.
//
// Phase 12 merged two branches that had both appended to `src/style.css`, and
// the conflict was resolved by deleting the three marker lines by number. One
// of those numbers was also the closing `}` of an `@media` block, so from that
// point on the file was one unterminated rule — and a CSS parser does not fail
// loudly. It silently drops everything after the error.
//
// The build succeeded. `grep` still found `.dash{position:absolute}` in the
// output, because the *bytes* were all there. What was gone was the browser's
// ability to reach them: `document.styleSheets[0].cssRules` held 159 rules
// where the file describes 181, and every rule after the break — the whole
// vehicle dashboard and flight instrument set — matched nothing.
//
// Two end-to-end tests caught it, which is the system working. This is the
// cheaper check: an unbalanced brace is a build failure, not a mystery two
// hours later.
const cssFiles = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith('.css'))
  : [];

const unbalanced = [];
for (const name of cssFiles) {
  const src = readFileSync(join(assetsDir, name), 'utf8');
  // Minified output has no comments or newlines to confuse this, and CSS
  // string literals containing braces are vanishingly rare — a false positive
  // here is a five-second look at one file.
  const open = (src.match(/{/g) ?? []).length;
  const close = (src.match(/}/g) ?? []).length;
  if (open !== close) unbalanced.push(`${name}: ${open} "{" vs ${close} "}"`);
}

if (unbalanced.length) {
  console.error('\nUNBALANCED STYLESHEET:');
  for (const u of unbalanced) console.error(`  - ${u}`);
  console.error(`
A CSS parser drops every rule after an unterminated block and reports
nothing. The bytes stay in the file, so grep still finds the selector you
are looking for while the browser cannot see it.

Look for a missing "}" — a bad merge resolution is the usual cause.`);
  process.exit(1);
}

console.log(`Stylesheets balanced (${cssFiles.length} checked).`);

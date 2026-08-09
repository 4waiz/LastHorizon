/**
 * Story gate.
 *
 * Runs the same `validateStory()` the unit tests run, from the command line,
 * so a content edit can be checked without booting a browser or a test runner.
 * Wired into `npm run verify` next to `check:budgets`.
 *
 * Uses Vitest's own transform pipeline to load TypeScript rather than adding a
 * second toolchain: the repository already depends on Vitest, and a build step
 * that only exists for this script is a build step that rots.
 */
import { createVitest } from 'vitest/node';

const vitest = await createVitest('test', { watch: false, silent: true });

try {
  const mod = await vitest.import('./src/story/storyValidation.ts');
  const issues = mod.validateStory();

  console.log('Story check');
  if (issues.length === 0) {
    console.log('  ok   no issues across quests, dialogue, cutscenes and endings.');
  } else {
    const byCode = new Map();
    for (const i of issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
    for (const i of issues) console.log(`  FAIL [${i.code}] ${i.where}: ${i.message}`);
    console.log('');
    for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${code}`);
    }
    console.log(`\n${issues.length} issue(s).`);
  }
  await vitest.close();
  process.exit(issues.length === 0 ? 0 : 1);
} catch (err) {
  console.error(err);
  await vitest.close();
  process.exit(1);
}

import { test, expect, type Page } from '@playwright/test';

/**
 * Interior scene cost, per service.
 *
 * The documented "interior" figure (183 draw calls / 780 k triangles) was the
 * Phase 1 *shared room* with its portal pass — one merged GLB. Nine modular
 * rooms are a different shape of cost, so this re-derives it per building and
 * holds the worst case to the budget.
 *
 * It also guards the thing that is easy to break by accident: three.js puts
 * the scene's point-light count in its program cache key, so an interior lit
 * differently from the others makes every material in the scene compile
 * twice. That cost 16 programs against a 70 budget until every room was given
 * the same two lights, and nothing but this test would notice it coming back.
 */

const SERVICES = [
  'home',
  'grocery',
  'police',
  'clinic',
  'garage',
  'apartment',
  'cafe',
  'clothing',
  'airstrip',
] as const;

async function boot(page: Page) {
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => typeof window.__LH_TEST__ !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__LH_TEST__!.ready());
  await page.evaluate(() => window.__LH_TEST__!.setTime(0.45));
}

test('interior scene cost, per service', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);

  const rows = await page.evaluate(async (services) => {
    const t = window.__LH_TEST__!;
    t.setPopulationActive(false);
    t.prepareShot();
    const outdoor = t.getRenderStats();

    const out: Array<Record<string, number | string | boolean>> = [];
    for (const s of services) {
      const door = t.getDoors().find((d) => d.interiorId === s)!;
      await t.enterDoor(door.id);
      t.prepareShot(30);
      const stats = t.getRenderStats();
      const room = t.getInterior()!;
      out.push({
        service: s,
        portal: room.livePortal,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        programs: stats.programs,
        parts: room.parts,
        colliders: room.colliderBoxes,
        roomTris: room.triangles,
      });
      await t.exitInterior();
      t.settle(10);
    }
    return { outdoor, out };
  }, SERVICES);

  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const lines = [
    `outdoor: ${rows.outdoor.drawCalls} calls, ${rows.outdoor.triangles} tris, ${rows.outdoor.programs} programs`,
    `${pad('service', 11)}${pad('portal', 8)}${pad('calls', 7)}${pad('tris', 9)}${pad('prog', 6)}${pad('parts', 7)}${pad('boxes', 7)}roomTris`,
  ];
  for (const r of rows.out) {
    lines.push(
      pad(r.service as string, 11) +
        pad(r.portal ? 'live' : '-', 8) +
        pad(r.drawCalls as number, 7) +
        pad(r.triangles as number, 9) +
        pad(r.programs as number, 6) +
        pad(r.parts as number, 7) +
        pad(r.colliders as number, 7) +
        String(r.roomTris),
    );
  }
  console.log('\n' + lines.join('\n') + '\n');

  // Budget, from docs/PERFORMANCE_BUDGETS.md.
  for (const r of rows.out) {
    expect(r.drawCalls as number, `${r.service} draw calls`).toBeLessThanOrEqual(290);
    expect(r.triangles as number, `${r.service} triangles`).toBeLessThanOrEqual(880_000);
    expect(r.programs as number, `${r.service} programs`).toBeLessThanOrEqual(70);
  }

  // One lighting configuration across all nine. Two distinct counts doubles
  // the program set, and the budget has no room for that.
  const programs = rows.out.map((r) => r.programs as number);
  expect(Math.max(...programs) - Math.min(...programs)).toBeLessThanOrEqual(2);
});

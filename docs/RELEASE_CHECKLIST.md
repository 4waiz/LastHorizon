# Release checklist

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

Run top to bottom. **Anything red stops the release** — the rule from the
brief is that production-ready is not claimed while a mandatory gate is red,
and the honest move when one is red is to say so, not to re-run it until it
is not.

---

## 1. The tree

- [ ] On the branch you mean to ship, and `git status` is clean.
      A dirty tree stamps `-dirty` into the service worker's cache key and
      every diagnostic file, and neither will mean anything afterwards.
- [ ] `npm ci` from the lockfile. Not `npm install`.
- [ ] `package.json` version is the version you are shipping, and
      `CHANGELOG.md` has an entry for it.

## 2. Automated gates

| | Command | Roughly |
| --- | --- | --- |
| [ ] | `npm run verify:static` | 2 min |
| [ ] | `npm run verify` — adds e2e and visual | 25 min |
| [ ] | `npm run release:check` — adds perf and soak | 45 min |

`verify` is the complete non-destructive gate and is what CI requires on a
pull request. `release:check` adds the two long layers, which are deliberately
**not** in `verify`: fifteen minutes on every push is a gate people learn to
ignore, so they run nightly and here.

Inside `verify:static`, each of these has to pass on its own terms:

- [ ] `typecheck` — no `any`, no unexplained `@ts-ignore`
- [ ] `lint` — no blanket disables
- [ ] `test` — unit
- [ ] `test:integration`
- [ ] `build`
- [ ] `check:budgets` — every budget inside its limit
- [ ] `check:chunks` — every chunk deliberately eager or deliberately lazy
- [ ] `check:story` — no impossible prerequisite, cycle, missing string,
      invalid objective target, unreachable branch or duplicate reward, and no
      main-story quest carrying a `combat` objective

## 3. Budgets

- [ ] No budget was raised for this release. If one was, the reason is written
      in `scripts/check-budgets.mjs` *and* `docs/PERFORMANCE_BUDGETS.md`, and
      it says what was tried first.
- [ ] `initial load` has not crept. It is the number that governs how long a
      player waits, and it is the one to defend.
- [ ] Ask the question this project keeps getting wrong: **is the gate
      measuring what it thinks it is?** Five phases in a row shipped a lazy
      chunk counted as startup weight, and Phase 12 found 1.1 MB of audio
      preloading that nobody needed. Check the measurement before the ceiling.

## 4. By hand, in a real browser

The production build (`npm run build && npm run preview`), not the dev server.

- [ ] Boots with **zero console errors** through a full golden path.
- [ ] Prologue: the five keepsakes, found and boxed.
- [ ] Ageing 15 → 18 through real play, birthdays firing once each.
- [ ] Money: a shift worked, groceries bought, something eaten.
- [ ] A vehicle earned, entered, driven, parked, and still there after a
      reload.
- [ ] The city reached, and a building entered.
- [ ] Save, reload, and the run is where it was.
- [ ] Heat triggered and resolved — caught, or surrendered, or waited out.
- [ ] The aeroplane: takeoff, circuit, landing.
- [ ] An ending, and a Life Reel that describes the run you actually had.
- [ ] Free Roam, from the mode selector, with the story chunk never fetched.

## 5. Platform

- [ ] Chromium, Firefox and WebKit all green in CI.
- [ ] Touch: a phone viewport, joystick and buttons reachable, nothing under
      the notch.
- [ ] Gamepad moves the character and takes interactions.
      *(It does not navigate menus. That is a known limitation, not a
      regression.)*
- [ ] Offline: load once, kill the network, reload — the village still starts
      and the offline bar appears.
- [ ] Update: deploy a change and confirm the update bar appears and the game
      does **not** swap under a running session.
- [ ] Context loss: `WEBGL_lose_context` in DevTools raises the graphics
      screen rather than freezing on the last frame.

## 6. Security and licensing

- [ ] `dist/` contains no source map, no `__shot`, no `__cap.js`, no
      `lh-shot-sink`. The budget gate asserts the last three.
- [ ] `window.__LH_TEST__` is **absent** without `?e2e=1`.
- [ ] No secret in client code. There are none to have.
- [ ] `grep -rn "eval(\|new Function" src/` returns nothing.
- [ ] CSP is served as a header as well as a meta tag, so `frame-ancestors`
      applies.
- [ ] An imported save that is hostile — huge, deeply nested, or carrying
      `__proto__` — is refused with a sentence a player can read.
- [ ] `docs/ASSET_LICENSES.md` matches what is actually in `public/`, sizes
      included. It has been wrong twice; re-measure rather than re-read.
- [ ] The credits name Kanban Studios, kanbanstudios.ae and Awaiz Ahmed, and
      list every library with its real licence — **GSAP marked as not open
      source**, because its standard licence is free for most uses and is not
      an OSI licence, and rounding that up in a credits screen is a licensing
      statement rather than a typo.

## 7. Documentation

- [ ] `README.md` describes the game that exists.
- [ ] `CHANGELOG.md` entry for this version.
- [ ] `docs/KNOWN_LIMITATIONS.md` re-checked against the repository, not
      copied forward. It is the document most likely to go quietly stale.
- [ ] `docs/SAVE_FORMAT.md` states the current schema version.
- [ ] The release report lists exact test totals, exact sizes, the browser
      matrix, performance evidence, known risks and how to roll back.

## 8. Ship

- [ ] Tag it: `git tag -a v0.1.0 -m "..."`.
- [ ] Deploy per `docs/DEPLOYMENT.md`, headers included.
- [ ] Post-deploy: private window, boot, reload, offline, update.
- [ ] Rollback path confirmed — and if this release bumped the save schema,
      the release note says a rollback will refuse saves written by it.

---

## The rule

> Do not claim production-ready status if any mandatory gate is red.

A release report that says "green except for X" is worth more than one that
says green. Every phase report in this project has a "what is not done"
section for that reason, and the practice has caught real problems every time.

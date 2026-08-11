# 3. A hand-written service worker, not Workbox

**Date:** 2026-08-11
**Status:** Accepted
**Phase:** 12

---

## Context

The Phase 12 brief asks for "a versioned service worker using a proven Workbox
strategy", an offline shell, an update UI, and — the requirement that actually
shapes the design — *"do not let a stale service worker mix incompatible code
and save schemas."*

The obvious reading is "install `vite-plugin-pwa`". That was considered and
rejected, and the reasoning matters more than the conclusion because the brief
names Workbox by name.

## Decision

Implement Workbox's **strategies** directly, in a build-time plugin
(`scripts/vite-plugin-pwa.ts`) that generates `dist/sw.js` and
`dist/manifest.webmanifest`. Do not take the dependency.

The strategies are Workbox's, unchanged and by the same names:

| Request | Strategy | Why |
| --- | --- | --- |
| Navigation | Network-first, cache fallback | A deployed update is seen on the next visit; offline still gets a shell |
| `/assets/*-<hash>.js\|css` | Cache-first | The hash changed when the bytes did, so a hit is correct by construction |
| `*.glb`, `*.mp3`, `*.png` | Stale-while-revalidate | Instant on a repeat visit, refreshed for the next |
| Anything else | Network, cache fallback | |

## Why not the library

**1. The versioning requirement is not Workbox's model.** Workbox keys a
precache on the *build*. The failure this game has to prevent is a cached build
serving a reader older than the save it is handed, so the cache name carries
`CURRENT_SAVE_VERSION` as well:

```
lh-0.1.0-172aef0-s5-f1
    │      │       │  └─ cache layout
    │      │       └──── save schema  ← the one that matters
    │      └──────────── commit
    └─────────────────── version
```

`scripts/vite-plugin-pwa.ts` reads that number out of `SaveSchema.ts` rather
than restating it, because a second copy is a second thing to forget to bump
and the cost of forgetting is a lost run. Bolting this onto a generated worker
is more work than writing the eighty lines.

**2. A new worker must never activate under a running game.** Workbox's
defaults and most of its documentation push toward `skipWaiting` and
`clientsClaim`. That is right for a document-shaped site and wrong here: taking
over mid-session is *precisely* how last week's JavaScript meets this week's
save. Our worker waits, the page offers an update, and `skipWaiting` happens
only when the player accepts — at which point the page reloads, so code and
schema arrive together.

**3. The repository rule is one major dependency at a time, with the full gate
between each.** Phase 12 already carries a CSP, a crash screen, context-loss
handling, an import guard and two code splits. Adding a build-integrated
dependency in the middle of that is how a physics bug gets confounded with a
loader bug — the exact mistake `docs/adr/0002-vite-7-not-8.md` was written
about.

**4. Auditability, against a restrictive CSP.** The generated worker is ~4 kB
of readable JavaScript that a reviewer can hold in their head, with no runtime
library and nothing that could reach for `eval`. Under the policy added in this
phase, "I can read all of it" is worth more than "it is well tested elsewhere".

## Consequences

**Good.** No new dependency. The cache is keyed on the thing that can actually
corrupt a save. The update flow is explicit and the player chooses it. 4.1 kB
of worker, excluded from `initial load` because it is registered after `load`
fires — see `LAZY_ROOT_FILES` in `scripts/check-budgets.mjs`.

**Bad, and stated rather than glossed.** We now own the correctness of a
service worker, which is a genuinely error-prone thing to own — Workbox exists
because people get this wrong. Specifically not implemented: navigation
preload, range-request handling for audio, precache integrity revisioning
beyond the content hashes already in filenames, and background sync. None is
needed by a single-player local-first game, and each is a real feature Workbox
would have given for free.

**Revisit when** any of those becomes necessary, or when a second developer
has to maintain this. The strategies are the same ones Workbox implements, so
the migration is a rewrite of one file rather than a change of approach.

## Alternatives considered

- **`vite-plugin-pwa` with `injectManifest`.** Closest rejected option: it
  would have let us keep the custom cache key and write the fetch handlers
  ourselves, which is most of what we do here. It still adds the dependency and
  a build integration for the part we were not going to use.
- **`generateSW`.** Rejected outright: the generated worker's versioning cannot
  express the save-schema constraint, which is the whole requirement.
- **No service worker.** Rejected: the brief asks for an offline shell, and the
  game is genuinely local-first — it has no server to be offline *from*, so
  offline play is nearly free once the shell is cached.

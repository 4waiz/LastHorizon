# ADR 0002 — Pin Vite to 7.3.6 rather than 8.x

**Status:** Accepted (Phase 1)
**Date:** 2026-08-05
**Supersedes:** nothing
**Deviates from:** the Phase 1 brief, which targeted "around Vite 8.1"

## Context

The Phase 1 brief targets Vite 8. Vite 8.2.0 was installed and the config was
migrated correctly for it: Vite 8 replaces Rollup with **Rolldown**, renames
`build.rollupOptions` to `build.rolldownOptions`, and **removes the object
form of `manualChunks`** in favour of `advancedChunks.groups`. That migration
was written and is preserved in this repository's history.

The build then failed on this machine:

```
Error: An Application Control policy has blocked this file.
\\?\...\node_modules\@rolldown\binding-win32-x64-msvc\rolldown-binding.win32-x64-msvc.node
```

The npm error text blames a known npm optional-dependency bug and advises
reinstalling. That is a **red herring** — the binary was present and 20.8 MB.
The real cause is the host's security policy:

```
HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy
  VerifiedAndReputablePolicyState = 1   (Smart App Control: Enforced)
```

Windows Smart App Control refuses to load Rolldown's unsigned native `.node`.

The documented fallback, `@rolldown/binding-wasm32-wasi`, was installed and
did load — Rolldown started. But it then failed with:

```
[UNRESOLVED_ENTRY] Cannot resolve entry module ...\vite.config.ts
```

The WASM binding runs under WASI, whose sandboxed filesystem view does not
resolve the Windows absolute path (the project also sits under OneDrive).
So the fallback is not viable here either.

## Decision

**Pin `vite@7.3.6`** — the last release before Rolldown became the bundler —
and keep `build.rollupOptions.output.manualChunks` in its object form, which
Vite 7 still supports.

`vitest@4.1.10` is retained: it declares `vite: ^6 || ^7 || ^8` and does not
depend on Rolldown itself. `npm ls rolldown` confirmed exactly one path into
the tree, `vite@8.2.0 → rolldown@1.2.3`, so dropping to Vite 7 removes it
entirely. The phase's Vitest 4.1 target is therefore met in full.

## Rejected alternatives

- **Disable Smart App Control.** Rejected outright. It is a machine-wide
  security control, and on Windows it **cannot be re-enabled** once turned
  off without reinstalling the OS. Trading an irreversible reduction in the
  developer's security posture for a bundler version is not a defensible
  trade, and it is not a change this project should ask for.
- **Ship the WASM fallback.** Rejected: it cannot resolve the config entry.
- **Stay on Vite 5.** Rejected: Vite 7 is a clean two-major upgrade that the
  full gate passes, and it removes all 5 npm audit vulnerabilities.

## Consequences

- The repo is one major behind the brief's Vite target. Everything else in
  the brief's dependency list is met or exceeded.
- **This is a host constraint, not an inherent one.** A Linux CI runner has
  no Smart App Control and would load Rolldown's native binding normally.
  Vite 8 is therefore likely viable in CI today and on this machine if the
  binding ever ships signed, or is allow-listed by the user.
- The Vite 8 config migration is already understood and documented above, so
  redoing it is a small, known edit rather than fresh research.

## Revisit when

- Rolldown ships a signed Windows binary, **or**
- the user chooses to allow-list that specific binary, **or**
- the build moves to CI/Linux as the source of truth for release artefacts.

At that point: `npm i -D vite@8`, rename `rollupOptions` → `rolldownOptions`,
and replace the `manualChunks` object with:

```ts
advancedChunks: {
  groups: [
    { name: 'bvh',   test: /node_modules[\\/]three-mesh-bvh[\\/]/ },
    { name: 'three', test: /node_modules[\\/]three[\\/]/ },
    { name: 'gsap',  test: /node_modules[\\/]gsap[\\/]/ },
  ],
}
```

The `three` pattern needs the trailing separator so it does not also swallow
`three-mesh-bvh`.

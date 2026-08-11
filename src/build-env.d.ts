/**
 * Build-time constants, substituted by Vite's `define`.
 *
 * Two of them, both about identity rather than behaviour: the version a player
 * would quote in a bug report, and the commit that produced the bundle. They
 * are consumed by the crash-diagnostics bundle (`src/core/Recovery.ts`) and by
 * the service worker's cache key, which is why `__LH_BUILD__` is a commit sha
 * and not a timestamp — see the comment in `vite.config.ts`.
 *
 * Vitest gets the same values through `vitest.config.ts`, so a test can assert
 * on them without a browser.
 */

/** `package.json` version, e.g. "0.1.0". */
declare const __LH_VERSION__: string;

/** Short git sha, `-dirty` when the tree was not clean, or "nogit". */
declare const __LH_BUILD__: string;

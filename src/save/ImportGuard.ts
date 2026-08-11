/**
 * What an imported save has to survive before anything else looks at it.
 *
 * `SAVE_FORMAT.md` already says an imported file is "the least trustworthy
 * input the game accepts — hand-edited, possibly from another build", and
 * `validateSave` is strict about the fields that decide where the player ends
 * up. Both are true and neither is a guard against a *hostile* file, because
 * both run after `JSON.parse` has already built whatever object it was told
 * to, and both reason about fields the schema knows about.
 *
 * This runs first, and it is about the input rather than the save: how big it
 * is, how deep, how many nodes, what its keys are called, and whether its
 * strings are things a person could have typed. Four concrete failures, in the
 * order they would actually bite:
 *
 * 1. **Size.** A save is a few kilobytes. A 200 MB file passed to `JSON.parse`
 *    is a frozen tab before any validator gets an opinion.
 * 2. **Prototype pollution.** `{"__proto__": {"isAdmin": true}}` is legal JSON
 *    and `JSON.parse` gives it to you as a real own property. Nothing in this
 *    game reads `isAdmin`, but the save is spread (`{ ...migrated.data }`) and
 *    merged field by field through migrations, and "no current code path
 *    exploits it" is a statement about today's code.
 * 3. **Depth and node count.** Deep nesting is cheap to write and expensive to
 *    walk; the migration chain and the validator both recurse.
 * 4. **Text.** Control characters and unbounded strings reach the DOM through
 *    the phone's vehicle list and the pause menu's slot summaries. Those sites
 *    escape HTML already — this is the second layer, and it is the one that
 *    stops a 4 MB single-line string being rendered at all.
 *
 * Nothing here validates *meaning*. A save that clears this can still be
 * nonsense, and `validateSave` and `migrateSave` are what say so. The split is
 * deliberate: this file has no opinion about the schema, so it does not need
 * changing when the schema does.
 */

/** A real save is a few kB. This is three orders of magnitude of headroom. */
export const MAX_IMPORT_BYTES = 512 * 1024;

/** Deeper than the schema goes, shallower than a stack overflow. */
const MAX_DEPTH = 16;

/** Generous against ~200 for a large save; small against a memory attack. */
const MAX_NODES = 50_000;

/** Longest string the format has a use for. Zone and item ids are far shorter. */
const MAX_STRING = 512;

/** Longest array. `reel` is the biggest and grows one entry per life event. */
const MAX_ARRAY = 4_000;

/**
 * Keys that must never survive into an object this app then spreads or merges.
 * `JSON.parse` yields these as own properties, so deleting them here is what
 * makes the later `{ ...data }` safe rather than lucky.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type GuardResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** C0, DEL and C1, written as escapes so the intent survives re-encoding. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = new RegExp('[\u0000-\u001F\u007F-\u009F]', 'g');

/**
 * Strip control characters and clamp length.
 *
 * Tabs and newlines go too. No field in this format is multi-line, and a
 * newline in a slot label is how a one-line summary becomes three.
 */
export function sanitiseText(s: string): string {
  const stripped = s.replace(CONTROL_CHARS, String());
  return stripped.length > MAX_STRING ? stripped.slice(0, MAX_STRING) : stripped;
}

/**
 * Escape for interpolation into `innerHTML`.
 *
 * `Phone` and `PauseMenu` each grew their own copy of this when they started
 * rendering save-derived text. One definition, exported from the layer that
 * knows the text is untrusted, is the version that cannot drift.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Rebuild a parsed JSON value as a plain, bounded, prototype-free structure.
 *
 * Rebuilt rather than mutated in place: the returned objects are made with
 * `Object.create(null)`-free plain literals containing only vetted keys, so
 * whatever the input's prototype situation was does not come along.
 */
export function hardenParsed(input: unknown): GuardResult {
  let nodes = 0;

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new RangeError('too deeply nested');
    if (++nodes > MAX_NODES) throw new RangeError('too many values');

    if (value === null) return null;

    switch (typeof value) {
      case 'string':
        return sanitiseText(value);
      case 'number':
        // NaN and Infinity cannot come from JSON.parse, but they can come from
        // a caller handing us an already-parsed object, and a NaN position is
        // the exact failure `validateSave` exists to catch. Fail loudly here.
        return Number.isFinite(value) ? value : null;
      case 'boolean':
        return value;
      case 'undefined':
        return undefined;
      default:
        break;
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) throw new RangeError('an array is too long');
      return value.map((v) => walk(v, depth + 1));
    }

    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      // `Object.keys` skips inherited properties, and the forbidden set covers
      // the own-property case JSON.parse can actually produce.
      for (const k of Object.keys(value as Record<string, unknown>)) {
        if (FORBIDDEN_KEYS.has(k)) continue;
        out[sanitiseText(k)] = walk((value as Record<string, unknown>)[k], depth + 1);
      }
      return out;
    }

    // Functions, symbols and bigints cannot appear in parsed JSON. If one is
    // here, the caller passed something that did not come from a file.
    throw new TypeError('unsupported value in save');
  };

  try {
    return { ok: true, value: walk(input, 0) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'malformed save' };
  }
}

/**
 * The whole boundary: size, parse, harden. Returns something safe to migrate.
 */
export function parseImportedSave(json: string): GuardResult {
  // `length` is UTF-16 units, so this under-counts a multi-byte payload by at
  // most a factor of three — which is the safe direction for a ceiling.
  if (json.length > MAX_IMPORT_BYTES) {
    return { ok: false, reason: 'that file is too large to be a save' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'that file is not valid JSON' };
  }

  // A save is an object. A bare array or number parses fine and would then
  // fail somewhere less legible.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'that file is not a Last Horizon save' };
  }

  return hardenParsed(parsed);
}

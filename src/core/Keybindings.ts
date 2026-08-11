/**
 * What each key does, as data the player can change.
 *
 * Phase 11's accessibility list asks for full remapping, and the reason it
 * matters is not preference. A one-handed player, a player on a keyboard
 * without a numeric row, a player whose left hand cannot reach Shift — none
 * of them are served by "WASD, and that is the layout".
 *
 * **Two kinds of binding, deliberately.** Each action has one *primary* code
 * the player owns, and zero or more *fixed alternates* that always work and
 * cannot be taken away. The alternates are the ones a player would be
 * genuinely stranded without: the arrow keys for movement, Enter for
 * interact. Making those rebindable would let somebody bind their way into a
 * game they cannot move in, and the reset button is behind a menu they would
 * then have to navigate.
 *
 * `Escape` appears nowhere and is reserved. It closes panels, exits pointer
 * lock and pauses, and a player who binds it to "reload" has no way out.
 *
 * No Three.js, no DOM, no storage: this is a lookup table and its rules, so
 * conflict resolution is testable without a browser.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'run'
  | 'jump'
  | 'interact'
  | 'flip'
  | 'map'
  | 'journal'
  | 'phone'
  | 'life'
  | 'draw'
  | 'reload'
  | 'shoulder'
  | 'photo';

export const ACTIONS: readonly Action[] = [
  'forward', 'back', 'left', 'right', 'run',
  'jump', 'interact', 'flip',
  'map', 'journal', 'phone', 'life',
  'draw', 'reload', 'shoulder', 'photo',
];

/** What each action is called in the interface. */
export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  forward: 'Walk forward',
  back: 'Walk back',
  left: 'Walk left',
  right: 'Walk right',
  run: 'Run',
  jump: 'Jump',
  interact: 'Interact',
  flip: 'Right a vehicle',
  map: 'Map',
  journal: 'Journal',
  phone: 'Phone',
  life: 'Carrying and record',
  draw: 'Take out or put away',
  reload: 'Reload',
  shoulder: 'Switch shoulder',
  photo: 'Photo mode',
};

/** The layout the game ships with. Every one of these is rebindable. */
export const DEFAULT_BINDINGS: Readonly<Record<Action, string>> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
  flip: 'KeyR',
  map: 'KeyM',
  journal: 'KeyJ',
  phone: 'KeyP',
  life: 'KeyI',
  draw: 'KeyQ',
  reload: 'KeyG',
  shoulder: 'KeyV',
  photo: 'KeyK',
};

/**
 * Always live, never rebindable, never shown as a conflict.
 *
 * These are the codes a player would be stranded without. The arrows are the
 * fallback for movement and Enter for interact; `ShiftRight` is here because
 * a player who has rebound `run` away from `ShiftLeft` has usually done it to
 * free their left hand, not to lose running.
 */
export const FIXED_ALTERNATES: Readonly<Partial<Record<Action, readonly string[]>>> = {
  forward: ['ArrowUp'],
  back: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  run: ['ShiftRight'],
  interact: ['KeyF', 'Enter'],
};

/** Codes no action may claim. */
export const RESERVED: ReadonlySet<string> = new Set(['Escape', 'Tab', 'F5', 'F11', 'F12']);

export type RebindResult =
  | { readonly ok: true; readonly stoleFrom: Action | null }
  | { readonly ok: false; readonly reason: 'reserved' | 'unknown-action' | 'fixed' };

/** How a code reads on a key cap. `KeyW` is not a label. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return `${code.slice(5)} arrow`;
  switch (code) {
    case 'Space': return 'Space';
    case 'ShiftLeft': return 'Left shift';
    case 'ShiftRight': return 'Right shift';
    case 'ControlLeft': return 'Left ctrl';
    case 'ControlRight': return 'Right ctrl';
    case 'AltLeft': return 'Left alt';
    case 'AltRight': return 'Right alt';
    case 'Enter': return 'Enter';
    case 'Backquote': return '`';
    case 'Minus': return '-';
    case 'Equal': return '=';
    case 'Comma': return ',';
    case 'Period': return '.';
    case 'Slash': return '/';
    case 'Semicolon': return ';';
    case 'Quote': return "'";
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Backslash': return '\\';
    default: return code;
  }
}

export class Keybindings {
  private map: Record<Action, string>;

  constructor(initial?: Partial<Record<Action, string>>) {
    this.map = { ...DEFAULT_BINDINGS };
    if (initial) this.restore(initial);
  }

  /** The player-owned code for this action. */
  codeFor(action: Action): string {
    return this.map[action];
  }

  /** Every code that triggers this action, primary first. */
  codesFor(action: Action): readonly string[] {
    return [this.map[action], ...(FIXED_ALTERNATES[action] ?? [])];
  }

  /**
   * Which action this key press means, or null.
   *
   * Primaries are checked before alternates, so a player who binds `forward`
   * to `ArrowLeft` gets forward from it — their explicit choice beats a
   * default that happens to overlap.
   */
  actionFor(code: string): Action | null {
    for (const a of ACTIONS) if (this.map[a] === code) return a;
    for (const a of ACTIONS) {
      if (FIXED_ALTERNATES[a]?.includes(code)) return a;
    }
    return null;
  }

  /**
   * Give an action a new key.
   *
   * A code already owned by another action is **stolen**, and that action is
   * left with no primary — which is the behaviour every game with a remapping
   * screen has, and the only one that does not require the player to unbind
   * first. `stoleFrom` says who lost it so the interface can point at the row
   * that now needs attention.
   *
   * A code that is a fixed alternate of a *different* action is refused: the
   * arrows and Enter are the way back from a bad layout.
   */
  rebind(action: Action, code: string): RebindResult {
    if (!ACTIONS.includes(action)) return { ok: false, reason: 'unknown-action' };
    if (RESERVED.has(code)) return { ok: false, reason: 'reserved' };

    for (const other of ACTIONS) {
      if (other !== action && FIXED_ALTERNATES[other]?.includes(code)) {
        return { ok: false, reason: 'fixed' };
      }
    }

    if (this.map[action] === code) return { ok: true, stoleFrom: null };

    const victim = ACTIONS.find((a) => a !== action && this.map[a] === code) ?? null;
    // Empty string rather than deletion: the record stays total, so
    // `codeFor` never returns undefined and no caller needs a null check.
    if (victim) this.map[victim] = '';
    this.map[action] = code;
    return { ok: true, stoleFrom: victim };
  }

  /** Actions with no key on them. The interface should say so. */
  unbound(): readonly Action[] {
    return ACTIONS.filter((a) => this.map[a] === '');
  }

  reset(): void {
    this.map = { ...DEFAULT_BINDINGS };
  }

  isDefault(): boolean {
    return ACTIONS.every((a) => this.map[a] === DEFAULT_BINDINGS[a]);
  }

  toJSON(): Record<Action, string> {
    return { ...this.map };
  }

  /**
   * Restore from storage, per key and validated.
   *
   * The same discipline `Settings` uses: a stored blob is the least trusted
   * input here. A binding that is reserved, not a string, or duplicated is
   * dropped rather than accepted, and anything missing falls back to the
   * default — so a save from an older build gains the new actions instead of
   * losing every one it does not mention.
   */
  restore(data: Partial<Record<Action, string>> | undefined): void {
    this.map = { ...DEFAULT_BINDINGS };
    if (!data) return;

    const claimed = new Set<string>();
    for (const a of ACTIONS) {
      const code = data[a];
      if (typeof code !== 'string') continue;
      if (code !== '' && (RESERVED.has(code) || claimed.has(code))) continue;
      // A code that is somebody else's fixed alternate cannot be a primary,
      // exactly as `rebind` refuses it.
      if (ACTIONS.some((o) => o !== a && FIXED_ALTERNATES[o]?.includes(code))) continue;
      this.map[a] = code;
      if (code !== '') claimed.add(code);
    }

    // A default that the restore has since handed to somebody else would
    // leave two actions on one key. Clear the loser rather than duplicating.
    const seen = new Set<string>();
    for (const a of ACTIONS) {
      const code = this.map[a];
      if (code === '') continue;
      if (seen.has(code)) this.map[a] = '';
      else seen.add(code);
    }
  }
}

import './SettingsPanel.css';
import type { AccessOptionKey, AudioBus, NeedId, QualityLevel, Settings, TimeMode } from '../core/Settings';
import { ACTIONS, ACTION_LABELS, keyLabel, type Action, type Keybindings } from '../core/Keybindings';

/**
 * Everything inside the info modal: settings, needs, action, accessibility,
 * controls and credits.
 *
 * Split out of `HUD` in Phase 11 on the `MapPanel` precedent — the third time
 * this repository has moved a panel out of the always-on chrome because the
 * app-chunk budget said no, after `MapPanel` in Phase 6 and `StoryPanels` in
 * Phase 8. The argument is the same every time and it is a good one: this code
 * runs when the player opens a modal, and a player who never opens it should
 * not have downloaded it.
 *
 * **What stayed behind in `HUD`, and why:**
 *
 * - The *chrome* — the close button, the backdrop click and the Escape
 *   handler. Escape is a global key and has to work before this module exists.
 * - `syncSound`, `syncQuality` and `syncTime`, because each also updates a HUD
 *   tile that is on screen from the first frame. They are handed in as
 *   `syncTiles` so the panel can still reflect a change it caused.
 * - `applyAccess`, which stamps `--ui-scale` and the motion/contrast classes
 *   onto the document. That has to run on boot to restore a saved setting,
 *   which is precisely when this module does not exist.
 *
 * The markup itself is static in `index.html` and stays there. That is what
 * keeps the panel present for an accessibility snapshot whether or not the
 * chunk has been fetched.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** What the panel cannot do on its own. */
export interface SettingsPanelDeps {
  readonly settings: Settings;
  /** Re-draw the HUD tiles that mirror a setting. */
  readonly syncTiles: () => void;
  /** Re-stamp `--ui-scale` and the motion/contrast classes on the document. */
  readonly applyAccess: () => void;
  readonly toast: (title: string, body: string) => void;
  readonly onQuality: (q: QualityLevel) => void;
  readonly onMuted: (muted: boolean) => void;
  readonly onTimeMode: (mode: TimeMode) => void;
  readonly onResetProgress: () => void;
  readonly onCombatOption: (
    key: 'aimAssist' | 'cameraShake' | 'flashes' | 'combatDifficulty',
    value: number | boolean,
  ) => void;
  readonly onAccessOption: (key: AccessOptionKey, value: number | boolean | string) => void;
  readonly onVolume: (bus: AudioBus, level: number) => void;
  /** The live table. The panel mutates it and hands it back through `onRebind`. */
  readonly bindings: () => Keybindings;
  readonly onRebind: () => void;
  readonly onSubtitles: (on: boolean) => void;
  readonly onTextSpeed: (mult: number) => void;
}

export class SettingsPanel {
  /** The action whose next key press is being captured, or null. */
  private listening: Action | null = null;

  constructor(private readonly d: SettingsPanelDeps) {
    this.wire();
    this.syncAll();
  }

  // -- reflecting -----------------------------------------------------------

  /**
   * Push every current setting onto the controls.
   *
   * Called once on construction, and after any change this panel caused. The
   * tile-facing half lives in `HUD` and is reached through `syncTiles`.
   */
  syncAll(): void {
    this.d.syncTiles();
    this.syncNeeds();
    this.syncCombat();
    this.syncAccess();
    this.syncVolumes();
    this.syncBindings();
  }

  /**
   * One row per action, rebuilt rather than patched.
   *
   * A rebind can change *two* rows — the one that gained the key and the one
   * it was stolen from — so patching one would leave the other showing a key
   * it no longer has. Fifteen rows is cheap; a stale key cap is a lie.
   */
  private syncBindings(): void {
    const list = $('rebindList');
    const kb = this.d.bindings();

    list.replaceChildren(
      ...ACTIONS.map((action) => {
        const row = document.createElement('div');
        row.className = 'rebind__row';

        const name = document.createElement('span');
        name.className = 'rebind__name';
        name.textContent = ACTION_LABELS[action];

        const code = kb.codeFor(action);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rebind__key';
        btn.dataset.action = action;
        if (this.listening === action) {
          btn.classList.add('is-listening');
          btn.textContent = 'Press a key…';
        } else if (code === '') {
          // Never silently blank. An action with no key is a thing the player
          // has to fix, and it has to look like one.
          btn.classList.add('is-unbound');
          btn.textContent = 'Not set';
        } else {
          btn.textContent = keyLabel(code);
        }
        btn.setAttribute('aria-label', `${ACTION_LABELS[action]}: ${btn.textContent}. Change`);
        btn.addEventListener('click', () => this.listen(action));

        row.append(name, btn);
        return row;
      }),
    );

    const reset = $<HTMLButtonElement>('rebindReset');
    reset.disabled = kb.isDefault();
  }

  /** Wait for the next key press and give it to this action. */
  private listen(action: Action): void {
    this.listening = action;
    this.say('');
    this.syncBindings();

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      this.listening = null;

      if (e.key === 'Escape') {
        this.say('Left as it was.');
        this.syncBindings();
        return;
      }

      const kb = this.d.bindings();
      const r = kb.rebind(action, e.code);
      if (!r.ok) {
        this.say(
          r.reason === 'fixed'
            ? 'That key is a permanent alternate for something else.'
            : 'That key is reserved.',
        );
      } else {
        this.d.onRebind();
        this.say(
          r.stoleFrom
            ? `${ACTION_LABELS[r.stoleFrom]} has no key now.`
            : `${ACTION_LABELS[action]} is on ${keyLabel(e.code)}.`,
        );
      }
      this.syncBindings();
    };

    // Capture phase, so the press never reaches `InputManager` and rebinding
    // "jump" does not also jump.
    window.addEventListener('keydown', onKey, true);
  }

  private say(msg: string): void {
    $('rebindStatus').textContent = msg;
  }

  /**
   * The five bus sliders.
   *
   * Percentages in the `<output>`, not decimals: 0.35 is a gain and 35% is a
   * volume, and only one of those is a thing a player has an opinion about.
   */
  private syncVolumes(): void {
    const v = this.d.settings.current.volumes;
    for (const input of document.querySelectorAll<HTMLInputElement>('#setVolumes input')) {
      const bus = input.dataset.bus as AudioBus;
      const pct = Math.round((v[bus] ?? 1) * 100);
      input.value = String(pct);
      const out = document.querySelector<HTMLElement>(`.vol__value[data-for="${bus}"]`);
      if (out) out.textContent = `${pct}%`;
    }
  }

  /**
   * The needs toggles.
   *
   * Each is an independent on/off, so this is a multi-select segment rather
   * than the mutually-exclusive ones elsewhere — turning hunger off must not
   * turn mood back on.
   */
  private syncNeeds(): void {
    const { needsEnabled, needsDecay } = this.d.settings.current;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setNeeds button')) {
      const id = b.dataset.need as NeedId;
      const on = needsEnabled[id] === true;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setNeedsDecay button')) {
      b.classList.toggle('is-on', Number(b.dataset.decay) === needsDecay);
    }
  }

  /**
   * The four Phase 9 action options.
   *
   * Only `flashes` defaults on. The other three default to the game as
   * designed — a player who wants aim help will go looking for it, and one who
   * never opens this panel should get the version that was balanced.
   */
  private syncCombat(): void {
    const s = this.d.settings.current;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setAimAssist button')) {
      b.classList.toggle('is-on', Number(b.dataset.assist) === s.aimAssist);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setCameraShake button')) {
      b.classList.toggle('is-on', Number(b.dataset.shake) === s.cameraShake);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setCombatDifficulty button')) {
      b.classList.toggle('is-on', Number(b.dataset.diff) === s.combatDifficulty);
    }
    pill('setFlashes', s.flashes);
  }

  /** The five Phase 11 presentation options. */
  private syncAccess(): void {
    const s = this.d.settings.current;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setUiScale button')) {
      b.classList.toggle('is-on', Number(b.dataset.scale) === s.uiScale);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setReducedMotion button')) {
      b.classList.toggle('is-on', b.dataset.motion === s.reducedMotion);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setFlightAssist button')) {
      b.classList.toggle('is-on', b.dataset.flight === s.flightAssist);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setAgingSpeed button')) {
      b.classList.toggle('is-on', b.dataset.aging === s.agingSpeed);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setDrivingAssist button')) {
      b.classList.toggle('is-on', b.dataset.driving === s.drivingAssist);
    }
    for (const [id, on] of [
      ['setHoldToAim', s.holdToAim],
      ['setHoldToRun', s.holdToRun],
    ] as const) {
      for (const b of document.querySelectorAll<HTMLButtonElement>(`#${id} button`)) {
        b.classList.toggle('is-on', (b.dataset.hold === 'true') === on);
      }
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setSubtitles button')) {
      b.classList.toggle('is-on', (b.dataset.subs === 'on') === s.subtitles);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setTextSpeed button')) {
      b.classList.toggle('is-on', Number(b.dataset.speed) === s.textSpeed);
    }
    pill('setHighContrast', s.highContrast);
    pill('setHeatNumerals', s.heatNumerals);
    this.d.applyAccess();
  }

  // -- wiring ---------------------------------------------------------------

  private wire(): void {
    $('setSound').addEventListener('click', () => {
      const muted = this.d.settings.toggleMuted();
      this.d.onMuted(muted);
      this.d.syncTiles();
    });

    seg('#setQuality button', 'q', (v) => {
      this.d.settings.setQuality(v as QualityLevel);
      this.d.onQuality(v as QualityLevel);
      this.d.syncTiles();
    });
    seg('#setTime button', 't', (v) => {
      this.d.settings.setTimeMode(v as TimeMode);
      this.d.onTimeMode(v as TimeMode);
      this.d.syncTiles();
    });

    seg('#setNeeds button', 'need', (v) => {
      const id = v as NeedId;
      this.d.settings.setNeedEnabled(id, !this.d.settings.current.needsEnabled[id]);
      this.syncNeeds();
    });
    seg('#setNeedsDecay button', 'decay', (v) => {
      this.d.settings.setNeedsDecay(Number(v));
      this.syncNeeds();
    });

    // The action options. `onCombatOption` reaches `Settings.setCombatOption`,
    // which clamps — so this panel never has to, and neither does the bridge.
    seg('#setAimAssist button', 'assist', (v) => {
      this.d.onCombatOption('aimAssist', Number(v));
      this.syncCombat();
    });
    seg('#setCameraShake button', 'shake', (v) => {
      this.d.onCombatOption('cameraShake', Number(v));
      this.syncCombat();
    });
    seg('#setCombatDifficulty button', 'diff', (v) => {
      this.d.onCombatOption('combatDifficulty', Number(v));
      this.syncCombat();
    });
    $('setFlashes').addEventListener('click', () => {
      this.d.onCombatOption('flashes', !this.d.settings.current.flashes);
      this.syncCombat();
    });

    // The accessibility options. Same shape: the game clamps and persists,
    // this only reflects.
    seg('#setUiScale button', 'scale', (v) => {
      this.d.onAccessOption('uiScale', Number(v));
      this.syncAccess();
    });
    seg('#setReducedMotion button', 'motion', (v) => {
      this.d.onAccessOption('reducedMotion', v);
      this.syncAccess();
    });
    seg('#setFlightAssist button', 'flight', (v) => {
      this.d.onAccessOption('flightAssist', v);
      this.syncAccess();
    });
    for (const [id, key] of [
      ['setHighContrast', 'highContrast'],
      ['setHeatNumerals', 'heatNumerals'],
    ] as const) {
      $(id).addEventListener('click', () => {
        this.d.onAccessOption(key, !this.d.settings.current[key]);
        this.syncAccess();
      });
    }

    // The bus sliders. `input` rather than `change`, so the mix follows the
    // drag — a level you can only hear after letting go is a level you cannot
    // set by ear, which is the only way anybody sets one.
    for (const input of document.querySelectorAll<HTMLInputElement>('#setVolumes input')) {
      input.addEventListener('input', () => {
        const bus = input.dataset.bus as AudioBus;
        this.d.onVolume(bus, Number(input.value) / 100);
        this.syncVolumes();
      });
    }

    seg('#setAgingSpeed button', 'aging', (v) => {
      this.d.onAccessOption('agingSpeed', v);
      this.syncAccess();
    });
    seg('#setDrivingAssist button', 'driving', (v) => {
      this.d.onAccessOption('drivingAssist', v);
      this.syncAccess();
    });
    // Both hold segments share a `data-hold` attribute, so each needs its own
    // handler rather than one selector across both.
    for (const [id, key] of [
      ['setHoldToAim', 'holdToAim'],
      ['setHoldToRun', 'holdToRun'],
    ] as const) {
      seg(`#${id} button`, 'hold', (v) => {
        this.d.onAccessOption(key, v === 'true');
        this.syncAccess();
      });
    }

    seg('#setSubtitles button', 'subs', (v) => {
      this.d.onSubtitles(v === 'on');
      this.syncAccess();
    });
    seg('#setTextSpeed button', 'speed', (v) => {
      this.d.onTextSpeed(Number(v));
      this.syncAccess();
    });

    $('rebindReset').addEventListener('click', () => {
      this.d.bindings().reset();
      this.d.onRebind();
      this.say('Back to the keys the game shipped with.');
      this.syncBindings();
    });

    $('setReset').addEventListener('click', () => {
      this.d.onResetProgress();
      this.d.toast('Progress', 'Keepsakes put back where they were.');
    });
  }
}

/** Wire every button in a segmented control to one handler, by data attribute. */
function seg(selector: string, attr: string, run: (value: string) => void): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(selector)) {
    b.addEventListener('click', () => run(b.dataset[attr] ?? ''));
  }
}

/** An on/off pill: label, muted class and `aria-pressed` in step. */
function pill(id: string, on: boolean): void {
  const el = $(id);
  el.textContent = on ? 'On' : 'Off';
  el.classList.toggle('is-off', !on);
  el.setAttribute('aria-pressed', String(on));
}

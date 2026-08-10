import './SettingsPanel.css';
import type { NeedId, QualityLevel, Settings, TimeMode } from '../core/Settings';

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
  readonly onAccessOption: (
    key: 'uiScale' | 'reducedMotion' | 'highContrast' | 'heatNumerals' | 'flightAssist',
    value: number | boolean | string,
  ) => void;
}

export class SettingsPanel {
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

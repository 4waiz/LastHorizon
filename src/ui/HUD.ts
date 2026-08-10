import { QualityLevel, Settings, TimeMode } from '../core/Settings';
import type { Dashboard } from '../vehicles/VehicleControls';
import type { MinimapData } from './Minimap';
// Type-only: the map is a panel behind a keypress, so its drawing code arrives
// through the dynamic import in `loadMapApi` rather than in the app chunk.
import type { MapMarker, MapView } from './MapPanel';
import { InputManager } from '../core/InputManager';
import { clamp } from '../utils/MathUtils';
import type { Outfit } from '../player/Player';

/** Wardrobe palettes. Muted enough that any pick still fits the world. */
const SHIRT_COLOURS = ['#efede2', '#e6d3b8', '#cfd9e4', '#d8c3c8', '#c9d8c2', '#b9c4d6'];
const TROUSER_COLOURS = ['#9b8fc7', '#8a9455', '#7f8a9c', '#b08b6a', '#5f6b7a', '#c2a2a8'];
const HAT_COLOURS = ['#dcc177', '#c9584b', '#7f9ec4', '#8fae7a', '#e3ded0'];

/**
 * Minimal interface: a column of warm off-white tiles, a keepsake counter, a
 * discovery toast, the info panel, and the on-screen controls that appear
 * only on touch devices.
 *
 * All markup is static in index.html; this wires behaviour to it.
 */

export interface HUDCallbacks {
  onQuality: (q: QualityLevel) => void;
  onMuted: (muted: boolean) => void;
  onTimeMode: (mode: TimeMode) => void;
  onResetProgress: () => void;
  /** `down` false is the release, which ends a hold. */
  onInteract: (down: boolean) => void;
  onOutfit: (patch: Partial<Outfit>) => void;
  /** One of the four Phase 9 options. The game clamps and persists. */
  onCombatOption: (
    key: 'aimAssist' | 'cameraShake' | 'flashes' | 'combatDifficulty',
    value: number | boolean,
  ) => void;
  /** One of the five Phase 11 presentation options. */
  onAccessOption: (
    key: 'uiScale' | 'reducedMotion' | 'highContrast' | 'heatNumerals' | 'flightAssist',
    value: number | boolean | string,
  ) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export class HUD {
  private hud = $('hud');
  private touch = $('touch');
  private info = $('info');
  private rotate = $('rotate');
  private toast = $('toast');
  private toastTitle = $('toastTitle');
  private toastBody = $('toastBody');
  private counterValue = $('counterValue');
  private counterMax = $('counterMax');
  private counter = document.querySelector<HTMLElement>('.counter')!;
  private wallet = $('wallet');
  private walletValue = $('walletValue');
  private hint = $('hint');
  private debug = $('debug');
  private prompt = $('prompt');
  private promptText = $('promptText');
  private fade = $('fade');
  private btnAct = $<HTMLButtonElement>('btnAct');
  private dash = $('dash');
  private dashSpeed = $('dashSpeed');
  private dashGear = $('dashGear');
  private dashCondition = $('dashCondition');
  private dashFuel = $('dashFuel');
  private dashFuelWrap = $('dashFuelWrap');
  private dashHints = $('dashHints');
  private mapPanel = $('mapPanel');
  private mapCanvas = $<HTMLCanvasElement>('mapCanvas');
  private mapScaleText = $('mapScaleText');

  // -- Phase 8: the always-on half only. The panels are in StoryPanels.ts.
  private objective = $('objective');
  private objectiveText = $('objectiveText');
  private caption = $('caption');

  // -- Phase 9 -------------------------------------------------------------
  private heat = $('heat');
  private heatPips = Array.from(document.querySelectorAll<HTMLElement>('.heat__pip'));
  private ammo = $('ammo');
  private ammoMag = $('ammoMag');
  private ammoReserve = $('ammoReserve');
  private reticle = $('reticle');
  private heatNum = $('heatNum');
  private lastHeat = -1;

  /** Where the map is looking. Kept between openings, like a real map. */
  private mapView: MapView = { centreX: 0, centreZ: 0, scale: 1 };
  /** Resolved on the first opening. Null until then; every draw is a no-op. */
  private mapApi: typeof import('./MapPanel') | null = null;
  private mapApiLoading: Promise<typeof import('./MapPanel')> | null = null;
  private mapData: MinimapData = { roads: [], buildings: [] };
  private mapFitted = false;
  private mapDrag: { pointerId: number; x: number; y: number } | null = null;
  /** Asked for each redraw, so the map is never stale. */
  private mapSource: (() => {
    player: { x: number; z: number; facing: number };
    markers: MapMarker[];
  }) | null = null;
  private wardrobe = $('wardrobe');

  private btnSound = $<HTMLButtonElement>('btnSound');
  private btnQuality = $<HTMLButtonElement>('btnQuality');
  private btnTime = $<HTMLButtonElement>('btnTime');
  private qualityDot = $('qualityDot');

  private stick = $('stick');
  private stickKnob = $('stickKnob');
  private btnRun = $<HTMLButtonElement>('btnRun');

  private toastTimer = 0;
  private hintTimer = 0;
  private stickPointer = -1;
  private lookPointer = -1;
  private lookLast = { x: 0, y: 0 };
  private running = false;

  readonly isTouch: boolean;

  constructor(
    private readonly settings: Settings,
    private readonly input: InputManager,
    private readonly cb: HUDCallbacks,
  ) {
    this.isTouch =
      navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

    this.wireTiles();
    this.wireInfoChrome();
    this.wireMap();
    this.wireWardrobe();
    if (this.isTouch) this.wireTouch();
    this.syncTiles();
    this.applyAccess();
    this.checkOrientation();
    window.addEventListener('resize', () => this.checkOrientation());
    window.addEventListener('orientationchange', () => this.checkOrientation());
  }

  show(): void {
    this.hud.hidden = false;
    if (this.isTouch) {
      this.touch.hidden = false;
      this.hint.style.display = 'none';
    } else {
      this.hintTimer = window.setTimeout(() => this.hint.classList.add('is-gone'), 9000);
    }
  }

  // --------------------------------------------------------------- tiles

  private wireTiles(): void {
    this.btnSound.addEventListener('click', () => {
      const muted = this.settings.toggleMuted();
      this.cb.onMuted(muted);
      this.syncSound();
    });
    this.btnQuality.addEventListener('click', () => {
      const q = this.settings.cycleQuality();
      this.cb.onQuality(q);
      this.syncQuality();
      this.showToast('Graphics', `Quality set to ${q}.`);
    });
    this.btnTime.addEventListener('click', () => {
      const m = this.settings.cycleTimeMode();
      this.cb.onTimeMode(m);
      this.syncTime();
      this.showToast('Time of day', m === 'cycle' ? 'Following the sun.' : `Locked to ${m}.`);
    });
    $('btnInfo').addEventListener('click', () => this.openInfo(true));
    $('btnFull').addEventListener('click', () => this.toggleFullscreen());
  }

  private toggleFullscreen(): void {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().catch(() => {
        this.showToast('Fullscreen', 'Your browser turned that down.');
      });
    } else {
      void document.exitFullscreen?.();
    }
  }

  private syncSound(): void {
    const muted = this.settings.current.muted;
    this.btnSound.classList.toggle('is-off', muted);
    this.btnSound
      .querySelector('use')!
      .setAttribute('href', muted ? '#i-sound-off' : '#i-sound-on');
    const pill = $('setSound');
    pill.textContent = muted ? 'Off' : 'On';
  }

  private syncQuality(): void {
    const q = this.settings.current.quality;
    this.qualityDot.dataset.q = q;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setQuality button')) {
      b.classList.toggle('is-on', b.dataset.q === q);
    }
  }

  private syncTime(): void {
    const m = this.settings.current.timeMode;
    this.btnTime
      .querySelector('use')!
      .setAttribute('href', m === 'night' ? '#i-moon' : '#i-sun');
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setTime button')) {
      b.classList.toggle('is-on', b.dataset.t === m);
    }
  }

  /**
   * The needs toggles.
   *
   * Each is an independent on/off, so this is a multi-select segment rather
   * than the mutually-exclusive ones above — turning hunger off must not turn
   * mood back on.
   */
  /**
   * Apply the presentation options to the document.
   *
   * Stays in `HUD` while the rest of the settings panel moved to
   * `SettingsPanel`, because this has to run on **boot** to restore a saved
   * setting — which is exactly when that module does not exist. The stylesheet
   * is the consumer: `--ui-scale` feeds the type scale and the three classes
   * gate motion, contrast and the Heat numeral.
   */
  applyAccess(): void {
    const s = this.settings.current;
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(s.uiScale));
    root.classList.toggle('is-reduced-motion', s.reducedMotion === 'on');
    // `off` is an explicit opt *out*, so it has to beat the OS media query.
    root.classList.toggle('is-full-motion', s.reducedMotion === 'off');
    root.classList.toggle('is-high-contrast', s.highContrast);
    // The numeral's *visibility* is this class; its text is written by
    // `setHeat`, which returns early when the level has not changed — so
    // calling it from here would do nothing.
    root.classList.toggle('is-heat-numerals', s.heatNumerals);
  }

  /** The three settings that also drive an always-on tile. */
  private syncTiles(): void {
    this.syncSound();
    this.syncQuality();
    this.syncTime();
  }


  /**
   * The info modal's *chrome* only: close, backdrop and Escape.
   *
   * The controls inside it moved to `SettingsPanel` in Phase 11 and arrive
   * with that chunk. Escape stays here because it is a global key and has to
   * work whether or not the panel has ever been opened.
   */
  private wireInfoChrome(): void {
    $('phoneClose').addEventListener('click', () => this.openPhone(false));
    this.phone.addEventListener('pointerdown', (e) => {
      if (e.target === this.phone) this.openPhone(false);
    });
    $('infoClose').addEventListener('click', () => this.openInfo(false));
    this.info.addEventListener('pointerdown', (e) => {
      if (e.target === this.info) this.openInfo(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Innermost panel first: Esc should close what is actually on top.
        // Innermost panel first, then pointer lock, and only with nothing
        // else showing does Escape mean "pause".
        if (!this.mapPanel.hidden) this.openMap(false);
        else if (!this.phone.hidden) this.openPhone(false);
        else if (!this.info.hidden) this.openInfo(false);
        else if (!this.pause.hidden) this.openPause(false);
        else if (document.pointerLockElement) document.exitPointerLock();
        else this.togglePause();
      }
    });
  }

  // -- pause ----------------------------------------------------------------
  private pause = $('pause');
  private pausePanel: import('./PauseMenu').PauseMenu | null = null;
  private pauseLoading: Promise<void> | null = null;
  private pauseWanted = false;
  private pauseDeps: import('./PauseMenu').PauseDeps | null = null;

  setPauseDeps(deps: import('./PauseMenu').PauseDeps): void {
    this.pauseDeps = deps;
  }

  get pauseOpen(): boolean {
    return this.pause.hidden === false;
  }

  togglePause(): void {
    this.openPause(!this.pauseWanted);
  }

  /** Fifth panel to reveal only once its chunk has landed. */
  openPause(open: boolean): void {
    if (!open) {
      this.pauseWanted = false;
      this.pause.classList.remove('is-on');
      window.setTimeout(() => {
        this.pause.hidden = true;
      }, 220);
      return;
    }
    if (!this.pauseDeps) return;

    this.pauseWanted = true;
    void this.loadPause().then(() => {
      if (!this.pauseWanted) return;
      this.pausePanel?.open();
      this.pause.hidden = false;
      requestAnimationFrame(() => this.pause.classList.add('is-on'));
      this.input.releaseAll();
    });
  }

  private loadPause(): Promise<void> {
    this.pauseLoading ??= import('./PauseMenu').then((api) => {
      this.pausePanel = new api.PauseMenu(this.pauseDeps!);
    });
    return this.pauseLoading;
  }

  // -- the phone ------------------------------------------------------------
  private phone = $('phone');
  private phonePanel: import('./Phone').Phone | null = null;
  private phoneLoading: Promise<void> | null = null;
  private phoneWanted = false;
  /** Supplied by `Game` once, before the phone can be opened. */
  private phoneDeps: import('./Phone').PhoneDeps | null = null;

  /** Hand the phone its data sources. Called by `Game` during setup. */
  setPhoneDeps(deps: import('./Phone').PhoneDeps): void {
    this.phoneDeps = deps;
  }

  get phoneOpen(): boolean {
    return this.phone.hidden === false;
  }

  togglePhone(): void {
    this.openPhone(!this.phoneWanted);
  }

  /**
   * Show or hide the phone.
   *
   * Revealed only once its chunk has landed, the fourth panel to follow that
   * rule. Without the deps it refuses rather than opening an empty handset —
   * `Game` supplies them during setup, so this only bites if the order changes.
   */
  openPhone(open: boolean): void {
    if (!open) {
      this.phoneWanted = false;
      this.phone.classList.remove('is-on');
      window.setTimeout(() => {
        this.phone.hidden = true;
      }, 220);
      return;
    }
    if (!this.phoneDeps) return;

    this.phoneWanted = true;
    void this.loadPhone().then(() => {
      if (!this.phoneWanted) return;
      this.phonePanel?.refresh();
      this.phone.hidden = false;
      requestAnimationFrame(() => this.phone.classList.add('is-on'));
      this.input.releaseAll();
    });
  }

  private loadPhone(): Promise<void> {
    // The chunk and the data it renders. `ready()` is the host's promise that
    // the job catalogue has landed; without awaiting it the Work app opens
    // empty and reads as "no jobs" rather than "not yet".
    this.phoneLoading ??= Promise.all([import('./Phone'), this.phoneDeps!.ready()]).then(([api]) => {
      this.phonePanel = new api.Phone(this.phoneDeps!);
    });
    return this.phoneLoading;
  }

  /** Resolved on the first opening; null until then. */
  private settingsPanel: import('./SettingsPanel').SettingsPanel | null = null;
  private settingsLoading: Promise<void> | null = null;
  /** Whether the player has asked for it, which may be ahead of the download. */
  private infoWanted = false;

  private loadSettingsPanel(): Promise<void> {
    this.settingsLoading ??= import('./SettingsPanel').then((api) => {
      this.settingsPanel = new api.SettingsPanel({
        settings: this.settings,
        syncTiles: () => this.syncTiles(),
        applyAccess: () => this.applyAccess(),
        toast: (t, b) => this.showToast(t, b),
        onQuality: (q) => this.cb.onQuality(q),
        onMuted: (m) => this.cb.onMuted(m),
        onTimeMode: (m) => this.cb.onTimeMode(m),
        onResetProgress: () => this.cb.onResetProgress(),
        onCombatOption: (k, v) => this.cb.onCombatOption(k, v),
        onAccessOption: (k, v) => this.cb.onAccessOption(k, v),
      });
    });
    return this.settingsLoading;
  }


  /** Build the swatch rows once and keep their selected state in sync. */
  private wireWardrobe(): void {
    $('wardrobeClose').addEventListener('click', () => this.openWardrobe(false));
    this.wardrobe.addEventListener('pointerdown', (e) => {
      if (e.target === this.wardrobe) this.openWardrobe(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.wardrobe.hidden) this.openWardrobe(false);
    });

    const row = (
      id: string,
      colours: string[],
      key: 'shirt' | 'trousers' | 'hat',
      withNone = false,
    ) => {
      const host = $(id);
      for (const col of colours) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.dataset.value = col;
        b.style.background = col;
        b.setAttribute('aria-label', `${key} ${col}`);
        b.addEventListener('click', () => {
          this.cb.onOutfit(key === 'hat' ? { hat: col, hatOn: true } : { [key]: col });
        });
        host.appendChild(b);
      }
      if (withNone) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch swatch--none';
        b.dataset.value = 'none';
        b.textContent = 'OFF';
        b.addEventListener('click', () => this.cb.onOutfit({ hatOn: false }));
        host.appendChild(b);
      }
    };
    row('swShirt', SHIRT_COLOURS, 'shirt');
    row('swTrousers', TROUSER_COLOURS, 'trousers');
    row('swHat', HAT_COLOURS, 'hat', true);
  }

  /** Highlight whichever swatch matches the outfit currently worn. */
  syncOutfit(outfit: Outfit): void {
    const mark = (id: string, value: string) => {
      for (const b of $(id).querySelectorAll<HTMLButtonElement>('.swatch')) {
        b.classList.toggle('is-on', b.dataset.value === value);
      }
    };
    mark('swShirt', outfit.shirt);
    mark('swTrousers', outfit.trousers);
    mark('swHat', outfit.hatOn ? outfit.hat : 'none');
  }

  openWardrobe(open: boolean): void {
    if (open) {
      this.wardrobe.hidden = false;
      requestAnimationFrame(() => this.wardrobe.classList.add('is-on'));
      this.input.releaseAll();
    } else {
      this.wardrobe.classList.remove('is-on');
      window.setTimeout(() => {
        this.wardrobe.hidden = true;
      }, 240);
    }
  }

  get wardrobeOpen(): boolean {
    return !this.wardrobe.hidden;
  }

  /**
   * Show or hide the info modal.
   *
   * **Revealed only once its chunk has landed**, the same ordering `openMap`
   * needs and for the same reason: since Phase 11 the panel's stylesheet and
   * its control wiring both travel with `SettingsPanel`, so showing the markup
   * first would give a flash of unstyled settings *and* a panel whose buttons
   * do nothing yet. The second half of that is worse than the first.
   */
  /** Public entry point, for the pause menu's Settings item. */
  openInfoPanel(): void {
    this.openInfo(true);
  }

  private openInfo(open: boolean): void {
    if (!open) {
      this.infoWanted = false;
      this.info.classList.remove('is-on');
      window.setTimeout(() => {
        this.info.hidden = true;
      }, 240);
      return;
    }

    this.infoWanted = true;
    void this.loadSettingsPanel().then(() => {
      // Still wanted? The player may have pressed Escape while it landed.
      if (!this.infoWanted) return;
      // Reflect anything that changed while the panel did not exist — the
      // quality tile and the time tile are both reachable without it.
      this.settingsPanel?.syncAll();
      this.info.hidden = false;
      // next frame, so the transition has a starting state to animate from
      requestAnimationFrame(() => this.info.classList.add('is-on'));
      this.input.releaseAll();
    });
  }

  get infoOpen(): boolean {
    return !this.info.hidden;
  }

  // -------------------------------------------------------------- touch

  private wireTouch(): void {
    const radius = 46;

    const setKnob = (dx: number, dy: number) => {
      this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    this.stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
    });

    const moveStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      e.preventDefault();
      const r = this.stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      setKnob(dx, dy);
      // Past 78% deflection counts as a run, so there is no separate sprint
      // gesture to learn — though the RUN button is there too.
      const mag = clamp(len / radius, 0, 1);
      this.input.setStick(
        (dx / radius),
        -(dy / radius),
        this.running || mag > 0.78,
      );
    };

    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = -1;
      setKnob(0, 0);
      this.input.setStick(0, 0, false);
    };

    this.stick.addEventListener('pointermove', moveStick);
    this.stick.addEventListener('pointerup', endStick);
    this.stick.addEventListener('pointercancel', endStick);

    const jump = $('btnJump');
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.queueJump();
    });

    // Release matters as much as press: a hold-to-act prompt has no other way
    // to know the thumb came off the button.
    this.btnAct.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.btnAct.setPointerCapture(e.pointerId);
      this.cb.onInteract(true);
    });
    const endAct = (e: PointerEvent) => {
      e.preventDefault();
      this.cb.onInteract(false);
    };
    this.btnAct.addEventListener('pointerup', endAct);
    this.btnAct.addEventListener('pointercancel', endAct);

    this.btnRun.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.running = !this.running;
      this.btnRun.classList.toggle('is-on', this.running);
      this.input.setStick(this.input.move.x, this.input.move.y, this.running);
    });

    // Anywhere not over a control, a drag orbits the camera.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch') return;
        if ((e.target as HTMLElement)?.closest?.('[data-ui]')) return;
        if (this.lookPointer !== -1) return;
        this.lookPointer = e.pointerId;
        this.lookLast.x = e.clientX;
        this.lookLast.y = e.clientY;
      },
      { passive: true },
    );
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId !== this.lookPointer) return;
        this.input.addLook(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y);
        this.lookLast.x = e.clientX;
        this.lookLast.y = e.clientY;
      },
      { passive: true },
    );
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointer) this.lookPointer = -1;
    };
    window.addEventListener('pointerup', endLook, { passive: true });
    window.addEventListener('pointercancel', endLook, { passive: true });

    // Belt and braces against page scroll on iOS.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  private checkOrientation(): void {
    const narrowPortrait = window.innerHeight > window.innerWidth && window.innerWidth < 560;
    this.rotate.hidden = !(this.isTouch && narrowPortrait);
  }

  // ------------------------------------------------------------ feedback

  setCounter(count: number, total: number): void {
    this.counterValue.textContent = String(count);
    this.counterMax.textContent = String(total);
  }

  /**
   * Cash in hand.
   *
   * Only the pocket, not the bank: the number beside a shop counter has to be
   * the one that decides whether you can buy the thing, and `Wallet.debit`
   * deliberately never reaches into savings.
   */
  setWallet(cash: number): void {
    const next = String(cash);
    if (this.walletValue.textContent === next) return;
    this.walletValue.textContent = next;
    this.wallet.classList.remove('is-pop');
    void this.wallet.offsetWidth; // restart the animation
    this.wallet.classList.add('is-pop');
  }

  popCounter(): void {
    this.counter.classList.remove('is-pop');
    void this.counter.offsetWidth; // restart the animation
    this.counter.classList.add('is-pop');
  }

  showToast(title: string, body: string, ms = 3600): void {
    this.toastTitle.textContent = title;
    this.toastBody.textContent = body;
    this.toast.classList.add('is-on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-on'), ms);
  }

  /** Show or clear the "press E" prompt. Pass null to hide. */
  /**
   * Show or hide the vehicle dashboard.
   *
   * Null means the player is on foot. The fuel bar hides itself rather than
   * showing empty, because a bicycle has no tank and a permanently empty gauge
   * reads as a bug.
   */
  setVehicleReadout(readout: Dashboard | null): void {
    if (!readout) {
      this.dash.hidden = true;
      return;
    }
    this.dash.hidden = false;
    this.dashSpeed.textContent = readout.speed;
    this.dashGear.textContent = readout.gear;
    this.dashCondition.style.width = `${Math.round(readout.condition * 100)}%`;

    if (readout.fuel === null) {
      this.dashFuelWrap.hidden = true;
    } else {
      this.dashFuelWrap.hidden = false;
      this.dashFuel.style.width = `${Math.round(readout.fuel * 100)}%`;
    }
    this.dashHints.textContent = readout.hints.join(' · ');
  }

  // ------------------------------------------------------------------- map

  /** Where the map gets its world from. Set once by `Game`. */
  setMapSource(
    data: MinimapData,
    source: () => { player: { x: number; z: number; facing: number }; markers: MapMarker[] },
  ): void {
    this.mapData = data;
    this.mapSource = source;
    this.mapFitted = false;
  }

  /** Point the map at another zone, the way the radar is repointed. */
  setMapData(data: MinimapData): void {
    this.mapData = data;
    this.mapFitted = false;
  }

  /**
   * Whether the map is *on screen*.
   *
   * Distinct from `mapWanted` below, and the distinction only started to
   * matter when the panel's stylesheet moved into its own chunk: between the
   * player pressing M and the chunk landing, the map is wanted but not yet
   * shown. Anything asking "is it visible" — the Escape handler, the pause
   * rules — wants this one.
   */
  get mapOpen(): boolean {
    // `hidden` is `boolean | 'until-found'` in the current DOM types, so it
    // needs coercing rather than passing straight through.
    return this.mapPanel.hidden === false;
  }

  /** Whether the player has asked for it, which may be ahead of the download. */
  private mapWanted = false;

  toggleMap(): void {
    this.openMap(!this.mapWanted);
  }

  /**
   * Show or hide the map.
   *
   * **The panel is revealed only once its chunk has landed**, and that ordering
   * is load-bearing since Phase 11 moved the map's stylesheet into the same
   * chunk as its code. The previous version unhid the panel first and fetched
   * afterwards, which was free when the CSS was eager and became a flash of
   * unstyled markup the moment it was not — a raw white block for as long as
   * the download took.
   *
   * Closing stays synchronous. Nobody has ever wanted a panel to take its time
   * going away.
   */
  openMap(open: boolean): void {
    if (!open) {
      this.mapWanted = false;
      this.mapPanel.hidden = true;
      return;
    }

    this.mapWanted = true;
    if (!this.mapApi) {
      void this.loadMapApi().then(() => {
        // Still wanted? The player may have pressed M twice while it landed.
        if (!this.mapWanted) return;
        this.mapPanel.hidden = false;
        this.frameAndDraw();
      });
      return;
    }
    this.mapPanel.hidden = false;
    this.frameAndDraw();
  }

  /**
   * Fetch the map's drawing code, once.
   *
   * The legend is built here rather than in `wireMap` because it is generated
   * from the same table the renderer draws with — which is the point of it, and
   * which means it cannot exist before the module does.
   */
  private loadMapApi(): Promise<typeof import('./MapPanel')> {
    this.mapApiLoading ??= import('./MapPanel').then((api) => {
      this.mapApi = api;
      $('mapLegend').innerHTML = api.MAP_LEGEND.map(
        (e) => `<li><i style="background:${e.colour}"></i>${e.label}</li>`,
      ).join('');
      return api;
    });
    return this.mapApiLoading;
  }

  /**
   * First opening frames the whole zone; after that the view is left where the
   * player put it, which is what makes panning worth having.
   */
  private frameAndDraw(): void {
    const api = this.mapApi;
    if (!api) return;
    if (!this.mapFitted) {
      this.mapView = api.fitToData(this.mapData, this.mapCanvas.width, this.mapCanvas.height);
      this.mapFitted = true;
    }
    this.drawMapNow();
  }

  /** Centre on the player without changing the zoom. */
  centreMapOnPlayer(): void {
    const at = this.mapSource?.().player;
    if (!at) return;
    this.mapView = { ...this.mapView, centreX: at.x, centreZ: at.z };
    this.drawMapNow();
  }

  private drawMapNow(): void {
    const api = this.mapApi;
    const ctx = this.mapCanvas.getContext('2d');
    const src = this.mapSource?.();
    if (!api || !ctx || !src) return;

    api.drawMap(
      ctx,
      this.mapData,
      this.mapView,
      src.player,
      src.markers,
      this.mapCanvas.width,
      this.mapCanvas.height,
    );
    this.mapScaleText.textContent = `${api.scaleBarMetres(this.mapView)} m`;
  }

  /** Redraw while open, so a driven vehicle moves on the map. */
  updateMap(): void {
    if (!this.mapPanel.hidden) this.drawMapNow();
  }

  private wireMap(): void {
    $('mapClose').addEventListener('click', () => this.openMap(false));
    $('mapCentre').addEventListener('click', () => this.centreMapOnPlayer());
    $('mapFit').addEventListener('click', () => {
      if (!this.mapApi) return;
      this.mapView = this.mapApi.fitToData(
        this.mapData,
        this.mapCanvas.width,
        this.mapCanvas.height,
      );
      this.drawMapNow();
    });
    this.mapPanel.addEventListener('pointerdown', (e) => {
      if (e.target === this.mapPanel) this.openMap(false);
    });

    // Drag to pan. Worked in canvas pixels rather than world metres so the map
    // keeps up with the cursor exactly, at any zoom.
    const canvas = this.mapCanvas;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.mapDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.mapDrag || e.pointerId !== this.mapDrag.pointerId) return;
      // The canvas is CSS-scaled, so a screen pixel is not a canvas pixel.
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / Math.max(rect.width, 1);
      const dx = (e.clientX - this.mapDrag.x) * ratio;
      const dy = (e.clientY - this.mapDrag.y) * ratio;
      this.mapDrag.x = e.clientX;
      this.mapDrag.y = e.clientY;

      this.mapView = {
        ...this.mapView,
        centreX: this.mapView.centreX - dx / this.mapView.scale,
        centreZ: this.mapView.centreZ + dy / this.mapView.scale,
      };
      this.drawMapNow();
    });
    const endDrag = (e: PointerEvent) => {
      if (this.mapDrag?.pointerId !== e.pointerId) return;
      this.mapDrag = null;
      canvas.classList.remove('is-dragging');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / Math.max(rect.width, 1);
      const anchor = {
        x: (e.clientX - rect.left) * ratio,
        y: (e.clientY - rect.top) * ratio,
      };
      if (!this.mapApi) return;
      this.mapView = this.mapApi.zoomAbout(
        this.mapView,
        anchor,
        e.deltaY < 0 ? 1.18 : 1 / 1.18,
        canvas.width,
        canvas.height,
      );
      this.drawMapNow();
    }, { passive: false });
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.promptText.textContent = text;
      this.prompt.classList.add('is-on');
      if (this.isTouch) this.btnAct.hidden = false;
    } else {
      this.prompt.classList.remove('is-on');
      this.btnAct.hidden = true;
    }
  }

  /** Fade the screen to black and back; resolves when the fade finishes. */
  setFade(on: boolean, seconds = 0.7): Promise<void> {
    this.fade.style.transitionDuration = `${seconds}s`;
    this.fade.classList.toggle('is-on', on);
    return new Promise((resolve) => window.setTimeout(resolve, seconds * 1000 + 40));
  }

  // ------------------------------------------------------------ the story
  //
  // Everything below takes a *string* and draws it. None of it knows what a
  // quest stage is, which is the brief's "no quest logic hidden in UI
  // components" made structural rather than aspirational: `StoryDirector`
  // decides, and the HUD renders whatever it is handed.

  setObjective(text: string | null): void {
    if (text) {
      this.objectiveText.textContent = text;
      this.objective.hidden = false;
    } else {
      this.objective.hidden = true;
    }
  }

  get objectiveLine(): string | null {
    return this.objective.hidden ? null : this.objectiveText.textContent;
  }

  /**
   * A brief mark where a projectile stopped.
   *
   * Deliberately the cheapest readable thing: a short-lived dot on the HUD
   * layer rather than a decal in the world. A decal needs a render target and
   * a material per surface, and the phase brief's "lightweight particles and
   * decals" is satisfied by the lightweight half — which is recorded as a
   * limitation in the Phase 9 report rather than dressed up as a choice.
   *
   * Coordinates are world-space and are ignored: what this draws is a screen
   * flash, and the caller already knows the shot connected.
   */
  pulseImpact(x: number, y: number, z: number): void {
    void x;
    void y;
    void z;
    this.impactCount++;
    const el = this.hud;
    el.classList.remove('is-impact');
    // Force a reflow so a second shot inside the animation restarts it.
    void el.offsetWidth;
    el.classList.add('is-impact');
  }

  /** Rolling count, for the test bridge. */
  impactCount = 0;

  /**
   * The Heat readout.
   *
   * Five pips rather than five stars, and hidden entirely at zero — which is
   * most of the game, and is the point. The brief asks for an original
   * presentation rather than a copy of somebody else's, and the honest reading
   * of that is a small warm indicator that appears when it matters and gets
   * out of the way when it does not.
   *
   * The level also goes into `aria-label`, because a row of dots says nothing
   * to a screen reader.
   */
  setHeat(level: number): void {
    if (level === this.lastHeat) return;
    this.lastHeat = level;

    this.heat.hidden = level <= 0;
    this.heat.setAttribute('aria-label', level > 0 ? `Police attention ${level} of 5` : '');
    this.heatPips.forEach((pip, i) => pip.classList.toggle('is-on', i < level));
    // Always written, shown only when the accessibility option is on. The
    // pips carry the level in position *and* colour, and both of those fail
    // for the same player; a numeral is a third channel that does not.
    this.heatNum.textContent = level > 0 ? String(level) : '';
  }

  /**
   * Ammunition and the reticle.
   *
   * The reticle *scales with the spread*, so the cone is legible as a shape
   * rather than a number buried in a menu — a player who fires four rounds
   * quickly can see the ring open and knows to stop.
   */
  setWeaponReadout(
    state: { rounds: number; reserve: number; drawn: boolean; aiming: boolean; spread: number } | null,
  ): void {
    if (!state || !state.drawn) {
      this.ammo.hidden = true;
      this.reticle.hidden = true;
      return;
    }
    this.ammo.hidden = false;
    this.ammoMag.textContent = String(state.rounds);
    this.ammoReserve.textContent = String(state.reserve);

    this.reticle.hidden = !state.aiming;
    // 0.02 rad reads as the tight aimed ring; 0.2 as a wide shotgun cone.
    const scale = 0.6 + Math.min(2.6, state.spread * 12);
    this.reticle.style.transform = `scale(${scale.toFixed(2)})`;
  }

  setCaption(text: string | null): void {
    if (text) {
      this.caption.textContent = text;
      this.caption.hidden = false;
    } else {
      this.caption.hidden = true;
    }
  }

  // The dialogue, journal and Life Reel panels live in `ui/StoryPanels.ts`,
  // inside the story's lazy chunk. They were here first, and the budget gate
  // is why they are not: the app chunk went 5.2 kB over its limit and the rule
  // in this repository is to move something rather than raise the ceiling.
  // `MapPanel` did the same thing in Phase 6 for the same reason.

  private ageBadge: HTMLElement | null = null;
  private lastAgeShown = -1;

  /**
   * Minimal age readout: the number, and a thin bar for progress through the
   * year. Created lazily in JS rather than added to index.html because full UI
   * polish is a later phase and this should not leave dead markup behind if it
   * is redesigned.
   */
  setAge(age: number, yearProgress: number): void {
    if (!this.ageBadge) {
      const host = document.getElementById('hud');
      if (!host) return;
      const el = document.createElement('div');
      el.id = 'ageBadge';
      el.style.cssText =
        'position:absolute;top:14px;left:16px;padding:6px 12px 8px;' +
        'font:600 13px/1.2 system-ui,sans-serif;letter-spacing:0.06em;' +
        'color:#4a463e;background:rgba(248,244,234,0.86);border-radius:12px;' +
        'pointer-events:none;user-select:none;min-width:64px;';
      el.innerHTML =
        '<span data-age></span>' +
        '<span data-bar style="display:block;height:3px;margin-top:5px;' +
        'border-radius:2px;background:rgba(74,70,62,0.18)">' +
        '<span data-fill style="display:block;height:100%;width:0;' +
        'border-radius:2px;background:#c2705a"></span></span>';
      host.appendChild(el);
      this.ageBadge = el;
    }

    if (age !== this.lastAgeShown) {
      const label = this.ageBadge.querySelector('[data-age]');
      if (label) label.textContent = `AGE ${age}`;
      this.lastAgeShown = age;
    }
    const fill = this.ageBadge.querySelector<HTMLElement>('[data-fill]');
    if (fill) fill.style.width = `${Math.round(Math.min(1, Math.max(0, yearProgress)) * 100)}%`;
  }

  private saveBadge: HTMLElement | null = null;
  private saveHideTimer = 0;

  /**
   * Save status, shown only when it has something to say.
   *
   * A permanent indicator is clutter — the interesting states are "writing"
   * and "that failed". `saved` shows briefly and fades; `error` stays, because
   * a player who does not notice a failed save finds out much later.
   */
  setSaveStatus(status: 'idle' | 'saving' | 'saved' | 'error'): void {
    if (!this.saveBadge) {
      const host = document.getElementById('hud');
      if (!host) return;
      const el = document.createElement('div');
      el.id = 'saveBadge';
      el.style.cssText =
        'position:absolute;top:14px;left:50%;transform:translateX(-50%);' +
        'padding:5px 12px;border-radius:999px;opacity:0;transition:opacity 0.25s;' +
        'font:600 11px/1 system-ui,sans-serif;letter-spacing:0.08em;' +
        'text-transform:uppercase;pointer-events:none;';
      host.appendChild(el);
      this.saveBadge = el;
    }

    window.clearTimeout(this.saveHideTimer);
    const el = this.saveBadge;

    if (status === 'idle') {
      el.style.opacity = '0';
      return;
    }

    const look = {
      saving: { text: 'Saving', bg: 'rgba(248,244,234,0.9)', fg: '#4a463e' },
      saved: { text: 'Saved', bg: 'rgba(248,244,234,0.9)', fg: '#4a463e' },
      error: { text: 'Not saved', bg: '#c2705a', fg: '#f8f4ea' },
    }[status];

    el.textContent = look.text;
    el.style.background = look.bg;
    el.style.color = look.fg;
    el.style.opacity = '1';

    if (status === 'saved') {
      this.saveHideTimer = window.setTimeout(() => {
        el.style.opacity = '0';
      }, 1400);
    }
  }

  setDebug(text: string | null): void {
    if (text === null) {
      this.debug.hidden = true;
      return;
    }
    this.debug.hidden = false;
    this.debug.textContent = text;
  }

  dismissHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hint.classList.add('is-gone');
  }
}

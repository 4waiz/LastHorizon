import { NeedId, QualityLevel, Settings, TimeMode } from '../core/Settings';
import type { Dashboard } from '../vehicles/VehicleControls';
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
    this.wireInfoPanel();
    this.wireWardrobe();
    if (this.isTouch) this.wireTouch();
    this.syncAll();
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
  private syncNeeds(): void {
    const { needsEnabled, needsDecay } = this.settings.current;
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

  private syncAll(): void {
    this.syncSound();
    this.syncQuality();
    this.syncTime();
    this.syncNeeds();
  }

  // ---------------------------------------------------------- info panel

  private wireInfoPanel(): void {
    $('infoClose').addEventListener('click', () => this.openInfo(false));
    this.info.addEventListener('pointerdown', (e) => {
      if (e.target === this.info) this.openInfo(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.info.hidden) this.openInfo(false);
        else if (document.pointerLockElement) document.exitPointerLock();
      }
    });

    $('setSound').addEventListener('click', () => {
      const muted = this.settings.toggleMuted();
      this.cb.onMuted(muted);
      this.syncSound();
    });
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setQuality button')) {
      b.addEventListener('click', () => {
        const q = b.dataset.q as QualityLevel;
        this.settings.setQuality(q);
        this.cb.onQuality(q);
        this.syncQuality();
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setTime button')) {
      b.addEventListener('click', () => {
        const m = b.dataset.t as TimeMode;
        this.settings.setTimeMode(m);
        this.cb.onTimeMode(m);
        this.syncTime();
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setNeeds button')) {
      b.addEventListener('click', () => {
        const id = b.dataset.need as NeedId;
        this.settings.setNeedEnabled(id, !this.settings.current.needsEnabled[id]);
        this.syncNeeds();
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#setNeedsDecay button')) {
      b.addEventListener('click', () => {
        this.settings.setNeedsDecay(Number(b.dataset.decay));
        this.syncNeeds();
      });
    }
    $('setReset').addEventListener('click', () => {
      this.cb.onResetProgress();
      this.showToast('Progress', 'Keepsakes put back where they were.');
    });
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

  private openInfo(open: boolean): void {
    if (open) {
      this.info.hidden = false;
      // next frame, so the transition has a starting state to animate from
      requestAnimationFrame(() => this.info.classList.add('is-on'));
      this.input.releaseAll();
    } else {
      this.info.classList.remove('is-on');
      window.setTimeout(() => {
        this.info.hidden = true;
      }, 240);
    }
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

import { QualityLevel, Settings, TimeMode } from '../core/Settings';
import { InputManager } from '../core/InputManager';
import { clamp } from '../utils/MathUtils';

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

  private syncAll(): void {
    this.syncSound();
    this.syncQuality();
    this.syncTime();
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
    $('setReset').addEventListener('click', () => {
      this.cb.onResetProgress();
      this.showToast('Progress', 'Keepsakes put back where they were.');
    });
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

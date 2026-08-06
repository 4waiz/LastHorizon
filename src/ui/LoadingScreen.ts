import gsap from 'gsap';
import type { GameMode } from '../core/Gates';

/**
 * Branded loading screen.
 *
 * The markup lives in index.html so the logo paints on the very first frame,
 * before the bundle has even parsed. This class only drives it: the intro
 * animation (icon settling in while two swoosh arcs sweep around it and a
 * sheen crosses the artwork), the progress readout, and the fade to gameplay.
 */

const ARC_LEN = 2 * Math.PI * 128;
const ARC_LEN_B = 2 * Math.PI * 142;

export class LoadingScreen {
  private root: HTMLElement;
  private fill: HTMLElement;
  private pct: HTMLElement;
  private msg: HTMLElement;
  private startBtn: HTMLButtonElement;

  private shown = 0;
  private target = 0;
  private raf = 0;
  private lastTick = 0;
  private safety = 0;
  private idleSpin: gsap.core.Tween | null = null;
  private done = false;

  private modeRow: HTMLElement | null = null;
  private chosenMode: GameMode = 'story';
  private modeLocked = false;

  constructor(private readonly onStart: (mode: GameMode) => void) {
    this.root = document.getElementById('loading')!;
    this.fill = document.getElementById('loadingFill')!;
    this.pct = document.getElementById('loadingPct')!;
    this.msg = document.getElementById('loadingMsg')!;
    this.startBtn = document.getElementById('startButton') as HTMLButtonElement;

    this.startBtn.addEventListener('click', () => this.begin());
    this.intro();
    this.tick();

    // GSAP drives the intro from requestAnimationFrame. A tab that never
    // composites (background window, some embedded views) never ticks it, and
    // the branding would sit at opacity 0 forever. Timers still fire there,
    // so this guarantees the screen becomes readable either way.
    this.safety = window.setTimeout(() => this.forceVisible(), 2600);
  }

  /** Skip straight to the settled state of the intro. */
  private forceVisible(): void {
    if (this.done) return;
    const targets = this.root.querySelectorAll<HTMLElement>(
      '.logo, .loading__title span, .loading__bar, .loading__meta',
    );
    for (const el of targets) {
      if (parseFloat(getComputedStyle(el).opacity) < 0.98) {
        gsap.set(el, { opacity: 1, y: 0, scale: 1, rotate: 0 });
      }
    }
    if (!this.startBtn.hidden) gsap.set(this.startBtn, { opacity: 1, y: 0 });
    this.paint();
  }

  /** Icon settles in, arcs sweep round it, sheen crosses, title spaces out. */
  private intro(): void {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const logo = this.root.querySelector<HTMLElement>('.logo')!;
    const sheen = this.root.querySelector<HTMLElement>('.logo__sheen')!;
    const arcA = this.root.querySelector<SVGCircleElement>('.swoosh__arc--a')!;
    const arcB = this.root.querySelector<SVGCircleElement>('.swoosh__arc--b')!;
    const spark = this.root.querySelector<SVGCircleElement>('.swoosh__spark')!;
    const words = this.root.querySelectorAll<HTMLElement>('.loading__title span');
    const bar = this.root.querySelector<HTMLElement>('.loading__bar')!;
    const meta = this.root.querySelector<HTMLElement>('.loading__meta')!;

    gsap.set(arcA, { strokeDasharray: `${ARC_LEN * 0.30} ${ARC_LEN}`, strokeDashoffset: ARC_LEN * 0.30 });
    gsap.set(arcB, { strokeDasharray: `${ARC_LEN_B * 0.18} ${ARC_LEN_B}`, strokeDashoffset: ARC_LEN_B * 0.18 });

    if (reduced) {
      gsap.set([logo, bar, meta], { opacity: 1 });
      gsap.set(words, { opacity: 1 });
      gsap.set([arcA, arcB], { opacity: 0.5, strokeDashoffset: 0 });
      return;
    }

    const tl = gsap.timeline();

    tl.fromTo(
      logo,
      { opacity: 0, scale: 0.74, rotate: -7, y: 18 },
      { opacity: 1, scale: 1, rotate: 0, y: 0, duration: 0.92, ease: 'expo.out' },
    )
      // the swoosh: two arcs whip around the icon as it lands
      .to(arcA, { opacity: 1, duration: 0.15 }, 0.10)
      .to(arcA, { strokeDashoffset: -ARC_LEN * 0.72, duration: 1.15, ease: 'power3.inOut' }, 0.10)
      .fromTo(arcA, { rotate: -120 }, { rotate: 78, duration: 1.25, ease: 'power3.inOut' }, 0.10)
      .to(arcB, { opacity: 1, duration: 0.15 }, 0.24)
      .to(arcB, { strokeDashoffset: -ARC_LEN_B * 0.55, duration: 1.05, ease: 'power2.inOut' }, 0.24)
      .fromTo(arcB, { rotate: 150 }, { rotate: -46, duration: 1.15, ease: 'power2.inOut' }, 0.24)
      .fromTo(
        spark,
        { opacity: 0, rotate: -130 },
        { opacity: 1, rotate: 96, duration: 1.2, ease: 'power3.inOut' },
        0.12,
      )
      .to(spark, { opacity: 0, duration: 0.35 }, 1.05)
      // light sweep across the artwork, timed to the arcs passing behind it
      .fromTo(
        sheen,
        { left: '-130%' },
        { left: '150%', duration: 0.95, ease: 'power2.inOut' },
        0.42,
      )
      .fromTo(
        words,
        { opacity: 0, y: 12, letterSpacing: '0.62em' },
        {
          opacity: 1,
          y: 0,
          letterSpacing: '0.34em',
          duration: 0.75,
          ease: 'power3.out',
          stagger: 0.09,
        },
        0.56,
      )
      .to([bar, meta], { opacity: 1, duration: 0.5 }, 0.9);

    // Gentle idle rotation once the entrance settles.
    this.idleSpin = gsap.to([arcA, arcB], {
      rotate: '+=360',
      duration: 26,
      ease: 'none',
      repeat: -1,
      stagger: { each: 4, from: 'end' },
    });
    this.idleSpin.pause();
    tl.add(() => {
      gsap.to([arcA, arcB], { opacity: 0.45, duration: 0.8 });
      this.idleSpin?.play();
    }, 1.35);
  }

  private paint(): void {
    const p = Math.round(this.shown * 100);
    this.fill.style.width = `${p}%`;
    this.pct.textContent = `${p}%`;
  }

  /** Ease the displayed percentage toward the real one so it never jumps. */
  private tick = (): void => {
    this.lastTick = performance.now();
    this.shown += (this.target - this.shown) * 0.14;
    if (this.target - this.shown < 0.004) this.shown = this.target;
    this.paint();
    if (!this.done) this.raf = requestAnimationFrame(this.tick);
  };

  setProgress(fraction: number, label?: string): void {
    this.target = Math.max(this.target, Math.min(1, fraction));
    if (label) this.msg.textContent = `Preparing ${label}…`;
    // If the rAF easing has stalled, write the value straight through.
    if (performance.now() - this.lastTick > 400) {
      this.shown = this.target;
      this.paint();
    }
  }

  setMessage(text: string): void {
    this.msg.textContent = text;
  }

  /**
   * Preselect a mode, e.g. because a save was resumed.
   *
   * A resumed run already has a mode; offering a different one would either be
   * ignored or silently change the rules of a run in progress.
   */
  presetMode(mode: GameMode, locked = false): void {
    this.chosenMode = mode;
    // Called during `start()`, which runs before `ready()` builds the row, so
    // the lock has to be remembered and applied when the row appears.
    this.modeLocked = this.modeLocked || locked;
    this.syncModeRow();
  }

  /**
   * Story / Free Roam selection.
   *
   * Built in JS rather than added to index.html: this is the minimal version
   * the phase asks for, and full menu polish is a later phase — dead markup
   * left behind by a redesign is worse than none.
   */
  private buildModeRow(): void {
    if (this.modeRow || !this.startBtn.parentElement) return;

    const row = document.createElement('div');
    row.className = 'loading__modes';
    row.style.cssText =
      'display:flex;gap:8px;justify-content:center;margin:0 0 12px;';

    for (const mode of ['story', 'freeRoam'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = mode;
      b.textContent = mode === 'story' ? 'Story' : 'Free Roam';
      b.style.cssText =
        'padding:7px 16px;border-radius:999px;border:1px solid rgba(74,70,62,0.28);' +
        'background:transparent;color:#4a463e;font:600 12px/1 system-ui,sans-serif;' +
        'letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;';
      b.addEventListener('click', () => {
        this.chosenMode = mode;
        this.syncModeRow();
      });
      row.appendChild(b);
    }

    this.startBtn.parentElement.insertBefore(row, this.startBtn);
    this.modeRow = row;
    this.syncModeRow();
  }

  private syncModeRow(): void {
    if (!this.modeRow) return;

    if (this.modeLocked) {
      this.modeRow.style.opacity = '0.55';
      this.modeRow.style.pointerEvents = 'none';
      this.modeRow.title = 'Continuing a saved run.';
    }

    for (const b of this.modeRow.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.mode === this.chosenMode;
      b.style.background = on ? '#4a463e' : 'transparent';
      b.style.color = on ? '#f8f4ea' : '#4a463e';
      b.setAttribute('aria-pressed', String(on));
    }
  }

  /** Everything is loaded; wait for a gesture so audio may start. */
  ready(): void {
    this.target = 1;
    this.msg.textContent = 'Ready when you are.';
    this.buildModeRow();
    this.startBtn.hidden = false;
    gsap.fromTo(
      this.startBtn,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' },
    );
  }

  private begin(): void {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.safety);
    this.idleSpin?.kill();
    this.startBtn.disabled = true;

    const logo = this.root.querySelector<HTMLElement>('.logo')!;
    const arcs = this.root.querySelectorAll<SVGCircleElement>('.swoosh__arc');

    gsap
      .timeline({
        onComplete: () => {
          this.root.style.display = 'none';
          this.onStart(this.chosenMode);
        },
      })
      // one last outward swoosh as the world takes over
      .to(arcs, { scale: 1.7, opacity: 0, duration: 0.7, ease: 'power2.out' }, 0)
      .to(logo, { scale: 1.12, opacity: 0, duration: 0.6, ease: 'power2.in' }, 0.05)
      .to(
        this.root.querySelectorAll('.loading__title, .loading__bar, .loading__meta, .loading__start'),
        { opacity: 0, y: -10, duration: 0.4 },
        0,
      )
      .to(this.root, { opacity: 0, duration: 0.55, ease: 'power2.inOut' }, 0.2);
  }

  /** Loading failed hard — say so instead of spinning forever. */
  fail(message: string): void {
    this.msg.textContent = message;
    this.pct.textContent = '!';
  }
}

import './PhotoMode.css';

/**
 * Photo mode.
 *
 * The brief asks for it, and the phone has had a Camera tile labelled "not
 * yet" since Phase 11 because this is its own piece of work. It is, mostly
 * for one reason: **the drawing buffer is gone by the time anybody asks for
 * it.** The renderer runs without `preserveDrawingBuffer`, so a canvas read
 * on a later tick returns transparent black. The capture therefore has to
 * happen in the same task as the draw, which is a rule about *scheduling*
 * rather than about pixels, and it is why `PhotoDeps.capture` is synchronous
 * and returns a data URL rather than being a tidy `async` that resolves a
 * Blob.
 *
 * What this file owns: the chrome, the toggles and the download. What it
 * deliberately does not own: the camera, the simulation clock and the
 * renderer. Those reach it through `PhotoDeps` and it cannot touch them
 * otherwise.
 *
 * Lazy, on the pattern the other six panels follow.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface PhotoDeps {
  /**
   * Draw one frame and read it back, in the same task.
   *
   * Returns a `data:image/png` URL, or null if the read failed — which it
   * does on a lost context, and which must not throw into a click handler.
   */
  capture(): string | null;
  /** Stop and restart the simulation. Photo mode is a still, not a slow-mo. */
  freeze(on: boolean): void;
  /** Hide the player's own body, for a landscape without a person in it. */
  showPlayer(on: boolean): void;
  /** Roll the camera, in radians. The one framing control the game lacks. */
  setRoll(radians: number): void;
  /** Vertical field of view, degrees. Wide for a room, long for a hill. */
  setFov(degrees: number): void;
  toast(title: string, body: string): void;
  /** Where the player is, for the filename. Never a handle on the player. */
  placeName(): string;
}

/** Defaults, and the range each control moves through. */
const FOV = { min: 25, max: 95, step: 1, default: 55 };
const ROLL = { min: -30, max: 30, step: 1, default: 0 };

export class PhotoMode {
  private readonly root = $('photo');
  private readonly guides = $('photoGuides');
  private playerVisible = true;
  private guidesOn = false;

  constructor(private readonly deps: PhotoDeps) {
    this.wire();
  }

  /** Called by `LazyPanel` each time photo mode is entered. */
  open(): void {
    this.deps.freeze(true);
    this.reset();
  }

  /** Called on the way out. Everything it changed is put back here. */
  close(): void {
    this.deps.freeze(false);
    this.deps.showPlayer(true);
    this.deps.setRoll(0);
    this.deps.setFov(FOV.default);
    this.playerVisible = true;
  }

  private reset(): void {
    this.setSlider('photoFov', FOV.default);
    this.setSlider('photoRoll', ROLL.default);
    this.deps.setFov(FOV.default);
    this.deps.setRoll(0);
    this.playerVisible = true;
    this.deps.showPlayer(true);
    this.syncToggles();
  }

  private setSlider(id: string, value: number): void {
    const el = $<HTMLInputElement>(id);
    el.value = String(value);
    this.syncOutput(el);
  }

  private syncOutput(el: HTMLInputElement): void {
    const out = document.querySelector<HTMLElement>(`.photo__value[data-for="${el.id}"]`);
    if (out) out.textContent = el.id === 'photoRoll' ? `${el.value}°` : el.value;
  }

  private syncToggles(): void {
    const p = $<HTMLButtonElement>('photoPlayer');
    p.classList.toggle('is-on', this.playerVisible);
    p.setAttribute('aria-pressed', String(this.playerVisible));

    const g = $<HTMLButtonElement>('photoGuidesBtn');
    g.classList.toggle('is-on', this.guidesOn);
    g.setAttribute('aria-pressed', String(this.guidesOn));
    this.guides.hidden = !this.guidesOn;
  }

  private wire(): void {
    for (const id of ['photoFov', 'photoRoll']) {
      const el = $<HTMLInputElement>(id);
      el.addEventListener('input', () => {
        this.syncOutput(el);
        if (id === 'photoFov') this.deps.setFov(Number(el.value));
        else this.deps.setRoll((Number(el.value) * Math.PI) / 180);
      });
    }

    $('photoPlayer').addEventListener('click', () => {
      this.playerVisible = !this.playerVisible;
      this.deps.showPlayer(this.playerVisible);
      this.syncToggles();
    });

    $('photoGuidesBtn').addEventListener('click', () => {
      this.guidesOn = !this.guidesOn;
      this.syncToggles();
    });

    $('photoShoot').addEventListener('click', () => this.shoot());
  }

  /**
   * Take the picture.
   *
   * The chrome is hidden for the duration and restored immediately, without
   * awaiting anything in between — an `await` here would put the capture on a
   * later task and read an empty buffer, which is the whole hazard this file
   * exists around. `hidden` is synchronous and layout is not needed, because
   * nothing is being measured; the next composite is the one that matters and
   * it has not happened yet.
   */
  private shoot(): void {
    const wasGuides = this.guides.hidden;
    this.root.classList.add('is-shooting');
    this.guides.hidden = true;

    const url = this.deps.capture();

    this.root.classList.remove('is-shooting');
    this.guides.hidden = wasGuides;

    if (!url) {
      this.deps.toast('Photo', 'Could not save that one.');
      return;
    }
    this.download(url);
  }

  private download(url: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = `last-horizon-${this.deps.placeName()}.png`;
    // Not appended to the document: a detached anchor still dispatches a
    // click, and appending one would be a node to remember to remove.
    a.click();
    this.deps.toast('Photo', 'Saved to your downloads.');
  }
}

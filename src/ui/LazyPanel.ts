/**
 * One panel that arrives late, done once.
 *
 * By the end of Phase 11 `HUD` carried five structurally identical copies of
 * the same forty lines — map, info, phone, pause, and the story panels before
 * them. Each had a `wanted` flag, a `loading` promise, an `instance`, and the
 * reveal ordering that Phase 11 had to learn twice:
 *
 *   1. Record that the player asked. `wanted` is not `visible`; between the
 *      keypress and the chunk landing they are different facts, and the Escape
 *      handler wants the second one.
 *   2. Import once, memoised.
 *   3. **Reveal only after the import resolves.** Vite resolves a dynamic
 *      import after its stylesheet has landed, so this is what stops a flash
 *      of unstyled markup — and, for panels whose *controls* are also in the
 *      chunk, a panel whose buttons do nothing yet. `openMap` and `openInfo`
 *      both shipped the wrong order first.
 *   4. Bail if the player changed their mind while it was in flight.
 *
 * Getting any of those four wrong is invisible on a fast connection and
 * obvious on a slow one, which is the worst way for a bug to behave. Writing
 * it once means the sixth screen cannot get it wrong at all.
 *
 * The panel's *markup* stays static in `index.html`. That is deliberate and
 * unchanged: it keeps every panel present for an accessibility snapshot
 * whether or not its chunk was ever fetched.
 */

export interface LazyPanelOptions<T> {
  /** The element to show and hide. Its markup is already in the document. */
  readonly element: HTMLElement;
  /** Fetches the chunk and builds the instance. Called at most once. */
  readonly load: () => Promise<T>;
  /** Run every time the panel opens, after the instance exists. */
  readonly onOpen?: (instance: T) => void;
  /**
   * Class toggled for the open transition, if the panel has one.
   *
   * Applied on the frame *after* the element is shown, so the transition has a
   * starting state to animate from — and removed on close, with the element
   * hidden only once the transition has run.
   */
  readonly transitionClass?: string;
  /** How long the close transition takes, ms. Ignored without a class. */
  readonly closeDelay?: number;
  /** Called after the element is shown. Where input release belongs. */
  readonly afterShow?: () => void;
  /**
   * Interface sound, by meaning.
   *
   * Here rather than in each panel's wrapper so every panel sounds the same
   * and none of them can forget. `open` fires when the element is actually
   * revealed — after the chunk lands, not when the key was pressed — so a
   * first open does not click before anything appears.
   */
  readonly sound?: (kind: 'open' | 'close') => void;
}

export class LazyPanel<T> {
  private instance: T | null = null;
  private loading: Promise<T> | null = null;
  /** What the player asked for, which can run ahead of what is on screen. */
  private wantedValue = false;

  constructor(private readonly o: LazyPanelOptions<T>) {}

  /** Is it on screen? The Escape handler and the pause rules want this one. */
  get open(): boolean {
    return this.o.element.hidden === false;
  }

  /** Has the player asked for it? May be true while the chunk is in flight. */
  get wanted(): boolean {
    return this.wantedValue;
  }

  /** The built panel, or null if it has never been opened. */
  get current(): T | null {
    return this.instance;
  }

  toggle(): void {
    this.set(!this.wantedValue);
  }

  set(open: boolean): void {
    if (!open) {
      // Only if something was actually on screen. `set(false)` is called
      // defensively from the Escape cascade and from `Game` on several paths;
      // a click every time would be a click on nothing.
      if (this.open) this.o.sound?.('close');
      this.wantedValue = false;
      this.hide();
      return;
    }

    this.wantedValue = true;
    void this.ensure().then((instance) => {
      // The player may have pressed the key twice while this was in flight.
      if (!this.wantedValue) return;
      this.o.onOpen?.(instance);
      this.show();
    });
  }

  /** Fetch the chunk without showing anything. For preloading, and for tests. */
  ensure(): Promise<T> {
    this.loading ??= this.o.load().then((instance) => {
      this.instance = instance;
      return instance;
    });
    return this.loading;
  }

  private show(): void {
    this.o.element.hidden = false;
    this.o.sound?.('open');
    if (this.o.transitionClass) {
      const cls = this.o.transitionClass;
      requestAnimationFrame(() => this.o.element.classList.add(cls));
    }
    this.o.afterShow?.();
  }

  private hide(): void {
    if (!this.o.transitionClass) {
      this.o.element.hidden = true;
      return;
    }
    this.o.element.classList.remove(this.o.transitionClass);
    window.setTimeout(() => {
      // Re-checked, because the player may have re-opened it inside the
      // transition — hiding then would close a panel they just asked for.
      if (!this.wantedValue) this.o.element.hidden = true;
    }, this.o.closeDelay ?? 220);
  }
}

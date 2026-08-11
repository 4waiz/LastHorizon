import './PauseMenu.css';

/**
 * Pause, and the three save slots.
 *
 * The screen acceptance criterion 3 actually hangs on: *"keyboard-only, touch
 * and gamepad users can start, save, play and exit."* Two of those four verbs
 * had nowhere to happen before this — the game could save from a desk in the
 * family home and from an autosave, and a player could not ask for either.
 *
 * Fifth panel on the lazy pattern: markup static in `index.html`, code and
 * stylesheet in a chunk fetched on the first pause, revealed only once that
 * chunk lands.
 *
 * **The slot list is read, never assumed.** `SaveService.listSlots` already
 * reports unreadable slots distinctly from empty ones, and this shows that
 * difference rather than flattening it — a corrupt save that presents as "no
 * save" is how a player loses a run and never finds out why.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface PauseSlot {
  readonly slot: string;
  readonly exists: boolean;
  /** Absent when the slot is empty *or* unreadable — `damaged` tells them apart. */
  readonly ageYears?: number;
  readonly mode?: string;
  readonly savedAt?: number;
  readonly damaged?: boolean;
}

export interface PauseDeps {
  slots(): Promise<readonly PauseSlot[]>;
  save(slot: string): Promise<boolean>;
  load(slot: string): Promise<boolean>;
  resume(): void;
  openSettings(): void;
  openCredits(): void;
  toast(title: string, body: string): void;
}

type View = 'main' | 'save' | 'load';

export class PauseMenu {
  private readonly body = $('pauseBody');
  private readonly title = $('pauseTitle');
  private readonly back = $<HTMLButtonElement>('pauseBack');
  private busy = false;

  constructor(private readonly d: PauseDeps) {
    this.back.addEventListener('click', () => void this.go('main'));
    this.body.addEventListener('click', (e) => void this.onClick(e));
  }

  /** Called every time the menu opens, so a slot list is never stale. */
  open(): void {
    void this.go('main');
  }

  private async go(view: View): Promise<void> {
    this.back.hidden = view === 'main';
    this.title.textContent =
      view === 'main' ? 'Paused' : view === 'save' ? 'Save' : 'Load';

    if (view === 'main') this.renderMain();
    else await this.renderSlots(view);

    this.body.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }

  private renderMain(): void {
    this.body.innerHTML = `
      <ul class="pause__menu">
        <li><button type="button" data-do="resume" class="pause__item">Resume</button></li>
        <li><button type="button" data-do="save" class="pause__item">Save</button></li>
        <li><button type="button" data-do="load" class="pause__item">Load</button></li>
        <li><button type="button" data-do="settings" class="pause__item">Settings</button></li>
        <li><button type="button" data-do="credits" class="pause__item">Credits</button></li>
      </ul>
      <p class="pause__note">The world is still while this is open.</p>`;
  }

  private async renderSlots(view: View): Promise<void> {
    const slots = await this.d.slots();
    const verb = view === 'save' ? 'Save here' : 'Load';
    this.body.innerHTML = `<ul class="pause__slots">${slots.map((s) => {
      const auto = s.slot === 'autosave';
      // Autosave is readable but never writable by hand: a player who
      // overwrites it has destroyed the one save they did not choose to make.
      const canAct = view === 'save' ? !auto : s.exists && !s.damaged;
      return `
      <li class="pause__slot${s.damaged ? ' is-damaged' : ''}">
        <div class="pause__slotMain">
          <span class="pause__slotName">${label(s.slot)}</span>
          <span class="pause__slotNote">${describe(s)}</span>
        </div>
        <button type="button" class="pause__act" data-slot="${esc(s.slot)}"
                data-mode="${view}"${canAct ? '' : ' disabled aria-disabled="true"'}>
          ${auto && view === 'save' ? 'automatic' : verb}
        </button>
      </li>`;
    }).join('')}</ul>`;
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-do], [data-slot]');
    if (!el || this.busy) return;

    const act = el.dataset.do;
    if (act === 'resume') return this.d.resume();
    if (act === 'settings') return this.d.openSettings();
    if (act === 'credits') return this.d.openCredits();
    if (act === 'save' || act === 'load') return void this.go(act);

    const slot = el.dataset.slot;
    const mode = el.dataset.mode;
    if (!slot || !mode) return;

    // One at a time. A double-tapped save is two writes racing for the same
    // key, and the loser is whatever the player actually wanted.
    this.busy = true;
    try {
      const ok = mode === 'save' ? await this.d.save(slot) : await this.d.load(slot);
      this.d.toast(
        ok ? (mode === 'save' ? 'Saved' : 'Loaded') : 'That did not work',
        ok
          ? `${label(slot)} — ${mode === 'save' ? 'written' : 'restored'}.`
          : 'The slot could not be read or written.',
      );
      if (ok && mode === 'load') this.d.resume();
      else await this.go(mode as View);
    } finally {
      this.busy = false;
    }
  }
}

const label = (slot: string): string =>
  slot === 'autosave' ? 'Autosave' : `Slot ${slot.replace('slot', '')}`;

function describe(s: PauseSlot): string {
  if (s.damaged) return 'damaged — kept, but cannot be loaded';
  if (!s.exists) return 'empty';
  const age = s.ageYears !== undefined ? `age ${Math.floor(s.ageYears)}` : '';
  const when = s.savedAt ? new Date(s.savedAt).toLocaleDateString() : '';
  return [s.mode, age, when].filter(Boolean).join(' · ');
}

/** Escape anything reaching innerHTML. A save file is untrusted input. */
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

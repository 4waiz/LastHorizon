import './LifePanel.css';

/**
 * What you are carrying, what you have done, and what you own.
 *
 * Three of the screens §4 of `docs/UI_INVENTORY.md` listed as missing, and the
 * three that close what that document calls the **reachability gap**: Phases 9
 * and 10 added weapons, a criminal record and an aeroplane, and none of them
 * had an interface. A HUD ammo counter is a readout, not a screen — you could
 * see how many rounds were left and had no way to look at what you owned.
 *
 * One panel with three tabs rather than three panels, because they answer one
 * question — *what is my situation?* — and a player who wants to know what a
 * fine will cost is usually also wondering what they are carrying. Three
 * separate keybinds for that would be three things to remember.
 *
 * **Not a GTA pause-menu grid.** No stat wall, no percentages, no map
 * overlay. Each tab is a short list in the same warm off-white cards the rest
 * of the interface uses, with the same tokens; the tab strip is a real
 * `role="tablist"` so arrow keys work and a screen reader announces it as one.
 *
 * Lazy on the pattern the last five panels established: markup static in
 * `index.html`, code and stylesheet in a chunk fetched on first open, and the
 * panel revealed only once that chunk has landed.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface CarriedItem {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** `food`, `clothing`, `weapon`, `keepsake` — whatever `Inventory` calls it. */
  readonly kind: string;
  /** Swatch colour for clothing, if it has one. */
  readonly colour?: string;
  /** Worn or held right now. */
  readonly equipped: boolean;
  /** False when the item cannot be equipped at all, e.g. a keepsake. */
  readonly equippable: boolean;
  /**
   * Whether taking it off is a thing that can happen.
   *
   * Not the inverse of `equippable`. A shirt is always being worn — the slot
   * is never empty, and you change it by putting a different one on — so a
   * worn shirt offers no button at all. A hat can genuinely come off. A
   * "Take off" that always fails is worse than no button.
   */
  readonly removable: boolean;
}

export interface RecordEntry {
  readonly crime: string;
  /** How much Heat it carried, for the ordering the player sees. */
  readonly heat: number;
}

export interface CriminalRecord {
  readonly entries: readonly RecordEntry[];
  readonly arrests: number;
  readonly finesOwed: number;
  /** 0..5. The live level, not the history. */
  readonly heatLevel: number;
  /** Where the player's things go when they are taken in. */
  readonly impounded: readonly string[];
}

export interface OwnedThing {
  readonly id: string;
  readonly name: string;
  /** `Parked at the apron`, `Impounded`, `Yours` — worded by the host. */
  readonly status: string;
  readonly kind: 'property' | 'vehicle' | 'aircraft';
}

export interface LifeDeps {
  carrying(): readonly CarriedItem[];
  /** Returns false if it could not be equipped, so the panel can say why. */
  equip(itemId: string): boolean;
  unequip(itemId: string): boolean;
  /** Returns false if the item is not consumable or nothing happened. */
  use(itemId: string): boolean;
  record(): CriminalRecord;
  owned(): readonly OwnedThing[];
  money(): number;
  toast(title: string, body: string): void;
}

type Tab = 'carrying' | 'record' | 'property';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'carrying', label: 'Carrying' },
  { id: 'record', label: 'Record' },
  { id: 'property', label: 'Property' },
];

/** Sentence case, because a kind id is a slug and a heading is not. */
function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1).replace(/[_-]/g, ' ');
}

export class LifePanel {
  private readonly strip = $('life-tabs');
  private readonly body = $('life-body');
  private readonly summary = $('life-summary');
  private tab: Tab = 'carrying';

  constructor(private readonly deps: LifeDeps) {
    this.buildTabs();

    // Arrow keys move between tabs, which is what `role="tablist"` promises
    // and what a keyboard-only player will try first.
    this.strip.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const i = TABS.findIndex((t) => t.id === this.tab);
      const next = TABS[(i + dir + TABS.length) % TABS.length];
      this.select(next.id);
      this.focusTab(next.id);
    });
  }

  /** Called by `LazyPanel` each time the panel is shown. */
  open(): void {
    this.render();
  }

  private buildTabs(): void {
    this.strip.replaceChildren(
      ...TABS.map((t) => {
        const b = document.createElement('button');
        b.className = 'life__tab';
        b.type = 'button';
        b.role = 'tab';
        b.id = `life-tab-${t.id}`;
        b.textContent = t.label;
        b.addEventListener('click', () => this.select(t.id));
        return b;
      }),
    );
    this.syncTabs();
  }

  private select(tab: Tab): void {
    this.tab = tab;
    this.syncTabs();
    this.render();
  }

  private focusTab(tab: Tab): void {
    document.getElementById(`life-tab-${tab}`)?.focus();
  }

  private syncTabs(): void {
    for (const t of TABS) {
      const el = document.getElementById(`life-tab-${t.id}`);
      if (!el) continue;
      const on = t.id === this.tab;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-selected', String(on));
      // Roving tabindex: only the selected tab is in the tab order, so Tab
      // leaves the strip rather than walking through every tab in it.
      el.tabIndex = on ? 0 : -1;
    }
  }

  private render(): void {
    this.summary.textContent = `$${this.deps.money()}`;
    if (this.tab === 'carrying') this.renderCarrying();
    else if (this.tab === 'record') this.renderRecord();
    else this.renderProperty();
  }

  /** A titled card with rows in it. Every tab is built from these. */
  private card(title: string, rows: HTMLElement[], empty: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'life__card';

    const h = document.createElement('h4');
    h.className = 'life__card-title';
    h.textContent = title;
    section.append(h);

    if (rows.length === 0) {
      const p = document.createElement('p');
      p.className = 'life__empty';
      p.textContent = empty;
      section.append(p);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'life__list';
      ul.append(...rows);
      section.append(ul);
    }
    return section;
  }

  private row(label: string, note: string, swatch?: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'life__row';

    if (swatch) {
      const dot = document.createElement('span');
      dot.className = 'life__swatch';
      dot.style.background = swatch;
      li.append(dot);
    }

    const name = document.createElement('span');
    name.className = 'life__name';
    name.textContent = label;

    const meta = document.createElement('span');
    meta.className = 'life__note';
    meta.textContent = note;

    li.append(name, meta);
    return li;
  }

  // ------------------------------------------------------------- carrying

  private renderCarrying(): void {
    const items = this.deps.carrying();
    const groups = new Map<string, CarriedItem[]>();
    for (const it of items) {
      const list = groups.get(it.kind);
      if (list) list.push(it);
      else groups.set(it.kind, [it]);
    }

    const cards = [...groups.entries()].map(([kind, list]) =>
      this.card(
        kindLabel(kind),
        list.map((it) => this.itemRow(it)),
        'Nothing here.',
      ),
    );

    this.body.replaceChildren(
      ...(cards.length
        ? cards
        : [this.card('Carrying', [], 'Your pockets are empty.')]),
    );
  }

  private itemRow(it: CarriedItem): HTMLLIElement {
    const li = this.row(
      it.name,
      it.count > 1 ? `x${it.count}` : '',
      it.colour,
    );
    if (it.equipped) li.classList.add('is-equipped');

    // Consumables get Use; anything wearable gets Wear/Take off. A keepsake
    // gets neither, and says so by having no button rather than a dead one.
    const actions = document.createElement('span');
    actions.className = 'life__actions';

    if (it.kind === 'food') {
      actions.append(this.action('Use', () => {
        if (this.deps.use(it.id)) this.render();
        else this.deps.toast(it.name, 'Not now.');
      }));
    } else if (it.equipped && it.removable) {
      actions.append(this.action('Take off', () => {
        if (this.deps.unequip(it.id)) this.render();
      }));
    } else if (!it.equipped && it.equippable) {
      actions.append(this.action('Wear', () => {
        if (this.deps.equip(it.id)) this.render();
        else this.deps.toast(it.name, 'Cannot wear that right now.');
      }));
    }

    li.append(actions);
    return li;
  }

  private action(label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'life__action';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  }

  // --------------------------------------------------------------- record

  private renderRecord(): void {
    const r = this.deps.record();

    const state = document.createElement('section');
    state.className = 'life__card';
    const h = document.createElement('h4');
    h.className = 'life__card-title';
    h.textContent = 'Standing';
    const dl = document.createElement('dl');
    dl.className = 'life__facts';
    const fact = (k: string, v: string) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    };
    // Numerals as well as the pip row on the HUD, which is the whole point of
    // `heatNumerals` in settings: a level you can only read as five coloured
    // dots is not readable by everyone.
    fact('Wanted level', `${r.heatLevel} of 5`);
    fact('Times brought in', String(r.arrests));
    fact('Fines owed', r.finesOwed > 0 ? `$${r.finesOwed}` : 'None');
    state.append(h, dl);

    // Most recent first: a record is read from the top.
    const offences = [...r.entries]
      .reverse()
      .map((e) => this.row(e.crime, e.heat > 0 ? `Heat ${e.heat}` : ''));

    this.body.replaceChildren(
      state,
      this.card('Offences', offences, 'Nothing on it. Keep it that way.'),
      this.card(
        'Held at the station',
        r.impounded.map((name) => this.row(name, 'Impounded')),
        'Nothing of yours is held.',
      ),
    );
  }

  // ------------------------------------------------------------- property

  private renderProperty(): void {
    const owned = this.deps.owned();
    const byKind = (k: OwnedThing['kind']) =>
      owned.filter((o) => o.kind === k).map((o) => this.row(o.name, o.status));

    this.body.replaceChildren(
      this.card('Places', byKind('property'), 'Nowhere of your own yet.'),
      this.card('Vehicles', byKind('vehicle'), 'Nothing on the drive.'),
      this.card('Aircraft', byKind('aircraft'), 'Nothing on the apron.'),
    );
  }
}

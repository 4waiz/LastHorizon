import './Phone.css';

/**
 * The phone.
 *
 * A compact hub rather than a second interface. The brief asks for messages,
 * map, jobs, contacts, garage recovery, camera and journal in one place, and
 * the thing that makes that *coherent* rather than a drawer of unrelated
 * screens is that **the phone owns almost nothing**. Jobs come from
 * `TaskSystem`, contacts from `Relationships`, the garage from
 * `VehicleRegistry`, and Map and Journal simply open the panels that already
 * exist. Everything arrives through `PhoneDeps`, so this file knows about the
 * game the way `SettingsPanel` knows about `Settings` — through a narrow
 * interface it cannot reach past.
 *
 * Lazy, on the pattern the last three panels established: markup static in
 * `index.html`, code and stylesheet in a chunk fetched when the phone is first
 * opened, and the panel revealed only once that chunk has landed.
 *
 * **Not built here, and not pretended:** Messages and Camera. Messages needs a
 * conversation store nothing writes to yet, and Camera is photo mode, which is
 * its own piece of work. Their tiles are present and say so rather than
 * opening an empty screen — a tile that lies is worse than one that waits.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface PhoneJob {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly pay: number;
  /** Completed runs, which is what the difficulty scales on. */
  readonly done: number;
  readonly active: boolean;
}

export interface PhoneContact {
  readonly id: string;
  readonly name: string;
  /** A one-line read on the relationship, already worded by the host. */
  readonly note: string;
}

export interface PhoneVehicle {
  readonly id: string;
  readonly name: string;
  /** `parked`, `impounded`, `lost` — whatever the registry calls it. */
  readonly status: string;
  readonly recoverable: boolean;
}

export interface PhoneDeps {
  jobs(): readonly PhoneJob[];
  contacts(): readonly PhoneContact[];
  vehicles(): readonly PhoneVehicle[];
  /** Returns false if it could not be recovered, so the app can say so. */
  recoverVehicle(id: string): boolean;
  openMap(): void;
  openJournal(): void;
  money(): number;
  toast(title: string, body: string): void;
  /**
   * Resolved once the data behind the apps is actually loadable.
   *
   * The Work app lists the job catalogue, which is a lazy chunk from Phase 12
   * onward. Opening the phone before it lands would render an empty Work
   * screen that is indistinguishable from "you have no jobs" — the phone's own
   * rule is that a tile which lies is worse than one that waits, and an app
   * that lies is worse still.
   */
  ready(): Promise<void>;
}

/** Which screen is showing. `home` is the app grid. */
type Screen = 'home' | 'jobs' | 'contacts' | 'garage';

interface AppTile {
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
  /** What tapping it does. `null` means "present but not built yet". */
  readonly open: 'screen' | 'delegate' | null;
  readonly screen?: Screen;
}

const APPS: readonly AppTile[] = [
  { id: 'jobs', label: 'Work', glyph: '▤', open: 'screen', screen: 'jobs' },
  { id: 'contacts', label: 'People', glyph: '☺', open: 'screen', screen: 'contacts' },
  { id: 'garage', label: 'Garage', glyph: '⚿', open: 'screen', screen: 'garage' },
  { id: 'map', label: 'Map', glyph: '◈', open: 'delegate' },
  { id: 'journal', label: 'Journal', glyph: '❏', open: 'delegate' },
  { id: 'messages', label: 'Messages', glyph: '✉', open: null },
  { id: 'camera', label: 'Camera', glyph: '◎', open: null },
];

export class Phone {
  private readonly body = $('phoneBody');
  private readonly title = $('phoneTitle');
  private readonly back = $<HTMLButtonElement>('phoneBack');
  private readonly money = $('phoneMoney');
  private screen: Screen = 'home';

  constructor(private readonly d: PhoneDeps) {
    this.back.addEventListener('click', () => this.go('home'));
    // Delegated, so a screen can be re-rendered without re-binding anything.
    this.body.addEventListener('click', (e) => this.onBodyClick(e));
    this.go('home');
  }

  /** Re-read everything. Called on open, so the phone is never stale. */
  refresh(): void {
    this.go(this.screen);
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.back.hidden = screen === 'home';
    this.money.textContent = `$${Math.round(this.d.money())}`;
    const titles: Record<Screen, string> = {
      home: 'Phone',
      jobs: 'Work',
      contacts: 'People',
      garage: 'Garage',
    };
    this.title.textContent = titles[screen];

    if (screen === 'home') this.renderHome();
    else if (screen === 'jobs') this.renderJobs();
    else if (screen === 'contacts') this.renderContacts();
    else this.renderGarage();

    // Focus the first control on the new screen, so a keyboard or gamepad
    // player is never left with focus on a button that has gone away.
    this.body.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus();
  }

  private onBodyClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-app], [data-recover]');
    if (!el) return;

    const recover = el.dataset.recover;
    if (recover) {
      const ok = this.d.recoverVehicle(recover);
      this.d.toast(
        ok ? 'Recovered' : 'Not now',
        ok ? 'It has been dropped back at the garage.' : 'That one cannot be brought back.',
      );
      this.go('garage');
      return;
    }

    const app = APPS.find((a) => a.id === el.dataset.app);
    if (!app) return;
    if (app.open === 'screen' && app.screen) {
      this.go(app.screen);
    } else if (app.open === 'delegate') {
      // Map and Journal are panels that already exist and are already lazy.
      // Opening one closes the phone, because two full-screen panels stacked
      // is not a thing anybody wants.
      if (app.id === 'map') this.d.openMap();
      else this.d.openJournal();
    }
  }

  // -- screens ---------------------------------------------------------------

  private renderHome(): void {
    this.body.innerHTML = `<ul class="phone__grid">${APPS.map((a) => `
      <li>
        <button type="button" class="phone__app${a.open === null ? ' is-soon' : ''}"
                data-app="${a.id}"${a.open === null ? ' disabled aria-disabled="true"' : ''}>
          <span class="phone__glyph" aria-hidden="true">${a.glyph}</span>
          <span class="phone__label">${a.label}</span>
          ${a.open === null ? '<span class="phone__soon">not yet</span>' : ''}
        </button>
      </li>`).join('')}</ul>`;
  }

  private renderJobs(): void {
    const jobs = this.d.jobs();
    if (!jobs.length) {
      this.body.innerHTML = empty('Nothing going today.');
      return;
    }
    this.body.innerHTML = `<ul class="phone__list">${jobs.map((j) => `
      <li class="phone__row${j.active ? ' is-active' : ''}">
        <div class="phone__rowMain">
          <span class="phone__rowName">${esc(j.name)}</span>
          <span class="phone__rowNote">${esc(j.summary)}</span>
        </div>
        <div class="phone__rowSide">
          <span class="phone__pay">$${j.pay}</span>
          <span class="phone__rowNote">${j.active ? 'in progress' : `done ${j.done}×`}</span>
        </div>
      </li>`).join('')}</ul>
      <p class="phone__foot">Work is taken on at the place that offers it, not from here.</p>`;
  }

  private renderContacts(): void {
    const people = this.d.contacts();
    if (!people.length) {
      this.body.innerHTML = empty('You have not met anybody yet.');
      return;
    }
    this.body.innerHTML = `<ul class="phone__list">${people.map((c) => `
      <li class="phone__row">
        <div class="phone__rowMain">
          <span class="phone__rowName">${esc(c.name)}</span>
          <span class="phone__rowNote">${esc(c.note)}</span>
        </div>
      </li>`).join('')}</ul>`;
  }

  private renderGarage(): void {
    const cars = this.d.vehicles();
    if (!cars.length) {
      this.body.innerHTML = empty('Nothing of yours parked anywhere.');
      return;
    }
    this.body.innerHTML = `<ul class="phone__list">${cars.map((v) => `
      <li class="phone__row">
        <div class="phone__rowMain">
          <span class="phone__rowName">${esc(v.name)}</span>
          <span class="phone__rowNote">${esc(v.status)}</span>
        </div>
        ${v.recoverable
          ? `<button type="button" class="phone__act" data-recover="${esc(v.id)}">Bring it back</button>`
          : ''}
      </li>`).join('')}</ul>`;
  }
}

const empty = (line: string): string => `<p class="phone__empty">${esc(line)}</p>`;

/**
 * Escape anything that reaches innerHTML.
 *
 * Every string here is authored in this repository today, so nothing is
 * hostile — but names come from a save file, and a save file is untrusted
 * input in exactly the way Phase 7's economy and Phase 10's flight state both
 * had to learn.
 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

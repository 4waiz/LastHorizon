import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LifePanel,
  type CarriedItem,
  type CriminalRecord,
  type LifeDeps,
  type OwnedThing,
} from '../src/ui/LifePanel';

/**
 * Carrying, record and property.
 *
 * The three screens that close the reachability gap: Phases 9 and 10 shipped
 * weapons, a criminal record and an aeroplane with no interface between them.
 *
 * These tests drive the real DOM the panel builds, because the failures worth
 * catching here are DOM failures — a button that appears on an item it cannot
 * act on, a tab strip that a keyboard cannot move through, an empty state that
 * reads as a bug.
 */

function mount(): void {
  document.body.innerHTML = `
    <div id="life" hidden>
      <span id="life-summary"></span>
      <div id="life-tabs" role="tablist"></div>
      <div id="life-body" role="tabpanel"></div>
    </div>`;
}

const item = (over: Partial<CarriedItem> = {}): CarriedItem => ({
  id: 'apple',
  name: 'Apple',
  count: 1,
  kind: 'food',
  equipped: false,
  equippable: false,
  removable: false,
  ...over,
});

const emptyRecord: CriminalRecord = {
  entries: [],
  arrests: 0,
  finesOwed: 0,
  heatLevel: 0,
  impounded: [],
};

function deps(over: Partial<LifeDeps> = {}): LifeDeps {
  return {
    carrying: () => [],
    equip: () => true,
    unequip: () => true,
    use: () => true,
    record: () => emptyRecord,
    owned: () => [],
    money: () => 0,
    toast: () => {},
    ...over,
  };
}

const tabs = () => [...document.querySelectorAll<HTMLElement>('.life__tab')];
const body = () => document.getElementById('life-body')!;
const rows = () => [...body().querySelectorAll<HTMLElement>('.life__row')];
const text = () => body().textContent ?? '';
const actionsIn = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLButtonElement>('.life__action')].map((b) => b.textContent);

beforeEach(mount);

describe('the tab strip', () => {
  it('builds three tabs with the first selected', () => {
    new LifePanel(deps()).open();
    expect(tabs().map((t) => t.textContent)).toEqual(['Carrying', 'Record', 'Property']);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('keeps only the selected tab in the tab order', () => {
    // Roving tabindex. Without it, Tab walks through every tab in the strip
    // instead of moving past it.
    new LifePanel(deps()).open();
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves with the arrow keys, and wraps', () => {
    new LifePanel(deps()).open();
    const strip = document.getElementById('life-tabs')!;

    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');

    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabs()[2].getAttribute('aria-selected'), 'did not wrap').toBe('true');
  });

  it('ignores keys that are not arrows', () => {
    new LifePanel(deps()).open();
    const strip = document.getElementById('life-tabs')!;
    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('switches the body when a tab is clicked', () => {
    new LifePanel(deps()).open();
    tabs()[1].click();
    expect(text()).toMatch(/Wanted level/);
    tabs()[2].click();
    expect(text()).toMatch(/Aircraft/);
  });
});

describe('carrying', () => {
  it('says so plainly when there is nothing', () => {
    new LifePanel(deps()).open();
    expect(text()).toMatch(/pockets are empty/i);
  });

  it('groups by kind and titles each group', () => {
    new LifePanel(
      deps({
        carrying: () => [
          item({ id: 'apple', kind: 'food' }),
          item({ id: 'hat_red', name: 'Red cap', kind: 'clothing', equippable: true }),
        ],
      }),
    ).open();
    const titles = [...body().querySelectorAll('.life__card-title')].map((h) => h.textContent);
    expect(titles).toEqual(['Food', 'Clothing']);
  });

  it('shows a count only when there is more than one', () => {
    new LifePanel(deps({ carrying: () => [item({ count: 3 }), item({ id: 'pear', count: 1 })] })).open();
    const notes = rows().map((r) => r.querySelector('.life__note')?.textContent);
    expect(notes).toEqual(['x3', '']);
  });

  it('offers Use on food and nothing else', () => {
    new LifePanel(deps({ carrying: () => [item({ kind: 'food' })] })).open();
    expect(actionsIn(rows()[0])).toEqual(['Use']);
  });

  it('offers Wear on clothing that is not on', () => {
    new LifePanel(
      deps({ carrying: () => [item({ kind: 'clothing', equippable: true, equipped: false })] }),
    ).open();
    expect(actionsIn(rows()[0])).toEqual(['Wear']);
  });

  /**
   * The case the `removable` flag exists for. A worn shirt has no button:
   * the slot is never empty and you change it by putting a different one on.
   * A "Take off" that always fails is worse than no button at all.
   */
  it('offers nothing on a worn shirt, and Take off on a worn hat', () => {
    new LifePanel(
      deps({
        carrying: () => [
          item({ id: 'shirt_sky', kind: 'clothing', equippable: true, equipped: true, removable: false }),
          item({ id: 'hat_red', kind: 'clothing', equippable: true, equipped: true, removable: true }),
        ],
      }),
    ).open();
    expect(actionsIn(rows()[0])).toEqual([]);
    expect(actionsIn(rows()[1])).toEqual(['Take off']);
  });

  it('offers nothing at all on a keepsake', () => {
    new LifePanel(deps({ carrying: () => [item({ kind: 'keepsake', equippable: false })] })).open();
    expect(actionsIn(rows()[0])).toEqual([]);
  });

  it('marks a worn item without relying on colour', () => {
    // `is-equipped` is weight plus an underline in the stylesheet. A colour
    // swatch alone would be unreadable to a colour-blind player, which is the
    // same argument the Heat numerals setting makes.
    new LifePanel(
      deps({ carrying: () => [item({ kind: 'clothing', equippable: true, equipped: true })] }),
    ).open();
    expect(rows()[0].classList.contains('is-equipped')).toBe(true);
  });

  it('re-reads the inventory after a successful action', () => {
    let eaten = false;
    const panel = new LifePanel(
      deps({
        carrying: () => (eaten ? [] : [item({ kind: 'food' })]),
        use: () => {
          eaten = true;
          return true;
        },
      }),
    );
    panel.open();
    body().querySelector<HTMLButtonElement>('.life__action')!.click();
    expect(text()).toMatch(/pockets are empty/i);
  });

  it('says so rather than silently doing nothing when an action fails', () => {
    const toast = vi.fn();
    new LifePanel(
      deps({
        carrying: () => [item({ kind: 'clothing', equippable: true })],
        equip: () => false,
        toast,
      }),
    ).open();
    body().querySelector<HTMLButtonElement>('.life__action')!.click();
    expect(toast).toHaveBeenCalledWith('Apple', expect.stringMatching(/cannot wear/i));
  });
});

describe('the record', () => {
  it('reads clean when it is clean', () => {
    new LifePanel(deps()).open();
    tabs()[1].click();
    expect(text()).toMatch(/Nothing on it/i);
    expect(text()).toMatch(/Nothing of yours is held/i);
  });

  it('shows the wanted level as numerals, not only as pips', () => {
    new LifePanel(deps({ record: () => ({ ...emptyRecord, heatLevel: 3 }) })).open();
    tabs()[1].click();
    expect(text()).toMatch(/3 of 5/);
  });

  it('lists offences most recent first', () => {
    new LifePanel(
      deps({
        record: () => ({
          ...emptyRecord,
          entries: [
            { crime: 'Trespass', heat: 1 },
            { crime: 'Theft', heat: 2 },
          ],
        }),
      }),
    ).open();
    tabs()[1].click();
    const names = rows().map((r) => r.querySelector('.life__name')?.textContent);
    expect(names.slice(0, 2)).toEqual(['Theft', 'Trespass']);
  });

  it('says None rather than $0 when nothing is owed', () => {
    new LifePanel(deps()).open();
    tabs()[1].click();
    expect(text()).toMatch(/None/);
    expect(text()).not.toMatch(/\$0\b.*owed/);
  });

  it('shows a fine when there is one', () => {
    new LifePanel(deps({ record: () => ({ ...emptyRecord, finesOwed: 250 }) })).open();
    tabs()[1].click();
    expect(text()).toMatch(/\$250/);
  });

  it('lists what the station is holding', () => {
    new LifePanel(deps({ record: () => ({ ...emptyRecord, impounded: ['Hatchback'] }) })).open();
    tabs()[1].click();
    expect(text()).toMatch(/Hatchback/);
  });
});

describe('property', () => {
  const thing = (over: Partial<OwnedThing> = {}): OwnedThing => ({
    id: 'x',
    name: 'Thing',
    status: 'Yours',
    kind: 'property',
    ...over,
  });

  it('shows all three headings even when everything is empty', () => {
    new LifePanel(deps()).open();
    tabs()[2].click();
    const titles = [...body().querySelectorAll('.life__card-title')].map((h) => h.textContent);
    expect(titles).toEqual(['Places', 'Vehicles', 'Aircraft']);
  });

  it('files each thing under its own heading', () => {
    new LifePanel(
      deps({
        owned: () => [
          thing({ id: 'flat', name: 'Starter flat', kind: 'property' }),
          thing({ id: 'car', name: 'Hatchback', kind: 'vehicle', status: 'In the pound' }),
          thing({ id: 'plane', name: 'Light aircraft', kind: 'aircraft', status: 'On the apron' }),
        ],
      }),
    ).open();
    tabs()[2].click();

    const cards = [...body().querySelectorAll('.life__card')];
    expect(cards[0].textContent).toMatch(/Starter flat/);
    expect(cards[1].textContent).toMatch(/Hatchback/);
    expect(cards[2].textContent).toMatch(/Light aircraft/);
  });

  it('does not leak a vehicle into the aircraft list', () => {
    new LifePanel(deps({ owned: () => [thing({ name: 'Van', kind: 'vehicle' })] })).open();
    tabs()[2].click();
    const cards = [...body().querySelectorAll('.life__card')];
    expect(cards[2].textContent).toMatch(/Nothing on the apron/);
  });
});

describe('the money readout', () => {
  it('is shown on every tab, because it is the one number that spans them', () => {
    const panel = new LifePanel(deps({ money: () => 412 }));
    panel.open();
    const summary = () => document.getElementById('life-summary')!.textContent;
    expect(summary()).toBe('$412');
    tabs()[1].click();
    expect(summary()).toBe('$412');
  });
});

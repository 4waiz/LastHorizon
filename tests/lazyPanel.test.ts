import { describe, expect, it, vi } from 'vitest';
import { LazyPanel } from '../src/ui/LazyPanel';

/**
 * The four rules a late-arriving panel has to follow.
 *
 * Every one of them was learned the expensive way in Phase 11 — twice for the
 * reveal ordering, which shipped wrong in `openMap` and again in `openInfo`.
 * Writing them once is only worth doing if they stay written, and this is what
 * keeps them.
 */

function el(): HTMLElement {
  const d = document.createElement('div');
  d.hidden = true;
  document.body.appendChild(d);
  return d;
}

/** A load that resolves when the test says so, not before. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('LazyPanel', () => {
  it('starts closed and unloaded', () => {
    const p = new LazyPanel({ element: el(), load: async () => 'x' });
    expect(p.open).toBe(false);
    expect(p.wanted).toBe(false);
    expect(p.current).toBeNull();
  });

  it('does not reveal the element until the chunk resolves', async () => {
    const e = el();
    const d = deferred<string>();
    const p = new LazyPanel({ element: e, load: () => d.promise });

    p.set(true);
    // Wanted immediately, but still hidden: this is the whole point. Revealing
    // here is a flash of unstyled markup, and for panels whose controls are in
    // the chunk, a panel whose buttons do nothing yet.
    expect(p.wanted).toBe(true);
    expect(e.hidden).toBe(true);

    d.resolve('panel');
    await d.promise;
    await Promise.resolve();
    expect(e.hidden).toBe(false);
    expect(p.current).toBe('panel');
  });

  it('does not reveal if the player changed their mind while it loaded', async () => {
    const e = el();
    const d = deferred<string>();
    const p = new LazyPanel({ element: e, load: () => d.promise });

    p.set(true);
    p.set(false);
    d.resolve('panel');
    await d.promise;
    await Promise.resolve();

    expect(e.hidden, 'a panel nobody wants must not appear').toBe(true);
    expect(p.wanted).toBe(false);
  });

  it('loads once however many times it is opened', async () => {
    const load = vi.fn(async () => 'panel');
    const p = new LazyPanel({ element: el(), load });

    p.set(true);
    p.set(false);
    p.set(true);
    await p.ensure();
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('runs onOpen every time, not only the first', async () => {
    const onOpen = vi.fn();
    const p = new LazyPanel({ element: el(), load: async () => 'panel', onOpen });

    p.set(true);
    await p.ensure();
    await Promise.resolve();
    p.set(false);
    p.set(true);
    await Promise.resolve();

    // The panel has to re-read its data each time — a stale slot list or a
    // stale job list is the bug this prevents.
    expect(onOpen.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('separates "wanted" from "on screen"', async () => {
    const e = el();
    const d = deferred<string>();
    const p = new LazyPanel({ element: e, load: () => d.promise });

    p.set(true);
    // The Escape handler asks `open`; it must not try to close something that
    // is not there yet.
    expect(p.wanted).toBe(true);
    expect(p.open).toBe(false);

    d.resolve('x');
    await d.promise;
    await Promise.resolve();
    expect(p.open).toBe(true);
  });

  it('ensure() fetches without showing anything', async () => {
    const e = el();
    const p = new LazyPanel({ element: e, load: async () => 'panel' });
    await p.ensure();
    expect(p.current).toBe('panel');
    expect(e.hidden, 'preloading is not opening').toBe(true);
  });

  it('re-opening inside the close transition does not hide it again', async () => {
    vi.useFakeTimers();
    const e = el();
    const p = new LazyPanel({
      element: e,
      load: async () => 'panel',
      transitionClass: 'is-on',
      closeDelay: 200,
    });

    p.set(true);
    await p.ensure();
    await Promise.resolve();
    e.hidden = false;

    p.set(false);
    p.set(true);          // changed their mind inside the 200 ms
    vi.advanceTimersByTime(300);

    expect(e.hidden, 'the delayed hide must re-check').toBe(false);
    vi.useRealTimers();
  });
});

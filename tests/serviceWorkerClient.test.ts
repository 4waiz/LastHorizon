import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerServiceWorker,
  resetServiceWorkerForTest,
  swState,
} from '../src/core/ServiceWorkerClient';

/**
 * Registration timing, which is the only interesting thing this module does
 * and the thing it got wrong.
 *
 * The first version waited unconditionally on `window.load`. Its call site is
 * the end of `boot()` — `async`, and awaiting ~1.4 MB of GLB — so `load` had
 * always fired by then, the listener never ran, and **the worker was never
 * installed**. No offline play, no update prompt, and nothing logged: the
 * failure was indistinguishable from a browser that does not support service
 * workers.
 *
 * Nothing caught it. There was no test, and the browser suite skips
 * registration entirely under `?e2e=1` (deliberately — a worker caching the
 * build between scenarios is how a suite starts testing the previous commit).
 * So this file exists to make the timing itself assertable.
 */

interface FakeSw {
  register: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  controller: null;
}

function installFakeServiceWorker(): FakeSw {
  const fake: FakeSw = {
    register: vi.fn(() =>
      Promise.resolve({
        waiting: null,
        installing: null,
        addEventListener: vi.fn(),
        update: vi.fn(),
      }),
    ),
    addEventListener: vi.fn(),
    controller: null,
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: fake,
    configurable: true,
  });
  return fake;
}

function setReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', { value, configurable: true });
}

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

describe('registerServiceWorker', () => {
  let fake: FakeSw;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="swOffline" hidden></div>
      <div id="swUpdate" hidden><button id="swUpdateGo"></button><button id="swUpdateLater"></button></div>`;
    resetServiceWorkerForTest();
    fake = installFakeServiceWorker();
    setSecureContext(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers immediately when the page has already loaded', () => {
    // **The regression test.** `boot()` is async and finishes long after
    // `load`; a listener added at that point never fires.
    setReadyState('complete');

    registerServiceWorker();

    expect(fake.register, 'the worker was never registered').toHaveBeenCalledTimes(1);
    expect(swState()).not.toBe('unsupported');
  });

  it('waits for load when the page is still loading', () => {
    setReadyState('loading');

    registerServiceWorker();
    expect(fake.register).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('load'));
    expect(fake.register).toHaveBeenCalledTimes(1);
  });

  it('registers once even if load fires again', () => {
    setReadyState('loading');
    registerServiceWorker();

    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('load'));

    expect(fake.register).toHaveBeenCalledTimes(1);
  });

  it('registers relative to the document base, not the origin root', async () => {
    setReadyState('complete');
    registerServiceWorker();

    const url = fake.register.mock.calls[0][0] as URL;
    // Deployed under kanbanstudios.ae/game/ the worker must be /game/sw.js,
    // and its scope must not claim the whole origin.
    expect(url.pathname.endsWith('sw.js')).toBe(true);
    expect(fake.register.mock.calls[0][1]).toEqual({ scope: './' });
  });

  it('does nothing outside a secure context, and says so rather than erroring', () => {
    // A plain-HTTP staging host is an ordinary way to run this game. The
    // absence of a worker there is a normal state, not a failure.
    setSecureContext(false);
    setReadyState('complete');

    registerServiceWorker();

    expect(fake.register).not.toHaveBeenCalled();
    expect(swState()).toBe('unsupported');
  });

  it('survives a browser with no service worker support at all', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    });
    setReadyState('complete');

    expect(() => registerServiceWorker()).not.toThrow();
    expect(swState()).toBe('unsupported');
  });

  it('reflects the network state on the offline bar without waiting for an event', () => {
    setReadyState('complete');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    registerServiceWorker();

    // Opening the game already offline must show the bar; a listener alone
    // would leave it hidden until connectivity *changed*.
    expect(document.getElementById('swOffline')!.hidden).toBe(false);
  });
});

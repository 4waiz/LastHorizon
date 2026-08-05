/**
 * Explicit disposal ownership.
 *
 * Streaming makes leaks structural rather than incidental: every chunk that
 * loads must be able to give back exactly what it took. Three.js will not do
 * this for you — removing an object from the scene frees nothing, and a
 * geometry, texture or render target stays on the GPU until `.dispose()` is
 * called on it specifically.
 *
 * A registry makes ownership a recorded fact instead of a convention. Each
 * scope registers what it created; disposing the scope releases exactly that,
 * once, in reverse order, and reports anything that threw rather than
 * swallowing it.
 *
 * Deliberately structural — it accepts anything with `dispose()`, plus plain
 * teardown closures for the things that have no such method (event listeners,
 * audio nodes, timers, subscriptions).
 */

export interface Disposable {
  dispose(): void;
}

export type Teardown = () => void;

export type ResourceKind =
  | 'geometry'
  | 'material'
  | 'texture'
  | 'renderTarget'
  | 'audio'
  | 'physics'
  | 'navmesh'
  | 'subscription'
  | 'other';

interface Entry {
  readonly kind: ResourceKind;
  readonly label: string;
  readonly release: Teardown;
}

export interface DisposalReport {
  readonly scope: string;
  readonly released: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly errors: readonly { label: string; error: string }[];
}

export class DisposalRegistry {
  private entries: Entry[] = [];
  private disposed = false;
  private readonly children: DisposalRegistry[] = [];

  constructor(readonly scope: string) {}

  get size(): number {
    return this.entries.length + this.children.reduce((n, c) => n + c.size, 0);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** A nested scope, released when this one is. Used per chunk within a zone. */
  child(scope: string): DisposalRegistry {
    const c = new DisposalRegistry(`${this.scope}/${scope}`);
    this.children.push(c);
    return c;
  }

  /** Register anything exposing `dispose()`. Returns the resource unchanged. */
  add<T extends Disposable>(resource: T, kind: ResourceKind = 'other', label?: string): T {
    this.track(kind, label ?? resource.constructor.name, () => resource.dispose());
    return resource;
  }

  /** Register a teardown closure for something without a `dispose()`. */
  addTeardown(release: Teardown, kind: ResourceKind = 'subscription', label = 'teardown'): void {
    this.track(kind, label, release);
  }

  /** Convenience for the most common leak: a listener nobody removes. */
  addListener(
    target: { addEventListener(t: string, h: EventListener): void; removeEventListener(t: string, h: EventListener): void },
    type: string,
    handler: EventListener,
    label?: string,
  ): void {
    target.addEventListener(type, handler);
    this.track('subscription', label ?? `listener:${type}`, () =>
      target.removeEventListener(type, handler),
    );
  }

  private track(kind: ResourceKind, label: string, release: Teardown): void {
    if (this.disposed) {
      // Registering into a dead scope means the resource would never be
      // released. Fail loudly rather than leak quietly.
      throw new Error(`DisposalRegistry "${this.scope}" is already disposed; cannot register ${label}`);
    }
    this.entries.push({ kind, label, release });
  }

  /**
   * Release everything, children first, in reverse registration order so
   * dependants go before their dependencies. Idempotent: a second call is a
   * no-op, not a double free.
   */
  dispose(): DisposalReport {
    const byKind: Record<string, number> = {};
    const errors: { label: string; error: string }[] = [];
    let released = 0;

    if (this.disposed) {
      return { scope: this.scope, released: 0, byKind, errors };
    }
    this.disposed = true;

    for (const child of this.children.splice(0).reverse()) {
      const r = child.dispose();
      released += r.released;
      for (const [k, n] of Object.entries(r.byKind)) byKind[k] = (byKind[k] ?? 0) + n;
      errors.push(...r.errors);
    }

    for (const entry of this.entries.splice(0).reverse()) {
      try {
        entry.release();
        released++;
        byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
      } catch (err) {
        // One bad teardown must not strand the rest.
        errors.push({ label: entry.label, error: String(err) });
      }
    }

    return { scope: this.scope, released, byKind, errors };
  }
}

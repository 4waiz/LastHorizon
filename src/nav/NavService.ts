import type { AgentHandle, Navigation, NavStats } from './Navigation';
import type { NavBuildInput, OffMeshLink, Vec3Like } from './NavTypes';

/**
 * The population's handle on navigation, and the only thing that knows
 * navigation might not be there.
 *
 * Three states matter and all three are ordinary: not started, building, and
 * either ready or failed. The rest of the NPC system asks `ready` and takes the
 * coarse path when the answer is no, so a browser that cannot compile the
 * WebAssembly gets a village where people still keep to their schedules and
 * still walk between places — just without avoidance or exact doorways.
 *
 * Small on purpose. This file is in the app chunk; `Navigation.ts` and the
 * ~900 kB of WASM behind it are not.
 */

export type NavState = 'idle' | 'building' | 'ready' | 'failed';

export class NavService {
  private nav: Navigation | null = null;
  private building: Promise<Navigation | null> | null = null;
  private state: NavState = 'idle';
  private failure: string | null = null;

  get status(): NavState {
    return this.state;
  }

  get ready(): boolean {
    return this.state === 'ready' && this.nav !== null;
  }

  get error(): string | null {
    return this.failure;
  }

  get stats(): NavStats | null {
    return this.nav?.stats ?? null;
  }

  /**
   * Build the navmesh for a zone, once.
   *
   * Concurrent callers share the in-flight promise rather than each pulling the
   * module down — the same shape `Game.ensurePhysics` uses for Rapier, and for
   * the same reason.
   */
  build(input: NavBuildInput, links: readonly OffMeshLink[], maxAgents: number): Promise<void> {
    if (this.state === 'ready' || this.state === 'building') {
      return this.building?.then(() => undefined) ?? Promise.resolve();
    }
    this.state = 'building';
    this.building = import('./Navigation')
      .then((m) => m.Navigation.create(input, links, maxAgents))
      .then((nav) => {
        this.nav = nav;
        this.state = nav ? 'ready' : 'failed';
        if (!nav) this.failure = 'tiled navmesh generation returned no mesh';
        return nav;
      })
      .catch((err: unknown) => {
        this.state = 'failed';
        this.failure = err instanceof Error ? err.message : String(err);
        console.warn(`[nav] unavailable, falling back to coarse movement: ${this.failure}`);
        return null;
      });
    return this.building.then(() => undefined);
  }

  /** Nearest navmesh point, or null — including when navigation never arrived. */
  sample(p: Vec3Like, halfExtents?: number): Vec3Like | null {
    return this.nav?.sample(p, halfExtents) ?? null;
  }

  /**
   * Corners from `from` to `to`.
   *
   * Falls back to the straight line rather than to nothing. A caller that gets
   * an empty array cannot tell "no route exists" from "navigation is not here",
   * and the second case should still let somebody walk to the shop.
   */
  path(from: Vec3Like, to: Vec3Like): Vec3Like[] {
    const found = this.nav?.path(from, to);
    return found && found.length > 0 ? found : [from, to];
  }

  addAgent(at: Vec3Like, opts?: { radius?: number; maxSpeed?: number }): AgentHandle | null {
    return this.nav?.addAgent(at, opts) ?? null;
  }

  removeAgent(handle: AgentHandle): void {
    this.nav?.removeAgent(handle);
  }

  update(dt: number): void {
    this.nav?.update(dt);
  }

  dispose(): void {
    this.nav?.dispose();
    this.nav = null;
    this.building = null;
    this.state = 'idle';
    this.failure = null;
  }
}

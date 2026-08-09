import { Crowd, NavMeshQuery, init as initRecast, type CrowdAgent, type NavMesh } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import {
  NAV_AGENT,
  NAV_CONFIG,
  type NavBuildInput,
  type OffMeshLink,
  type Vec3Like,
} from './NavTypes';

/**
 * The recast-navigation half of pedestrian movement.
 *
 * This module is **only ever reached through the dynamic import in
 * `NavService`**. `recast-navigation` inlines ~900 kB of WebAssembly, which is
 * more headroom than the initial-load budget has, and the game is playable
 * before anybody is walking around in it.
 *
 * Everything Detour allocates lives in WASM memory and is not reachable by the
 * JavaScript garbage collector, so every handle created here is tracked and
 * destroyed in `dispose`. A leaked `NavMesh` after twenty zone transitions is
 * how a browser tab runs out of memory without the JS heap ever growing.
 */

export interface AgentHandle {
  readonly id: number;
  /** Where the agent actually is, after avoidance. */
  readonly position: Vec3Like;
  readonly velocity: Vec3Like;
  /** True while traversing an off-mesh link — a door, a crossing, a stair. */
  readonly onLink: boolean;
  setTarget(p: Vec3Like): void;
  teleport(p: Vec3Like): void;
  setMaxSpeed(v: number): void;
}

export interface NavStats {
  /** Milliseconds the tiled generation took. */
  buildMs: number;
  triangles: number;
  offMeshLinks: number;
  agents: number;
}

/** Detour's agent states. 2 is DT_CROWDAGENT_STATE_OFFMESH. */
const STATE_OFFMESH = 2;

class Agent implements AgentHandle {
  constructor(
    readonly id: number,
    private readonly agent: CrowdAgent,
  ) {}

  get position(): Vec3Like {
    return this.agent.position();
  }

  get velocity(): Vec3Like {
    return this.agent.velocity();
  }

  get onLink(): boolean {
    return this.agent.state() === STATE_OFFMESH;
  }

  setTarget(p: Vec3Like): void {
    this.agent.requestMoveTarget(p);
  }

  teleport(p: Vec3Like): void {
    this.agent.teleport(p);
  }

  setMaxSpeed(v: number): void {
    this.agent.updateParameters({ maxSpeed: v });
  }
}

export class Navigation {
  private query: NavMeshQuery;
  private crowd: Crowd;
  private readonly agents = new Map<number, { agent: CrowdAgent; wrapper: Agent }>();
  private nextAgentId = 1;
  private disposed = false;

  private constructor(
    private navMesh: NavMesh,
    readonly stats: NavStats,
    maxAgents: number,
  ) {
    this.query = new NavMeshQuery(navMesh);
    this.crowd = new Crowd(navMesh, {
      maxAgents,
      // Detour sizes its internal grids off this, so it must be the largest
      // radius any agent will ever have, not the typical one.
      maxAgentRadius: NAV_AGENT.radius * 1.5,
    });
  }

  /**
   * Bring the WASM up and bake a tiled navmesh for one zone.
   *
   * Tiled rather than solo. Solo works at this scale too — the Phase 2 report
   * blamed the library and it was config — but tiles are what let a district
   * rebuild one part of itself later without re-rasterising the whole zone,
   * and they are what the off-mesh links attach to.
   *
   * Returns null rather than throwing when generation fails: a village with
   * nobody walking in it is a much better outcome than a village that will not
   * load, and the caller degrades to coarse movement.
   */
  static async create(
    input: NavBuildInput,
    links: readonly OffMeshLink[],
    maxAgents: number,
    now: () => number = () => performance.now(),
  ): Promise<Navigation | null> {
    await initRecast();

    const started = now();
    const result = generateTiledNavMesh(
      input.positions,
      input.indices,
      {
        ...NAV_CONFIG,
        bounds: [
          [input.bounds.minX, input.minY, input.bounds.minZ],
          [input.bounds.maxX, input.maxY, input.bounds.maxZ],
        ],
        offMeshConnections: links.map((l) => ({
          startPosition: l.start,
          endPosition: l.end,
          radius: l.radius,
          bidirectional: l.bidirectional,
        })),
      },
      false,
    );

    if (!result.success) {
      console.warn(`[nav] tiled generation failed: ${result.error}`);
      return null;
    }

    return new Navigation(
      result.navMesh,
      {
        buildMs: Math.round(now() - started),
        triangles: input.indices.length / 3,
        offMeshLinks: links.length,
        agents: 0,
      },
      maxAgents,
    );
  }

  get agentCount(): number {
    return this.agents.size;
  }

  /**
   * Nearest point on the navmesh, or null when nothing is within `halfExtents`.
   *
   * The null is load-bearing: it is how spawn safety is decided. A pedestrian
   * placed where this returns null is standing inside a wall or off the edge of
   * the world, and the caller must pick somewhere else.
   */
  sample(p: Vec3Like, halfExtents = 3): Vec3Like | null {
    if (this.disposed) return null;
    const found = this.query.findClosestPoint(p, {
      halfExtents: { x: halfExtents, y: halfExtents, z: halfExtents },
    });
    return found.success ? found.point : null;
  }

  /** Corner list from `from` to `to`, empty when no path exists. */
  path(from: Vec3Like, to: Vec3Like): Vec3Like[] {
    if (this.disposed) return [];
    const result = this.query.computePath(from, to);
    return result.success ? result.path : [];
  }

  addAgent(at: Vec3Like, opts: { radius?: number; maxSpeed?: number } = {}): AgentHandle | null {
    if (this.disposed) return null;
    const snapped = this.sample(at);
    if (!snapped) return null;

    const agent = this.crowd.addAgent(snapped, {
      radius: opts.radius ?? NAV_AGENT.radius,
      height: NAV_AGENT.height,
      maxAcceleration: NAV_AGENT.maxAcceleration,
      maxSpeed: opts.maxSpeed ?? NAV_AGENT.maxSpeed,
      collisionQueryRange: NAV_AGENT.collisionQueryRange,
      pathOptimizationRange: NAV_AGENT.pathOptimizationRange,
      separationWeight: NAV_AGENT.separationWeight,
    });

    const id = this.nextAgentId++;
    const wrapper = new Agent(id, agent);
    this.agents.set(id, { agent, wrapper });
    this.stats.agents = this.agents.size;
    return wrapper;
  }

  removeAgent(handle: AgentHandle): void {
    const entry = this.agents.get(handle.id);
    if (!entry) return;
    this.crowd.removeAgent(entry.agent);
    this.agents.delete(handle.id);
    this.stats.agents = this.agents.size;
  }

  /** One fixed crowd step. Called from the simulation clock, not from rAF. */
  update(dt: number): void {
    if (this.disposed || this.agents.size === 0) return;
    this.crowd.update(dt);
  }

  /**
   * Tear down every WASM allocation, in dependency order.
   *
   * Agents before the crowd, crowd and query before the navmesh. Detour will
   * happily let you destroy a navmesh a live crowd still points at, and the
   * result is a use-after-free inside WASM rather than an exception.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { agent } of this.agents.values()) this.crowd.removeAgent(agent);
    this.agents.clear();
    this.crowd.destroy();
    this.query.destroy();
    this.navMesh.destroy();
  }
}

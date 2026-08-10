import type { Vec3Like } from '../nav/NavTypes';

/**
 * The officers, as bodies in the world.
 *
 * Split out of `Game` because the app chunk went 2.7 kB over its limit when it
 * lived there, and because it is a better boundary anyway: `Game` owns the
 * frame loop and the player, and it has no business holding a list of
 * policemen. Everything here is reachable only once combat has loaded, so it
 * rides in the lazy chunk with the systems it serves.
 *
 * The one method worth reading is `sees`. It is the single place in the whole
 * game where an officer learns where the player is, and it applies the same
 * four gates every shopkeeper gets — range, indoors, occlusion against the
 * collision proxy, and nothing else. An officer facing a wall is as blind as
 * anybody else facing a wall.
 */

export interface CorpsHost {
  /** Ground height, so an officer walks over terrain rather than through it. */
  heightAt(x: number, z: number): number;
  /** Is anything solid between these two points? */
  occluded(from: Vec3Like, to: Vec3Like): boolean;
  /** Eye-height position of the player. */
  playerEye(): Vec3Like;
  /** True while the player is inside a building, where officers cannot see in. */
  readonly playerIndoors: boolean;
}

interface Officer {
  at: { x: number; y: number; z: number };
  goal: Vec3Like | null;
  speed: number;
}

/** How far an officer can see. Matches `DEFAULT_SENSES.sightRange`. */
export const OFFICER_SIGHT = 26;
/** Most officers that may exist at once. The top Heat tier sits on this. */
export const MAX_OFFICERS = 5;

export class OfficerCorps {
  private readonly officers = new Map<string, Officer>();
  private serial = 1;

  constructor(private readonly host: CorpsHost) {}

  get size(): number {
    return this.officers.size;
  }

  get ids(): readonly string[] {
    return [...this.officers.keys()];
  }

  positions(): Vec3Like[] {
    return [...this.officers.values()].map((o) => ({ ...o.at }));
  }

  positionOf(id: string): Vec3Like {
    return this.officers.get(id)?.at ?? { x: 0, y: 0, z: 0 };
  }

  goalOf(id: string): Vec3Like | null {
    return this.officers.get(id)?.goal ?? null;
  }

  /**
   * Put an officer into the world near a point.
   *
   * `near` is always the police *belief*, never the player — the director
   * enforces that, and this could not do otherwise if it wanted to, because
   * the player's position is not a parameter. Placed on a ring at eighteen
   * metres so they walk in rather than appear on the spot.
   */
  spawn(near: Vec3Like): string | null {
    if (this.officers.size >= MAX_OFFICERS) return null;
    const id = `officer_${this.serial++}`;
    const angle = this.serial * 2.4;
    const x = near.x + Math.cos(angle) * 18;
    const z = near.z + Math.sin(angle) * 18;
    this.officers.set(id, {
      at: { x, y: this.host.heightAt(x, z), z },
      goal: null,
      speed: 3,
    });
    return id;
  }

  despawn(id: string): void {
    this.officers.delete(id);
  }

  clear(): void {
    this.officers.clear();
  }

  moveTo(id: string, to: Vec3Like, speed: number): void {
    const o = this.officers.get(id);
    if (!o) return;
    o.goal = { ...to };
    o.speed = speed;
  }

  halt(id: string): void {
    const o = this.officers.get(id);
    if (o) o.goal = null;
  }

  /**
   * Can this officer perceive the player right now?
   *
   * Returns null for anything that is not a clear line of sight inside range.
   * Nothing else in the game may answer this question, which is what makes
   * acceptance criterion 2 a property of one method rather than a promise
   * about a whole system.
   */
  sees(id: string): { at: Vec3Like; distance: number } | null {
    const o = this.officers.get(id);
    if (!o) return null;
    if (this.host.playerIndoors) return null;

    const p = this.host.playerEye();
    const dx = p.x - o.at.x;
    const dy = p.y - o.at.y;
    const dz = p.z - o.at.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > OFFICER_SIGHT) return null;

    const eye = { x: o.at.x, y: o.at.y + 1.6, z: o.at.z };
    if (this.host.occluded(eye, p)) return null;

    return { at: { ...p }, distance };
  }

  /**
   * Walk everybody toward their goal.
   *
   * A straight walk with a ground snap, not a navmesh path: the navmesh
   * belongs to `Population` and an officer is not one of its agents. That is
   * honestly the weakest part of this phase — an officer will walk into a
   * fence — and it is recorded as such in the Phase 9 report rather than
   * dressed up. It is enough for a pursuit across open village streets.
   */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const o of this.officers.values()) {
      if (!o.goal) continue;
      const dx = o.goal.x - o.at.x;
      const dz = o.goal.z - o.at.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) continue;
      const step = Math.min(d, o.speed * dt);
      o.at.x += (dx / d) * step;
      o.at.z += (dz / d) * step;
      o.at.y = this.host.heightAt(o.at.x, o.at.z);
    }
  }
}

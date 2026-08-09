import * as THREE from 'three';
import { buildInterior, interiorOrigin, type BuiltInterior } from './InteriorBuilder';
import { formatHour, isOpenAt, type InteriorDef } from './InteriorDefinition';
import { INTERIORS, interiorDef } from './interiorCatalog';
import type { KitPart } from './InteriorKit';

/**
 * Which door leads where, what is open, and how to get back out.
 *
 * This replaces the one-room-for-all-doors shortcut. Three things it is
 * deliberately strict about, because each was a way the old code could have
 * gone wrong once there was more than one room:
 *
 * 1. **One interior is open at a time.** `open()` refuses while another is
 *    live rather than silently stacking, so there is no path that leaves two
 *    rooms resident or two sets of colliders in the overlay.
 * 2. **The return context is a single value, not a stack.** You cannot be
 *    inside two buildings, so a stack would only ever be a way to come out of
 *    the wrong one.
 * 3. **The return context is captured before anything moves.** Reading the
 *    player's position after the fade has begun is how you end up back at the
 *    door you were walking toward rather than the one you opened.
 *
 * The registry owns no Three.js state of its own beyond the built room; the
 * fade, the teleport and the camera are `Game`'s.
 */

/** A door on the outside of a building, and the room behind it. */
export interface DoorLink {
  /** Stable across a zone build. Saves record this, not a position. */
  readonly id: string;
  readonly zone: string;
  readonly interiorId: string;
  readonly position: THREE.Vector3;
  /** Shown on the prompt outside. */
  readonly label: string;
}

/**
 * Exactly where the player was standing when they opened the door.
 *
 * Plain numbers, not a Vector3: this goes into a save, and rule 1 of the save
 * format is that nothing engine-owned is serialised.
 */
export interface ReturnContext {
  readonly doorId: string;
  readonly zone: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
}

export type OpenRefusal =
  | { readonly ok: false; readonly reason: 'unknown-door' | 'already-open' | 'no-kit' }
  | { readonly ok: false; readonly reason: 'closed'; readonly opensAt: string; readonly name: string };

export type OpenResult = { readonly ok: true; readonly interior: BuiltInterior } | OpenRefusal;

export interface OpenRequest {
  readonly doorId: string;
  /** World clock hour, 0..24. Decides the closed state. */
  readonly hour: number;
  /** Where the player is standing right now, captured before the fade. */
  readonly from: { x: number; y: number; z: number; facing: number };
  /** Decorations the player has placed, by slot id. */
  readonly decor?: ReadonlyMap<string, KitPart>;
}

export class InteriorRegistry {
  private readonly links = new Map<string, DoorLink>();
  private readonly defs = new Map<string, InteriorDef>();

  private kit: ReadonlyMap<string, THREE.Object3D> | null = null;
  private built: BuiltInterior | null = null;
  private returnCtx: ReturnContext | null = null;

  /** Set by Game so the hero interiors' panes can show the live world. */
  portalMaterial: THREE.Material | undefined;

  constructor(defs: readonly InteriorDef[] = INTERIORS) {
    for (const d of defs) this.defs.set(d.id, d);
  }

  /** Hand over the lazily-fetched kit. Until then `open()` refuses. */
  setKit(kit: ReadonlyMap<string, THREE.Object3D>): void {
    this.kit = kit;
  }

  get hasKit(): boolean {
    return this.kit !== null && this.kit.size > 0;
  }

  get active(): BuiltInterior | null {
    return this.built;
  }

  get isOpen(): boolean {
    return this.built !== null;
  }

  /** Where to put the player when they step back outside. */
  get returnContext(): ReturnContext | null {
    return this.returnCtx;
  }

  linkDoor(link: DoorLink): void {
    this.links.set(link.id, link);
  }

  /** Drop every link for a zone. Called when a zone is torn down. */
  clearZone(zone: string): void {
    for (const [id, link] of this.links) if (link.zone === zone) this.links.delete(id);
  }

  door(id: string): DoorLink | null {
    return this.links.get(id) ?? null;
  }

  doorsInZone(zone: string): DoorLink[] {
    return [...this.links.values()].filter((l) => l.zone === zone);
  }

  definition(id: string): InteriorDef | null {
    return this.defs.get(id) ?? interiorDef(id);
  }

  /**
   * Is the building behind this door open at `hour`?
   *
   * Answering for a door rather than an interior means the caller never has to
   * resolve the link itself, which is where an "is it open" check drifts out
   * of step with the door it was supposed to be about.
   */
  isDoorOpen(doorId: string, hour: number): boolean {
    const link = this.links.get(doorId);
    if (!link) return false;
    const def = this.definition(link.interiorId);
    return def !== null && isOpenAt(def.hours, hour);
  }

  /**
   * Build the room behind a door and take custody of the way back.
   *
   * Returns a refusal rather than throwing: a closed shop and a kit that
   * failed to download are both ordinary states the prompt has to describe,
   * not exceptions.
   */
  open(req: OpenRequest): OpenResult {
    if (this.built) return { ok: false, reason: 'already-open' };

    const link = this.links.get(req.doorId);
    if (!link) return { ok: false, reason: 'unknown-door' };

    const def = this.definition(link.interiorId);
    if (!def) return { ok: false, reason: 'unknown-door' };

    if (!isOpenAt(def.hours, req.hour)) {
      return {
        ok: false,
        reason: 'closed',
        name: def.name,
        opensAt: def.hours ? formatHour(def.hours.open) : '',
      };
    }

    if (!this.kit || this.kit.size === 0) return { ok: false, reason: 'no-kit' };

    const index = [...this.defs.keys()].indexOf(def.id);
    this.built = buildInterior(def, {
      kit: this.kit,
      origin: interiorOrigin(index < 0 ? 0 : index),
      portalMaterial: this.portalMaterial,
      decor: req.decor,
    });

    // Captured from the argument, never re-read off the player: by the time
    // the fade finishes they are 600 m away and the position is worthless.
    this.returnCtx = {
      doorId: link.id,
      zone: link.zone,
      x: req.from.x,
      y: req.from.y,
      z: req.from.z,
      facing: req.from.facing,
    };

    return { ok: true, interior: this.built };
  }

  /**
   * Tear the room down and hand back where to stand.
   *
   * The context is returned *and* cleared in one step, so there is no window
   * in which a stale return point could be used a second time.
   */
  close(): ReturnContext | null {
    const ctx = this.returnCtx;
    this.built?.dispose();
    this.built = null;
    this.returnCtx = null;
    return ctx;
  }

  /**
   * Restore the fact of being indoors after a load.
   *
   * A save records the door and the return context; the room itself is rebuilt
   * from the catalogue, exactly like the world is rebuilt from the manifest.
   * Nothing about the room's contents is trusted from disk.
   */
  reopen(ctx: ReturnContext, hour: number, decor?: ReadonlyMap<string, KitPart>): OpenResult {
    if (this.built) this.close();
    const result = this.open({
      doorId: ctx.doorId,
      hour,
      from: { x: ctx.x, y: ctx.y, z: ctx.z, facing: ctx.facing },
      decor,
    });
    // A shop that has since closed must still give back a player who saved
    // inside it. Being *in* a building is not the same as entering one.
    if (!result.ok && result.reason === 'closed') {
      const link = this.links.get(ctx.doorId);
      const def = link ? this.definition(link.interiorId) : null;
      if (def && this.kit && this.kit.size > 0) {
        const index = [...this.defs.keys()].indexOf(def.id);
        this.built = buildInterior(def, {
          kit: this.kit,
          origin: interiorOrigin(index < 0 ? 0 : index),
          portalMaterial: this.portalMaterial,
          decor,
        });
        this.returnCtx = ctx;
        return { ok: true, interior: this.built };
      }
    }
    return result;
  }

  dispose(): void {
    this.built?.dispose();
    this.built = null;
    this.returnCtx = null;
    this.links.clear();
  }
}

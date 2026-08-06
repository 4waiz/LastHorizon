import * as THREE from 'three';
import gsap from 'gsap';
import { makeToon, toonFromImported } from '../graphics/ToonMaterial';
import { TAU } from '../utils/MathUtils';

/**
 * Five hidden keepsakes, their persistence, and their pickup presentation.
 *
 * `CollectibleStore` deliberately knows nothing about Three.js and takes its
 * storage by injection, so save/restore is unit tested without a browser.
 */

export interface CollectibleDef {
  id: string;
  /** Root object name inside collectibles.glb. */
  model: string;
  label: string;
  found: string;
  position: THREE.Vector3;
  scale: number;
  /** Bobs and spins in place unless pinned (e.g. hanging under a roof). */
  spin: boolean;
}

const STORAGE_KEY = 'lasthorizon.collected.v1';

export class CollectibleStore {
  private found = new Set<string>();

  constructor(
    private readonly ids: readonly string[],
    private readonly storage: Storage | null =
      typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    this.load();
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const id of parsed) {
        // Ignore ids from an older layout so the counter can never exceed max.
        if (typeof id === 'string' && this.ids.includes(id)) this.found.add(id);
      }
    } catch {
      /* corrupt or unavailable storage — start fresh */
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.found]));
    } catch {
      /* ignore */
    }
  }

  /** Found ids, sorted so a save is byte-stable between writes. */
  get foundIds(): string[] {
    return [...this.found].sort();
  }

  /** Replace the found set from a save. Unknown ids are dropped, not trusted. */
  restoreFound(ids: readonly string[]): void {
    this.found = new Set(ids.filter((id) => this.ids.includes(id)));
  }

  has(id: string): boolean {
    return this.found.has(id);
  }

  /** Returns true if this was a new discovery. */
  collect(id: string): boolean {
    if (!this.ids.includes(id) || this.found.has(id)) return false;
    this.found.add(id);
    this.save();
    return true;
  }

  get count(): number {
    return this.found.size;
  }

  get total(): number {
    return this.ids.length;
  }

  get complete(): boolean {
    return this.count >= this.total;
  }

  reset(): void {
    this.found.clear();
    this.save();
  }
}

interface LiveItem {
  def: CollectibleDef;
  pivot: THREE.Group;
  model: THREE.Object3D;
  halo: THREE.Mesh;
  bobPhase: number;
  collected: boolean;
}

export interface CollectibleEvents {
  onFound: (def: CollectibleDef, count: number, total: number) => void;
}

const PICKUP_RADIUS = 1.85;

export class Collectibles {
  readonly group = new THREE.Group();
  readonly store: CollectibleStore;
  private items: LiveItem[] = [];
  private elapsed = 0;

  constructor(
    defs: CollectibleDef[],
    prototypes: Map<string, THREE.Object3D>,
    private readonly events: CollectibleEvents,
    storage?: Storage | null,
  ) {
    this.group.name = 'Collectibles';
    this.store = new CollectibleStore(
      defs.map((d) => d.id),
      storage === undefined ? undefined : storage,
    );

    const haloGeo = new THREE.RingGeometry(0.42, 0.62, 24);
    haloGeo.rotateX(-Math.PI / 2);

    for (const def of defs) {
      const proto = prototypes.get(def.model);
      const pivot = new THREE.Group();
      pivot.name = `Collectible_${def.id}`;
      pivot.position.copy(def.position);

      const model = proto ? proto.clone(true) : new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        makeToon(0xe7c266),
      );
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          const m = mesh.material;
          mesh.material = Array.isArray(m)
            ? m.map((mm) => toonFromImported(mm, def.model))
            : toonFromImported(m as THREE.Material, def.model);
        }
      });
      model.scale.setScalar(def.scale);
      pivot.add(model);

      const halo = new THREE.Mesh(
        haloGeo,
        makeToon(0xffe9a8, { transparent: true, opacity: 0.34 }),
      );
      halo.position.y = -0.30;
      halo.renderOrder = 5;
      (halo.material as THREE.Material).depthWrite = false;
      pivot.add(halo);

      const item: LiveItem = {
        def,
        pivot,
        model,
        halo,
        bobPhase: Math.random() * TAU,
        collected: this.store.has(def.id),
      };
      if (item.collected) pivot.visible = false;
      this.items.push(item);
      this.group.add(pivot);
    }
  }

  get count(): number {
    return this.store.count;
  }

  get total(): number {
    return this.store.total;
  }

  /** Found ids, for the save. */
  get foundIds(): string[] {
    return this.store.foundIds;
  }

  /**
   * Apply a saved found-set: update the store, then hide the pickups that are
   * already collected. Without the second step a loaded save shows keepsakes
   * the player has already taken.
   */
  restoreFound(ids: readonly string[]): void {
    this.store.restoreFound(ids);
    for (const it of this.items) {
      it.collected = this.store.has(it.def.id);
      it.pivot.visible = !it.collected;
    }
  }

  /** Positions and found-state, for the radar. */
  get markers(): Array<{ x: number; z: number; found: boolean }> {
    return this.items.map((it) => ({
      x: it.def.position.x,
      z: it.def.position.z,
      found: it.collected,
    }));
  }

  /** Nearest un-found item, for the "something nearby" hint. */
  nearestDistance(p: THREE.Vector3): number {
    let best = Infinity;
    for (const it of this.items) {
      if (it.collected) continue;
      best = Math.min(best, it.pivot.position.distanceTo(p));
    }
    return best;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.elapsed += dt;
    for (const it of this.items) {
      if (it.collected) continue;
      const t = this.elapsed + it.bobPhase;
      it.model.position.y = Math.sin(t * 1.5) * 0.09;
      if (it.def.spin) it.model.rotation.y = t * 0.75;
      const pulse = 0.86 + Math.sin(t * 2.1) * 0.14;
      it.halo.scale.setScalar(pulse);
      (it.halo.material as THREE.Material).opacity = 0.20 + Math.sin(t * 2.1) * 0.10;

      if (it.pivot.position.distanceToSquared(playerPos) < PICKUP_RADIUS * PICKUP_RADIUS) {
        this.pick(it);
      }
    }
  }

  private pick(it: LiveItem): void {
    if (it.collected) return;
    it.collected = true;
    const isNew = this.store.collect(it.def.id);

    const tl = gsap.timeline({
      onComplete: () => {
        it.pivot.visible = false;
      },
    });
    tl.to(it.model.scale, {
      x: it.def.scale * 1.55,
      y: it.def.scale * 1.55,
      z: it.def.scale * 1.55,
      duration: 0.20,
      ease: 'back.out(3)',
    })
      .to(it.pivot.position, { y: it.pivot.position.y + 1.25, duration: 0.65, ease: 'power2.out' }, 0)
      .to(it.model.rotation, { y: it.model.rotation.y + Math.PI * 2.2, duration: 0.65 }, 0)
      .to(
        it.model.scale,
        { x: 0.001, y: 0.001, z: 0.001, duration: 0.32, ease: 'power2.in' },
        0.36,
      )
      .to(it.halo.scale, { x: 3.4, y: 3.4, z: 3.4, duration: 0.55, ease: 'power2.out' }, 0)
      .to(it.halo.material as THREE.Material, { opacity: 0, duration: 0.55 }, 0);

    if (isNew) this.events.onFound(it.def, this.store.count, this.store.total);
  }

  /** Put everything back — used by "reset progress" in the info panel. */
  restoreAll(): void {
    this.store.reset();
    for (const it of this.items) {
      gsap.killTweensOf([it.pivot.position, it.model.scale, it.model.rotation, it.halo.scale]);
      it.collected = false;
      it.pivot.visible = true;
      it.pivot.position.copy(it.def.position);
      it.model.scale.setScalar(it.def.scale);
      it.halo.scale.setScalar(1);
      (it.halo.material as THREE.Material).opacity = 0.3;
    }
  }

  dispose(): void {
    for (const it of this.items) {
      gsap.killTweensOf([it.pivot.position, it.model.scale, it.model.rotation, it.halo.scale]);
    }
    this.items = [];
  }
}

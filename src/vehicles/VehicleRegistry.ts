/**
 * Who owns what, where it was left, and how to get it back.
 *
 * Separate from `VehicleController` on purpose: a controller exists only while
 * its vehicle is loaded in the current zone, but ownership, damage and the
 * place a car was parked have to outlive that. A player who drives to the city
 * and walks home still owns the hatchback outside their house.
 *
 * Pure, and serialises straight into the save's `vehicles` array.
 */

/**
 * The registry deliberately does **not** import `VehicleDefinition`.
 *
 * Saves have to work for a player who never gets into a vehicle, so this must
 * be reachable from the startup bundle — and importing the definitions would
 * drag the whole 11.6 kB vehicle catalogue in with it, which put the app chunk
 * over budget. Instead the handful of rules it needs are injected once the
 * definitions have actually loaded.
 */
export interface VehicleRules {
  /** Null for anything that never burns fuel. */
  readonly fuelCapacity: number | null;
  readonly consumptionPerKm: number;
  readonly scratchSpeed: number;
  readonly dentSpeed: number;
  readonly repairCost: number;
  readonly impoundable: boolean;
}

export type RulesLookup = (kind: string) => VehicleRules | null;

type VehicleId = string;

export interface StoredTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
}

export interface VehicleRecord {
  readonly id: string;
  readonly kind: VehicleId;
  /** Zone it was last left in. */
  zone: string;
  transform: StoredTransform;
  owned: boolean;
  locked: boolean;
  /** 0..1. Cosmetic; see `conditionGripScale` for the only thing it affects. */
  condition: number;
  /** Litres. Null for anything that never burns fuel. */
  fuel: number | null;
  /** Taken away for being left somewhere it should not have been. */
  impounded: boolean;
}

/** Cost to release an impounded vehicle. */
export const IMPOUND_FEE = 150;

/** Where a recovered vehicle is put, per zone. */
export interface GarageSpot {
  readonly zone: string;
  readonly transform: StoredTransform;
}

export type RecoveryReason = 'flipped' | 'submerged' | 'outOfBounds' | 'lost' | 'impounded';

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export class VehicleRegistry {
  private readonly records = new Map<string, VehicleRecord>();
  private readonly garages = new Map<string, GarageSpot>();
  private rules: RulesLookup | null = null;

  /**
   * Hand over the rules once the definitions are loaded.
   *
   * Prunes anything whose kind the catalogue no longer knows — the same rule
   * the inventory follows. Deferred to here rather than done in `restore`
   * because a save can be applied before any vehicle has been spawned, and at
   * that point there is nothing to validate against.
   */
  setRules(lookup: RulesLookup): void {
    this.rules = lookup;
    for (const [id, record] of [...this.records]) {
      if (!lookup(record.kind)) this.records.delete(id);
    }
  }

  private rulesFor(kind: string): VehicleRules | null {
    return this.rules ? this.rules(kind) : null;
  }

  get size(): number {
    return this.records.size;
  }

  all(): VehicleRecord[] {
    return [...this.records.values()];
  }

  get(id: string): VehicleRecord | null {
    return this.records.get(id) ?? null;
  }

  /** Vehicles the player owns, wherever they are. */
  owned(): VehicleRecord[] {
    return this.all().filter((r) => r.owned);
  }

  /** Vehicles that should be present in a zone right now. */
  inZone(zone: string): VehicleRecord[] {
    return this.all().filter((r) => r.zone === zone && !r.impounded);
  }

  setGarage(zone: string, transform: StoredTransform): void {
    this.garages.set(zone, { zone, transform });
  }

  garageFor(zone: string): GarageSpot | null {
    return this.garages.get(zone) ?? null;
  }

  register(record: Omit<VehicleRecord, 'condition' | 'fuel'> & Partial<Pick<VehicleRecord, 'condition' | 'fuel'>>): VehicleRecord {
    const rules = this.rulesFor(record.kind);
    const full: VehicleRecord = {
      ...record,
      condition: clamp01(record.condition ?? 1),
      // A tank only exists if the rules say so, so a bicycle can never acquire
      // one by being registered with a number in the wrong field.
      fuel: rules?.fuelCapacity != null ? (record.fuel ?? rules.fuelCapacity) : null,
    };
    this.records.set(full.id, full);
    return full;
  }

  remove(id: string): void {
    this.records.delete(id);
  }

  /** Remember where a vehicle was left. */
  park(id: string, zone: string, transform: StoredTransform): void {
    const r = this.records.get(id);
    if (!r) return;
    r.zone = zone;
    r.transform = { ...transform };
  }

  setLocked(id: string, locked: boolean): void {
    const r = this.records.get(id);
    if (r) r.locked = locked;
  }

  setOwned(id: string, owned: boolean): void {
    const r = this.records.get(id);
    if (r) r.owned = owned;
  }

  // ------------------------------------------------------------------ damage

  /**
   * Apply a knock.
   *
   * Cosmetic by design: this only ever moves `condition`, and the worst it can
   * do to handling is the gentle grip scale in `VehicleDynamics`. There is no
   * deformation, and a wreck still drives home.
   */
  damage(id: string, impactSpeed: number): number {
    const r = this.records.get(id);
    if (!r) return 0;
    const rules = this.rulesFor(r.kind);
    if (!rules || !Number.isFinite(impactSpeed)) return r.condition;

    const speed = Math.abs(impactSpeed);
    if (speed < rules.scratchSpeed) return r.condition;

    // Scale between a scratch and a dent, so a hard hit costs more than a
    // graze but nothing takes a vehicle out in one impact.
    const span = Math.max(rules.dentSpeed - rules.scratchSpeed, 0.001);
    const severity = Math.min(1.5, (speed - rules.scratchSpeed) / span);
    r.condition = clamp01(r.condition - severity * 0.08);
    return r.condition;
  }

  repair(id: string): number {
    const r = this.records.get(id);
    if (!r) return 0;
    r.condition = 1;
    return r.condition;
  }

  repairCost(id: string): number {
    const r = this.records.get(id);
    const rules = r ? this.rulesFor(r.kind) : null;
    if (!r || !rules) return 0;
    return Math.round(rules.repairCost * (1 - r.condition));
  }

  // -------------------------------------------------------------------- fuel

  /**
   * Burn fuel over a distance.
   *
   * Optional and switchable: with `enabled` false nothing is consumed, which
   * is what "fuel as an optional soft system that can be disabled" means. A
   * vehicle with no tank is untouched either way.
   */
  consumeFuel(id: string, metres: number, enabled: boolean): number | null {
    const r = this.records.get(id);
    if (!r || r.fuel === null) return null;
    if (!enabled || !Number.isFinite(metres) || metres <= 0) return r.fuel;

    const rules = this.rulesFor(r.kind);
    if (!rules?.fuelCapacity) return r.fuel;

    r.fuel = Math.max(0, r.fuel - (metres / 1000) * rules.consumptionPerKm);
    return r.fuel;
  }

  refuel(id: string): number | null {
    const r = this.records.get(id);
    if (!r || r.fuel === null) return null;
    r.fuel = this.rulesFor(r.kind)?.fuelCapacity ?? r.fuel;
    return r.fuel;
  }

  /** True when an engine has run dry. Never true for a bicycle. */
  isOutOfFuel(id: string): boolean {
    const r = this.records.get(id);
    return r?.fuel !== null && r?.fuel !== undefined && r.fuel <= 0;
  }

  // ---------------------------------------------------------------- recovery

  impound(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    if (!this.rulesFor(r.kind)?.impoundable) return;
    r.impounded = true;
  }

  /**
   * Get a vehicle back.
   *
   * One path for every way a vehicle can become unreachable — flipped onto its
   * roof, in the sea, off the edge of the world, impounded, or simply lost
   * somewhere the player cannot remember. They all end the same way: it is put
   * in the garage, upright, and released.
   *
   * Returns null when there is nowhere to put it, which is a real answer: a
   * zone with no garage cannot recover anything.
   */
  recover(id: string, reason: RecoveryReason, toZone?: string): VehicleRecord | null {
    const r = this.records.get(id);
    if (!r) return null;

    const zone = toZone ?? r.zone;
    const garage = this.garages.get(zone) ?? this.garages.get(r.zone);
    if (!garage) return null;

    r.zone = garage.zone;
    r.transform = { ...garage.transform };
    r.impounded = false;

    // Recovering a wreck should not also fix it -- except from the pound,
    // which is the one that costs money and returns it in working order.
    if (reason === 'impounded') r.condition = Math.max(r.condition, 0.6);
    return r;
  }

  /** Does this vehicle need rescuing where it stands? */
  needsRecovery(
    id: string,
    state: { upright: boolean; y: number; inBounds: boolean },
    waterLevel: number,
  ): RecoveryReason | null {
    const r = this.records.get(id);
    if (!r) return null;
    if (r.impounded) return 'impounded';
    if (!state.inBounds) return 'outOfBounds';
    if (state.y < waterLevel) return 'submerged';
    if (!state.upright) return 'flipped';
    return null;
  }

  // ------------------------------------------------------------- persistence

  toJSON(): Array<{
    id: string; kind: string; zone: string;
    position: { x: number; y: number; z: number };
    facing: number; impounded: boolean;
    owned: boolean; locked: boolean; condition: number; fuel: number | null;
  }> {
    return this.all().map((r) => ({
      id: r.id,
      kind: r.kind,
      zone: r.zone,
      position: { x: r.transform.x, y: r.transform.y, z: r.transform.z },
      facing: r.transform.facing,
      impounded: r.impounded,
      owned: r.owned,
      locked: r.locked,
      condition: r.condition,
      fuel: r.fuel,
    }));
  }

  /**
   * Restore from a save.
   *
   * Kinds are *not* validated here: a save can be applied before any vehicle
   * has been spawned, so the catalogue may not be loaded yet and there would
   * be nothing to validate against. `setRules` prunes unknown kinds the moment
   * it does load, which is the same outcome one step later.
   */
  restore(data: ReadonlyArray<Record<string, unknown>>): void {
    this.records.clear();
    for (const raw of data) {
      const kind = raw.kind as VehicleId;
      if (typeof kind !== 'string') continue;
      const pos = (raw.position ?? {}) as { x?: number; y?: number; z?: number };
      const id = typeof raw.id === 'string' ? raw.id : null;
      if (!id) continue;

      this.register({
        id,
        kind,
        zone: typeof raw.zone === 'string' ? raw.zone : 'village_coast',
        transform: {
          x: Number(pos.x) || 0,
          y: Number(pos.y) || 0,
          z: Number(pos.z) || 0,
          facing: Number(raw.facing) || 0,
        },
        owned: raw.owned === true,
        locked: raw.locked === true,
        impounded: raw.impounded === true,
        condition: typeof raw.condition === 'number' ? raw.condition : 1,
        fuel: typeof raw.fuel === 'number' ? raw.fuel : undefined,
      });
    }
  }
}

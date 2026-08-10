import { ageAllows, type WeaponDef, type WeaponId } from './WeaponDefinition';
import { weaponDef } from './weaponCatalog';

/**
 * Carrying, drawing, reloading and pulling the trigger.
 *
 * **Reads no clock and touches no scene**, like `TaskSystem` and `QuestSystem`
 * before it. Seconds arrive through `advance(dt)`; age, ammunition and whether
 * the player is standing somewhere weapons are refused all arrive through the
 * host. So the whole matrix of empty magazines, interrupted reloads and adult
 * gates is testable in a millisecond without a browser.
 *
 * The one rule worth stating up front: **every refusal is named.** Nothing
 * here fails silently, because a trigger pull that does nothing and says
 * nothing is indistinguishable from a broken input, and the player has no way
 * to tell which they are looking at.
 */

export type WeaponStance = 'holstered' | 'drawn' | 'aiming';

export type WeaponRefusal =
  | 'too-young'
  | 'not-owned'
  | 'unknown-weapon'
  | 'safe-zone'
  | 'holstered'
  | 'reloading'
  | 'cooling'
  | 'empty'
  | 'magazine-full'
  | 'no-reserve';

export interface WeaponHost {
  readonly age: number;
  /**
   * Whether weapons are refused where the player is standing.
   *
   * A single boolean rather than a zone id: the *reason* belongs to whatever
   * decides it, and this only needs to know the answer.
   */
  readonly inSafeZone: boolean;
  /** Rounds of this ammunition the player is carrying, outside the magazine. */
  reserveOf(itemId: string): number;
  /** Remove up to `count`. Returns how many were actually taken. */
  takeAmmo(itemId: string, count: number): number;
  /** Put rounds back, for a magazine emptied by swapping weapons. */
  giveAmmo(itemId: string, count: number): void;
}

export type EquipResult =
  | { readonly ok: true; readonly def: WeaponDef }
  | { readonly ok: false; readonly reason: WeaponRefusal };

export interface Shot {
  /** Which projectile of the burst this is, 0-based. Shotguns fire eight. */
  readonly index: number;
  /** Cone half-angle this projectile was drawn from, in radians. */
  readonly spread: number;
}

export type FireResult =
  | {
      readonly ok: true;
      readonly def: WeaponDef;
      readonly shots: readonly Shot[];
      readonly roundsLeft: number;
      /** Recoil to add to the camera, in radians. */
      readonly recoilPitch: number;
      readonly recoilYaw: number;
    }
  | { readonly ok: false; readonly reason: WeaponRefusal };

export type ReloadResult =
  | { readonly ok: true; readonly seconds: number }
  | { readonly ok: false; readonly reason: WeaponRefusal };

export interface WeaponSaveData {
  /** Weapon id -> rounds currently in its magazine. Owning it is being here. */
  owned: Record<string, number>;
  equipped: WeaponId;
  stance: WeaponStance;
}

/**
 * A seeded generator, so a burst is reproducible.
 *
 * Spread has to be random or every shot lands in the same place; it also has
 * to be *deterministic* or no test can assert where a shotgun's eight pellets
 * went. Same trick `TrafficSystem` uses, and for the same reason.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WeaponSystem {
  /** Weapon id -> rounds in its magazine. Present means owned. */
  private readonly owned = new Map<WeaponId, number>([['unarmed', 0]]);
  private equippedId: WeaponId = 'unarmed';
  private stanceValue: WeaponStance = 'holstered';

  private cooldown = 0;
  private reloadLeft = 0;
  private bloomValue = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;

  private rng = mulberry32(0x9e3779b9);
  /** Rolling counts, for the debug overlay and for tests. */
  shotsFired = 0;
  reloadsInterrupted = 0;

  constructor(private readonly host: WeaponHost) {}

  // -- reading -------------------------------------------------------------

  get equipped(): WeaponDef {
    return weaponDef(this.equippedId)!;
  }

  get stance(): WeaponStance {
    return this.stanceValue;
  }

  get aiming(): boolean {
    return this.stanceValue === 'aiming';
  }

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  get reloadRemaining(): number {
    return this.reloadLeft;
  }

  /** Rounds in the equipped magazine. */
  get rounds(): number {
    return this.owned.get(this.equippedId) ?? 0;
  }

  get reserve(): number {
    const ammo = this.equipped.ammoItemId;
    return ammo ? this.host.reserveOf(ammo) : 0;
  }

  /** Current cone half-angle, including bloom. What the reticle draws. */
  get spread(): number {
    const def = this.equipped;
    const base = this.aiming ? def.aimSpread : def.baseSpread;
    return base + this.bloomValue;
  }

  get bloom(): number {
    return this.bloomValue;
  }

  owns(id: WeaponId): boolean {
    return this.owned.has(id);
  }

  get ownedIds(): readonly WeaponId[] {
    return [...this.owned.keys()];
  }

  /** Movement multiplier the controller should apply right now. */
  get moveScale(): number {
    return this.aiming ? this.equipped.moveScale : 1;
  }

  /**
   * Is this drawn, visible and a firearm?
   *
   * What the crime layer asks before deciding whether being here is an
   * offence, and what an NPC's `weapon_display` perception keys on.
   */
  get brandishing(): boolean {
    return this.stanceValue !== 'holstered' && this.equipped.conspicuous;
  }

  // -- owning --------------------------------------------------------------

  /**
   * Pick one up or buy one.
   *
   * Refused below the age gate even into storage: a fifteen-year-old cannot
   * *hold* a pistol in this game, not merely fail to fire one. That is the
   * strictest reading of acceptance criterion 1 and the only one that cannot
   * be got around by a save edit and a reload.
   */
  acquire(id: WeaponId, rounds = 0): EquipResult {
    const def = weaponDef(id);
    if (!def) return { ok: false, reason: 'unknown-weapon' };
    if (!ageAllows(def, this.host.age)) return { ok: false, reason: 'too-young' };

    const have = this.owned.get(id) ?? 0;
    this.owned.set(id, Math.min(def.magazine, Math.max(have, rounds)));
    return { ok: true, def };
  }

  // -- equipping -----------------------------------------------------------

  equip(id: WeaponId): EquipResult {
    const def = weaponDef(id);
    if (!def) return { ok: false, reason: 'unknown-weapon' };
    if (!this.owned.has(id)) return { ok: false, reason: 'not-owned' };
    if (!ageAllows(def, this.host.age)) return { ok: false, reason: 'too-young' };
    if (def.conspicuous && this.host.inSafeZone) return { ok: false, reason: 'safe-zone' };

    if (id !== this.equippedId) {
      // Swapping cancels a reload rather than carrying it across. The rounds
      // already in the magazine stay there; only the part-done reload is lost.
      this.cancelReload();
      this.equippedId = id;
      this.bloomValue = 0;
      this.cooldown = 0;
    }
    this.stanceValue = def.weaponClass === 'unarmed' ? 'drawn' : 'drawn';
    return { ok: true, def };
  }

  holster(): void {
    this.cancelReload();
    this.stanceValue = 'holstered';
    this.bloomValue = 0;
  }

  /**
   * Aim, or stop aiming.
   *
   * Refused while holstered — there is nothing to aim — and silently ignored
   * for unarmed, where aiming has no meaning and a stance nobody can see would
   * only confuse the movement penalty.
   */
  setAiming(on: boolean): boolean {
    if (this.stanceValue === 'holstered') return false;
    if (!this.equipped.conspicuous) return false;
    this.stanceValue = on ? 'aiming' : 'drawn';
    return true;
  }

  /** Weapons are put away the moment the player walks into a safe zone. */
  enforceSafeZone(): boolean {
    if (!this.host.inSafeZone) return false;
    if (!this.equipped.conspicuous || this.stanceValue === 'holstered') return false;
    this.holster();
    return true;
  }

  // -- the frame -----------------------------------------------------------

  /**
   * Advance cooldown, reload, bloom and recoil.
   *
   * A reload that finishes here does the transfer immediately, so there is no
   * frame where the magazine is full but the animation says otherwise.
   */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.reloadLeft > 0) {
      this.reloadLeft = Math.max(0, this.reloadLeft - dt);
      if (this.reloadLeft === 0) this.finishReload();
    }

    const def = this.equipped;
    if (this.bloomValue > 0) {
      // Exponential, matching `bloomDecay`'s documented "fraction shed per
      // second" and the recoil recovery below. The first draft subtracted
      // `bloomDecay * dt` in radians, and with a decay of 0.9 that is 0.9
      // radians a second against a bloom of 0.012 a shot -- so bloom was wiped
      // between every pair of shots and sustained fire cost nothing at all.
      // A test that fired four rounds and expected a wider cone caught it.
      this.bloomValue *= Math.max(0, 1 - def.bloomDecay * dt);
    }
    const recover = Math.max(0, 1 - def.recoil.recover * dt);
    this.recoilPitch *= recover;
    this.recoilYaw *= recover;
  }

  // -- firing --------------------------------------------------------------

  /**
   * Pull the trigger.
   *
   * Returns the projectiles rather than resolving them: *where* they go is
   * `Ballistics`' job and *what they hit* is the caller's, which keeps this
   * class free of the scene entirely.
   */
  tryFire(): FireResult {
    if (this.stanceValue === 'holstered') return { ok: false, reason: 'holstered' };
    if (this.reloadLeft > 0) return { ok: false, reason: 'reloading' };
    if (this.cooldown > 0) return { ok: false, reason: 'cooling' };

    const def = this.equipped;
    if (this.host.inSafeZone && def.conspicuous) return { ok: false, reason: 'safe-zone' };
    if (!ageAllows(def, this.host.age)) return { ok: false, reason: 'too-young' };

    const rounds = this.rounds;
    if (def.magazine > 0 && rounds <= 0) {
      // An empty click, not a silent nothing. The caller plays the sound.
      this.cooldown = def.fireInterval;
      return { ok: false, reason: 'empty' };
    }

    const spread = this.spread;
    const shots: Shot[] = [];
    for (let i = 0; i < def.pellets; i++) shots.push({ index: i, spread });

    if (def.magazine > 0) this.owned.set(this.equippedId, rounds - 1);
    this.cooldown = def.fireInterval;
    this.bloomValue += def.bloomPerShot;
    this.shotsFired++;

    const kickPitch = def.recoil.pitch;
    const kickYaw = def.recoil.yaw * (this.rng() * 2 - 1);
    this.recoilPitch += kickPitch;
    this.recoilYaw += kickYaw;

    return {
      ok: true,
      def,
      shots,
      roundsLeft: def.magazine > 0 ? rounds - 1 : 0,
      recoilPitch: kickPitch,
      recoilYaw: kickYaw,
    };
  }

  // -- reloading -----------------------------------------------------------

  reload(): ReloadResult {
    const def = this.equipped;
    if (def.magazine === 0 || !def.ammoItemId) return { ok: false, reason: 'magazine-full' };
    if (this.stanceValue === 'holstered') return { ok: false, reason: 'holstered' };
    if (this.reloadLeft > 0) return { ok: false, reason: 'reloading' };
    if (this.rounds >= def.magazine) return { ok: false, reason: 'magazine-full' };
    if (this.host.reserveOf(def.ammoItemId) <= 0) return { ok: false, reason: 'no-reserve' };

    this.reloadLeft = def.reloadSeconds;
    return { ok: true, seconds: def.reloadSeconds };
  }

  /**
   * Stop reloading without transferring anything.
   *
   * The interruption case the brief asks for, and the reason it is a separate
   * method rather than a flag: **rounds move at the *end* of a reload, never
   * during it.** So being interrupted costs the time and nothing else, and
   * there is no partial state that could double-count a magazine.
   */
  cancelReload(): boolean {
    if (this.reloadLeft <= 0) return false;
    this.reloadLeft = 0;
    this.reloadsInterrupted++;
    return true;
  }

  private finishReload(): void {
    const def = this.equipped;
    if (!def.ammoItemId) return;
    const want = def.magazine - this.rounds;
    if (want <= 0) return;
    const got = this.host.takeAmmo(def.ammoItemId, want);
    if (got > 0) this.owned.set(this.equippedId, this.rounds + got);
  }

  // -- persistence ---------------------------------------------------------

  toJSON(): WeaponSaveData {
    return {
      owned: Object.fromEntries([...this.owned].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
      equipped: this.equippedId,
      stance: this.stanceValue,
    };
  }

  /**
   * Restore, defensively, and **re-apply the age gate on the way in**.
   *
   * A save that claims a fifteen-year-old owns a carbine is either an edited
   * file or a bug in an older build, and honouring it would let acceptance
   * criterion 1 be bypassed by a reload. Unknown weapons are dropped for the
   * same reason the save layer drops unknown zone ids.
   */
  restore(data: Partial<WeaponSaveData> | undefined): void {
    this.owned.clear();
    this.owned.set('unarmed', 0);

    for (const [id, rounds] of Object.entries(data?.owned ?? {})) {
      const def = weaponDef(id);
      if (!def) continue;
      if (!ageAllows(def, this.host.age)) continue;
      const n = typeof rounds === 'number' && Number.isFinite(rounds) ? rounds : 0;
      this.owned.set(def.id, Math.max(0, Math.min(def.magazine, Math.floor(n))));
    }

    const wanted = data?.equipped ? weaponDef(data.equipped) : null;
    this.equippedId = wanted && this.owned.has(wanted.id) ? wanted.id : 'unarmed';

    // Always come back with it put away. A save reloaded into a drawn weapon
    // is a save that can be reloaded into a crime.
    this.stanceValue = 'holstered';
    this.reloadLeft = 0;
    this.cooldown = 0;
    this.bloomValue = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
  }

  /** Back to hands and nothing else. For a new run in the same session. */
  reset(): void {
    this.restore(undefined);
    this.shotsFired = 0;
    this.reloadsInterrupted = 0;
  }

  /** Fix the spread sequence, so a test can assert where pellets went. */
  seed(value: number): void {
    this.rng = mulberry32(value);
  }
}

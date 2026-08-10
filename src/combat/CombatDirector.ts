import { WeaponSystem, type WeaponHost, type WeaponRefusal } from './WeaponSystem';
import { impactAt, type WeaponId } from './WeaponDefinition';
import { weaponDef } from './weaponCatalog';
import { assistDirection, coneDirection, traceShot, type ShotTarget } from './Ballistics';
import { HeatSystem } from '../crime/Heat';
import { crimeDef, type CrimeId } from '../crime/CrimeDefinition';
import {
  PoliceSystem,
  tierFor,
  type PoliceLine,
  type PoliceWorld,
} from '../crime/PoliceSystem';
import type { CombatState } from './CombatState';
import type { Vec3Like } from '../nav/NavTypes';

/**
 * Weapons, crimes and the police, driven from the game.
 *
 * `Game` holds a handle to this and calls five methods: `update`, `fire`,
 * `commitCrime`, `equip` and `settleAtDesk`. Everything else — who witnessed
 * what, when a report lands, which officers exist, what an arrest costs —
 * happens in here.
 *
 * The same arrangement as `StoryDirector`, and for the same reason: it is the
 * only thing that mutates combat state, so there is one place to look when
 * somebody gets shot through a wall or a policeman appears from nowhere.
 */

/** Everything the director cannot know on its own. */
export interface CombatHost extends WeaponHost {
  // -- the player ----------------------------------------------------------
  playerEye(): Vec3Like;
  /** Unit vector the camera is looking down. */
  aimDirection(): Vec3Like;
  /** Camera right and up, for building the spread cone. */
  aimBasis(): { right: Vec3Like; up: Vec3Like };
  readonly playerDriving: boolean;

  // -- the world -----------------------------------------------------------
  /** Everyone who could be hit. Children are excluded by the caller *and* here. */
  targets(): readonly ShotTarget[];
  /** Distance to the nearest static surface along a ray, or Infinity. */
  worldDistance(from: Vec3Like, direction: Vec3Like, max: number): number;
  /** Take composure off somebody. The host owns what that looks like. */
  applyImpact(targetId: string, amount: number, from: Vec3Like): void;
  /** Draw a puff where a projectile stopped. */
  spawnImpact(at: Vec3Like, struckWorld: boolean): void;
  /** Raise a perception event so witnesses can notice. */
  emitPerception(kind: string, at: Vec3Like, loudness: number): void;

  // -- police --------------------------------------------------------------
  /** The police half of `PoliceWorld`, supplied by the host. */
  readonly police: Omit<PoliceWorld, 'belief' | 'heat' | 'playerDriving'>;
  /** Ask the host to put an officer into the world. Returns its id, or null. */
  spawnOfficer(near: Vec3Like): string | null;
  despawnOfficer(id: string): void;
  /** Where officers currently are, for evidence discovery. */
  officerPositions(): readonly Vec3Like[];

  // -- presentation --------------------------------------------------------
  toast(title: string, body: string): void;
  /** The host does the arrest: fade, fine, move the player, advance time. */
  onArrest(officerId: string): void;
  onRefusal(reason: WeaponRefusal): void;
}

export interface CombatAccessibility {
  /** 0 disables it entirely. */
  aimAssist: number;
  cameraShake: number;
  /** Muzzle flashes and impact sparks. Off for photosensitivity. */
  flashes: boolean;
  /** Scales incoming composure loss. 1 is normal. */
  difficulty: number;
}

export const DEFAULT_ACCESSIBILITY: CombatAccessibility = {
  aimAssist: 0,
  cameraShake: 1,
  flashes: true,
  difficulty: 1,
};

/** How wide the aim assist may reach. Small on purpose — it nudges, not snaps. */
const ASSIST_CONE = 0.09;

export class CombatDirector {
  readonly weapons: WeaponSystem;
  readonly heat = new HeatSystem();
  readonly police = new PoliceSystem();

  private accessibility: CombatAccessibility = { ...DEFAULT_ACCESSIBILITY };
  /** Officer ids this director created, so it can retire its own. */
  private readonly spawned: string[] = [];
  private spawnCooldown = 0;
  /** Set while `brandishing` in a restricted place, so the crime fires once. */
  private displayReported = false;

  constructor(
    private readonly state: CombatState,
    private readonly host: CombatHost,
  ) {
    this.weapons = new WeaponSystem(host);
    this.restoreFromState();
  }

  configure(a: Partial<CombatAccessibility>): void {
    this.accessibility = { ...this.accessibility, ...a };
  }

  get options(): Readonly<CombatAccessibility> {
    return this.accessibility;
  }

  // -- persistence ---------------------------------------------------------

  private restoreFromState(): void {
    this.weapons.restore(this.state.weapons ?? undefined);
    this.heat.restore(this.state.heat ?? undefined);
    this.syncMirrors();
  }

  /** Called after a save is applied. */
  afterRestore(): void {
    this.restoreFromState();
    this.retireAll();
  }

  /** Push the live systems back into the save-facing state. */
  capture(): void {
    this.state.weapons = this.weapons.toJSON();
    this.state.heat = this.heat.toJSON();
  }

  private syncMirrors(): void {
    this.state.heatLevel = this.heat.level;
    this.state.finesOwed = this.heat.finesOwed;
    this.state.wanted = this.heat.wanted;
    this.state.brandishing = this.weapons.brandishing;
  }

  // -- the frame -----------------------------------------------------------

  update(dt: number): void {
    this.weapons.advance(dt);

    // A weapon put away the instant the player steps into a shop. The crime
    // for carrying it ends with it, which is why `weapon_display` is the one
    // offence with no evidence: stop doing it and it stops being true.
    if (this.weapons.enforceSafeZone()) {
      this.host.toast('Not in here', 'You put it away.');
      this.displayReported = false;
    }

    this.checkWeaponDisplay();
    this.heat.advance(dt, this.host.officerPositions());
    this.updatePolice(dt);
    this.syncMirrors();
  }

  /**
   * Carrying a firearm where it is not welcome.
   *
   * Fires once per draw rather than every frame — otherwise a player who walks
   * down a street with a pistol out commits sixty offences a second and the
   * duplicate rule in `HeatSystem` is the only thing between them and a
   * five-star manhunt.
   */
  private checkWeaponDisplay(): void {
    if (!this.weapons.brandishing) {
      this.displayReported = false;
      return;
    }
    if (this.displayReported) return;
    this.displayReported = true;
    this.commitCrime('weapon_display', this.host.playerEye());
  }

  private updatePolice(dt: number): void {
    const tier = tierFor(this.heat.heat);
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);

    // Retire down first, so a decaying Heat sheds officers before it adds any.
    while (this.spawned.length > tier.officers) {
      const id = this.spawned.pop()!;
      this.police.remove(id, this.policeWorld());
      this.host.despawnOfficer(id);
    }

    // Officers arrive *near the belief*, never near the player. An officer who
    // appears because the player is wanted is an officer who appeared from
    // nowhere, and that is the failure criterion 2 is about.
    if (this.spawned.length < tier.officers && this.spawnCooldown === 0) {
      const near = this.heat.belief?.at ?? null;
      if (near) {
        const id = this.host.spawnOfficer(near);
        if (id) {
          this.spawned.push(id);
          this.police.add(id);
          this.spawnCooldown = 2.5;
        }
      }
    }

    this.police.setRoadblocks(tier.roadblocks);
    this.police.update(dt, this.policeWorld());
  }

  private policeWorld(): PoliceWorld {
    const p = this.host.police;
    return {
      belief: this.heat.belief,
      heat: this.heat.heat,
      playerDriving: this.host.playerDriving,
      sees: (id) => {
        const seen = p.sees(id);
        // An officer with eyes on refreshes the shared belief. This is the
        // only path from "an officer can see them" to "the police know where
        // they are", and it runs through `HeatSystem.officerSees`.
        if (seen) this.heat.officerSees(seen.at);
        return seen;
      },
      positionOf: (id) => p.positionOf(id),
      moveTo: (id, to, speed) => p.moveTo(id, to, speed),
      halt: (id) => p.halt(id),
      hasVehicle: (id) => p.hasVehicle(id),
      say: (id, line) => this.say(id, line),
      arrest: (id) => this.arrest(id),
      pathFailed: (id) => p.pathFailed(id),
    };
  }

  private say(officerId: string, line: PoliceLine): void {
    const lines: Record<PoliceLine, [string, string]> = {
      halt: ['Police', 'Stop where you are.'],
      warn: ['Police', 'Stay where you are, please.'],
      fine: ['Police', 'There is a fine to settle.'],
      surrender: ['Police', 'Hands where I can see them.'],
      lost: ['Police', 'They went this way somewhere.'],
      stand_down: ['Police', 'All units, stand down.'],
    };
    const [title, body] = lines[line];
    this.host.toast(title, body);
    void officerId;
  }

  // -- crime ---------------------------------------------------------------

  /**
   * Something happened. Work out who could possibly know.
   *
   * The witness half is the host's: it owns the perception bus and the NPCs,
   * so it resolves who saw what and calls `witnessed` for each. All this does
   * is create the event and leave the evidence.
   */
  commitCrime(id: CrimeId, at: Vec3Like): number {
    const def = crimeDef(id);
    if (!def) return 0;

    const eventId = this.heat.commit(id, at);
    this.lastEvents.set(id, eventId);
    this.host.emitPerception(def.perceivedAs, at, 0);
    this.syncMirrors();
    return eventId;
  }

  /**
   * The most recent event of a kind, so a witness can report against it.
   *
   * Kept here rather than in the host because *every* crime goes through
   * `commitCrime`, including the two this class raises itself when a shot is
   * fired. A copy of this map in `Game` would miss those, and the witnesses to
   * a gunshot would have nothing to report about — which is a silent failure
   * that looks exactly like the police being fair.
   */
  lastEventFor(id: CrimeId): number | undefined {
    return this.lastEvents.get(id);
  }

  private readonly lastEvents = new Map<CrimeId, number>();

  /** Somebody saw a crime and is going for help. */
  witnessed(opts: {
    eventId: number;
    crime: CrimeId;
    at: Vec3Like;
    observerId: string;
    confidence: number;
    identified: boolean;
    distanceToHelp: number;
    canReachHelp: boolean;
  }): void {
    this.heat.report(opts);
  }

  /** An officer watched it happen. No delay and no doubt. */
  officerWitnessed(crime: CrimeId, at: Vec3Like, eventId: number): void {
    this.heat.officerSaw(crime, at, eventId);
    this.syncMirrors();
  }

  // -- shooting ------------------------------------------------------------

  /**
   * Pull the trigger, and resolve every projectile.
   *
   * Order matters and is deliberate: the weapon decides *whether* it fires,
   * ballistics decides *where*, the host decides *what is there*, and only
   * then does anything become a crime. A refused trigger pull raises no Heat,
   * which is why an empty magazine in a shop is embarrassing rather than
   * criminal.
   */
  fire(): { ok: boolean; hits: string[]; reason?: WeaponRefusal } {
    const result = this.weapons.tryFire();
    if (!result.ok) {
      this.host.onRefusal(result.reason);
      return { ok: false, hits: [], reason: result.reason };
    }

    const def = result.def;
    const origin = this.host.playerEye();
    const forward = this.host.aimDirection();
    const { right, up } = this.host.aimBasis();
    const targets = this.host.targets();

    const aimed =
      this.accessibility.aimAssist > 0
        ? assistDirection(origin, forward, targets, {
            coneRadians: ASSIST_CONE,
            strength: this.accessibility.aimAssist,
            range: def.range,
          })
        : forward;

    const hits: string[] = [];
    for (const shot of result.shots) {
      // Two uniforms per pellet, drawn from the weapon's own generator so a
      // burst is reproducible for a given seed.
      const u = this.rand();
      const v = this.rand();
      const dir = coneDirection(aimed, right, up, shot.spread, u, v);
      const wall = this.host.worldDistance(origin, dir, def.range);
      const trace = traceShot(origin, dir, def.range, targets, wall);

      if (trace.hit) {
        const amount = impactAt(def, trace.hit.distance) * this.accessibility.difficulty;
        this.host.applyImpact(trace.hit.targetId, amount, origin);
        hits.push(trace.hit.targetId);
      }
      if (this.accessibility.flashes || trace.struckWorld) {
        this.host.spawnImpact(trace.end, trace.struckWorld);
      }
    }

    // A firearm going off is a crime and a very loud one. Hands are neither.
    if (def.conspicuous) {
      const eventId = this.commitCrime('weapon_discharge', origin);
      this.host.emitPerception('gunshot', origin, def.loudness);
      void eventId;
    } else if (hits.length > 0) {
      this.commitCrime('assault', origin);
    }

    this.syncMirrors();
    return { ok: true, hits };
  }

  private randState = 0x2545f491;
  /** A small deterministic generator for pellet placement. */
  private rand(): number {
    this.randState = (this.randState + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.randState ^ (this.randState >>> 15), 1 | this.randState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  seed(value: number): void {
    this.randState = value >>> 0;
    this.weapons.seed(value);
  }

  // -- equipping -----------------------------------------------------------

  equip(id: WeaponId): boolean {
    const r = this.weapons.equip(id);
    if (!r.ok) {
      this.host.onRefusal(r.reason);
      return false;
    }
    this.syncMirrors();
    return true;
  }

  holster(): void {
    this.weapons.holster();
    this.syncMirrors();
  }

  reload(): boolean {
    const r = this.weapons.reload();
    if (!r.ok) {
      this.host.onRefusal(r.reason);
      return false;
    }
    return true;
  }

  acquire(id: WeaponId, rounds = 0): boolean {
    const r = this.weapons.acquire(id, rounds);
    if (!r.ok) this.host.onRefusal(r.reason);
    return r.ok;
  }

  // -- resolution ----------------------------------------------------------

  /**
   * An officer has hold of the player.
   *
   * The director clears Heat and retires the squad; the *host* does everything
   * that touches the world — the fade, the fine, moving the player and their
   * vehicle somewhere safe, advancing the clock. Splitting it that way is what
   * keeps "an arrest never corrupts a quest or a save" a property of one
   * function in `Game` rather than of this whole file.
   */
  private arrest(officerId: string): void {
    this.heat.settle({ clearFines: false, arrested: true });
    this.retireAll();
    this.syncMirrors();
    this.host.onArrest(officerId);
  }

  /**
   * Give up voluntarily. Always available, and the non-lethal way out of any
   * encounter — including the one an officer on foot can never end himself,
   * where the player is behind the wheel.
   *
   * It ends in the same place being caught does. An earlier version stopped at
   * clearing Heat, which made surrendering strictly better than being taken in
   * along every axis at once: no fine, no hours lost, and the getaway car left
   * running in the street with nobody in it. A Playwright run through the
   * impound yard is what found it. The player still gains by choosing it —
   * they choose *when*, and they are not chased — but they are taken in.
   */
  surrender(): boolean {
    if (!this.heat.wanted) return false;
    this.heat.settle({ clearFines: false, arrested: true });
    this.retireAll();
    this.syncMirrors();
    this.host.toast('You stopped', 'They take it from here.');
    this.host.onArrest('surrender');
    return true;
  }

  /** Settle up at the desk. Returns what was actually paid. */
  settleAtDesk(available: number): number {
    const paid = this.heat.payFines(available);
    this.syncMirrors();
    return paid;
  }

  private retireAll(): void {
    const world = this.policeWorld();
    for (const id of this.spawned) {
      this.police.remove(id, world);
      this.host.despawnOfficer(id);
    }
    this.spawned.length = 0;
    this.police.clear(world);
  }

  /** Zone change, or a new run. Everything local goes; the record stays. */
  clearEncounter(): void {
    this.retireAll();
    this.weapons.holster();
    this.displayReported = false;
    this.syncMirrors();
  }

  // -- reading -------------------------------------------------------------

  get debug() {
    return {
      heat: this.heat.heat,
      level: this.heat.level,
      belief: this.heat.belief,
      finesOwed: this.heat.finesOwed,
      police: this.police.stats,
      weapon: this.weapons.equipped.id,
      stance: this.weapons.stance,
      rounds: this.weapons.rounds,
      reserve: this.weapons.reserve,
      spread: this.weapons.spread,
      reportsDelivered: this.heat.reportsDelivered,
      duplicatesIgnored: this.heat.duplicatesIgnored,
      arrests: this.heat.arrests,
    };
  }

  /** Weapon ids the player owns, for a HUD wheel. */
  get carried(): readonly WeaponId[] {
    return this.weapons.ownedIds;
  }

  weaponName(id: WeaponId): string {
    return weaponDef(id)?.displayName ?? id;
  }
}

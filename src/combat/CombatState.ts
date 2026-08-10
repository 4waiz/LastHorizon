import type { WeaponSaveData } from './WeaponSystem';
import type { HeatSaveData } from '../crime/Heat';

/**
 * What the save layer needs to know about weapons and the police.
 *
 * The eager half, exactly like `StoryState`: `SaveService` has to read and
 * write a criminal record whether or not anybody has ever drawn a weapon, and
 * the HUD has to know whether to show a Heat readout from the first frame. The
 * systems that *do* anything — `WeaponSystem`, `HeatSystem`, `PoliceSystem`,
 * the ballistics, the impact effects — are all behind `CombatSubsystem`'s
 * dynamic import and are never fetched by a player who does not need them.
 *
 * This class holds the serialised blobs and two derived numbers the HUD reads.
 * It deliberately contains no logic: the moment it starts deciding anything it
 * has to import the catalogues, and then it is not the eager half any more.
 */

export interface CombatSaveData {
  weapons: WeaponSaveData | null;
  heat: HeatSaveData | null;
}

export class CombatState {
  /** Last serialised weapon state. Written by the director on save. */
  weapons: WeaponSaveData | null = null;
  /** Last serialised heat state. */
  heat: HeatSaveData | null = null;

  /**
   * Mirrors for the HUD, pushed by the director each frame.
   *
   * Copies rather than lookups, so the always-on interface can read them
   * without the combat chunk being present at all — which is the whole reason
   * this class exists.
   */
  heatLevel = 0;
  finesOwed = 0;
  wanted = false;
  /** Whether a firearm is currently drawn. Drives the safe-zone prompt. */
  brandishing = false;

  toJSON(): CombatSaveData {
    return {
      weapons: this.weapons ? { ...this.weapons, owned: { ...this.weapons.owned } } : null,
      heat: this.heat ? JSON.parse(JSON.stringify(this.heat)) as HeatSaveData : null,
    };
  }

  /**
   * Restore from a save.
   *
   * Absent means "nothing has happened yet", which is what a save written
   * before this phase means and also what a clean run means. The blobs are
   * handed to the systems unvalidated on purpose — `WeaponSystem.restore` and
   * `HeatSystem.restore` are both defensive, and re-checking here would be a
   * second opinion that could disagree with the first.
   */
  restore(data: Partial<CombatSaveData> | undefined): void {
    this.weapons = data?.weapons ?? null;
    this.heat = data?.heat ?? null;
    this.heatLevel = 0;
    this.finesOwed = data?.heat?.finesOwed ?? 0;
    this.wanted = (data?.heat?.heat ?? 0) > 0;
    this.brandishing = false;
  }

  reset(): void {
    this.restore(undefined);
  }

  /** A snapshot for rollback, matching `Economy.snapshot`. */
  snapshot(): CombatSaveData {
    return this.toJSON();
  }
}

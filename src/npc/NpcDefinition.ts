import type { ZoneId } from '../world/zones/Manifest';
import { scheduleById } from './schedules';
import type { AnchorSlot } from './ScheduleDefinition';

/**
 * Who a named resident is.
 *
 * Twenty of these exist and every one of them is data. The rules that hold
 * across all of them — a child is never combat-capable, a schedule id has to
 * resolve, an anchor has to be inside its zone — are checked by
 * `validateNpcCatalogue`, which a unit test runs against the shipped
 * catalogue. That is the difference between "we intend not to ship a
 * targetable child" and "we cannot".
 */

export type NpcRole =
  | 'shopkeeper'
  | 'mechanic'
  | 'officer'
  | 'nurse'
  | 'fisher'
  | 'farmer'
  | 'teacher'
  | 'student'
  | 'courier'
  | 'barista'
  | 'clerk'
  | 'retired'
  | 'homemaker'
  | 'dockhand';

/**
 * Age band, and the one place it is load-bearing rather than cosmetic.
 *
 * `child` is not a visual preset. Nothing with this band may be combat-capable
 * or targetable, which the validator enforces and Phase 9 will read.
 */
export type AgeBand = 'child' | 'teen' | 'adult' | 'elder';

export interface NpcAppearance {
  /** Palette swaps on the shared rig. Hex, from the world palette. */
  readonly shirt: string;
  readonly trousers: string;
  /** Null for bare-headed. */
  readonly hat: string | null;
  /** 1.0 is the player's build; residents vary by a few percent. */
  readonly scale: number;
  readonly build: 'slight' | 'average' | 'stocky';
}

/** A place an NPC goes. World coordinates in the NPC's own zone. */
export interface NpcAnchor {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface NamedNpcDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly zone: ZoneId;
  readonly role: NpcRole;
  readonly ageBand: AgeBand;
  /** Age at the start of Story Mode. Advances with the player's birthdays. */
  readonly startAge: number;
  readonly appearance: NpcAppearance;
  readonly anchors: Readonly<Record<AnchorSlot, NpcAnchor>>;
  readonly scheduleId: string;
  /** How the player already knows them, 0..1 per axis. Absent axes start at 0. */
  readonly initialRelationship?: Readonly<Record<string, number>>;
  /** Named parts this NPC can fill when Phase 8 writes the quest graph. */
  readonly questRoles: readonly string[];
  /** Item ids they can give, want or trade. Hooks only; Phase 7 spends them. */
  readonly inventoryHooks: readonly string[];
  /** Which bark set they draw greetings and reactions from. */
  readonly barkSet: string;
  /**
   * Whether Phase 9 may ever arm this NPC or let the player target them.
   * Must be false for `child`, and is false for everyone in this phase.
   */
  readonly combatCapable: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface NpcIssue {
  readonly npc: string;
  readonly code: string;
  readonly message: string;
}

export interface ZoneBoundsLookup {
  (zone: ZoneId): { minX: number; minZ: number; maxX: number; maxZ: number } | null;
}

const ANCHOR_SLOTS: readonly AnchorSlot[] = ['home', 'work', 'leisure', 'social'];

export function validateNpcCatalogue(
  catalogue: readonly NamedNpcDefinition[],
  boundsFor: ZoneBoundsLookup,
): NpcIssue[] {
  const issues: NpcIssue[] = [];
  const seen = new Set<string>();

  for (const npc of catalogue) {
    const push = (code: string, message: string) => issues.push({ npc: npc.id, code, message });

    if (seen.has(npc.id)) push('duplicate-id', `npc ${npc.id} declared twice`);
    seen.add(npc.id);

    if (!scheduleById(npc.scheduleId)) {
      push('missing-schedule', `schedule ${npc.scheduleId} does not exist`);
    }

    // The rule the whole age band exists for.
    if (npc.ageBand === 'child' && npc.combatCapable) {
      push('child-combatant', 'a child NPC may never be combat-capable');
    }
    if (npc.ageBand === 'child' && npc.startAge >= 13) {
      push('child-age-mismatch', `age band is child but startAge is ${npc.startAge}`);
    }
    if (npc.ageBand === 'elder' && npc.startAge < 60) {
      push('elder-age-mismatch', `age band is elder but startAge is ${npc.startAge}`);
    }

    const bounds = boundsFor(npc.zone);
    if (!bounds) {
      push('unknown-zone', `zone ${npc.zone} is not in the world manifest`);
      continue;
    }

    for (const slot of ANCHOR_SLOTS) {
      const a = npc.anchors[slot];
      if (!a) {
        push('missing-anchor', `no ${slot} anchor`);
        continue;
      }
      if (a.x < bounds.minX || a.x > bounds.maxX || a.z < bounds.minZ || a.z > bounds.maxZ) {
        push('anchor-out-of-bounds', `${slot} anchor "${a.id}" lies outside ${npc.zone}`);
      }
    }

    if (npc.appearance.scale < 0.8 || npc.appearance.scale > 1.2) {
      push('extreme-scale', `appearance scale ${npc.appearance.scale} is outside 0.8..1.2`);
    }
  }

  return issues;
}

/** Named residents of one zone, in catalogue order so spawning is deterministic. */
export function npcsInZone(
  catalogue: readonly NamedNpcDefinition[],
  zone: ZoneId,
): NamedNpcDefinition[] {
  return catalogue.filter((n) => n.zone === zone);
}

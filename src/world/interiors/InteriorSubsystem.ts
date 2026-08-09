/**
 * Everything reachable only by opening a door, in one lazily-imported module.
 *
 * The same argument that put Rapier, Recast and the map panel behind dynamic
 * imports applies here, and more cleanly than to any of them: a player who
 * never goes inside a building needs none of this, and the player who does is
 * already looking at a fade to black while the 145 kB kit downloads. The
 * subsystem rides along in that gap.
 *
 * What stays eager, and why:
 *
 * - **`Economy`, `Wallet`, `Ledger`, `PriceCatalog`.** Cash is on the HUD from
 *   the first frame and in every save, so it cannot wait for a doorway.
 * - **`TaskSystem`.** Its counters are in the save format for the same reason.
 * - **`InteriorKit` and `InteriorDefinition`.** Types and small pure helpers;
 *   `World` needs the `ServiceType` union to label its doors.
 *
 * Measured: the split took the app chunk from 370.8 kB to 346.1 kB and
 * `initial load` from 4188.4 kB — 11.6 kB under its limit — back to 4163.7 kB.
 */

export { InteriorRegistry, type DoorLink, type OpenResult, type ReturnContext } from './InteriorRegistry';
export { INTERIORS, interiorDef } from './interiorCatalog';
export { buildInterior, interiorOrigin, type BuiltInterior } from './InteriorBuilder';
export {
  buildMenu,
  executeOffer,
  type ServiceFailure,
  type ServiceHost,
  type ServiceMenu,
} from '../../services/ServiceSystem';
export { DECOR_PARTS, serviceDef, isDecorItem, type DecorItemId } from '../../services/ServiceCatalog';

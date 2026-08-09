import * as THREE from 'three';
import { makeToon, toonFromImported } from '../graphics/ToonMaterial';
import {
  LIGHT_PERIOD_SECONDS,
  lightIsGreen,
  nextIntersection,
  sampleLane,
  type Lane,
  type LaneGraph,
} from './LaneGraph';
import {
  canSpawnAt,
  desiredSpeed,
  integrateSpeed,
  mulberry32,
  watchdog,
  DEFAULT_BUBBLE,
  STALL_SPEED,
  type BubbleRanges,
} from './TrafficRules';

/**
 * Light traffic on the lane graph.
 *
 * Kinematic, not Rapier. A traffic car does not need suspension, tyre slip or
 * a differential — it needs to be in the right lane at the right speed and to
 * not drive through the player. Handing thirty of them to the physics solver
 * would cost more than the entire rest of the population system and would look
 * no different from six metres away.
 *
 * The player's own vehicle *is* a Rapier body, and it enters here as an
 * obstacle rather than as a participant, which is the whole interface between
 * the two systems.
 */

export interface TrafficObstacle {
  readonly x: number;
  readonly z: number;
  /** Metres of clearance to leave. */
  readonly radius: number;
}

export interface TrafficStats {
  vehicles: number;
  parked: number;
  spawned: number;
  despawned: number;
  /** Watchdog interventions since the zone loaded. Should stay near zero. */
  barges: number;
  forcedRemovals: number;
  /** Spawn attempts refused because the point was in view. */
  spawnRefusedInView: number;
}

interface Vehicle {
  id: number;
  lane: Lane;
  /** Metres travelled along the current lane. */
  distance: number;
  speed: number;
  /** Parent of both detail levels; this is what moves. */
  model: THREE.Object3D;
  /** Full-detail body: windows, wheels, lights, trim. */
  near: THREE.Object3D;
  /** Simplified body, for anything further away than `DETAIL_DISTANCE`. */
  far: THREE.Object3D;
  /** Seconds spent below the stall speed while wanting to move. */
  stalled: number;
  /** Seconds spent stopped at a red light, which is not stalling. */
  waitingAtLight: number;
  /** Seconds left of ignoring give-way rules, after a watchdog barge. */
  barging: number;
  /**
   * Stopped for a reason the watchdog must not count: a red light, or a queue
   * behind somebody who is stopped for a reason.
   */
  excused: boolean;
  /** Distance to whatever is directly ahead in this lane, or Infinity. */
  gapAhead: number;
  parked: boolean;
  kind: string;
}

/**
 * What drives past, and in what colour.
 *
 * The first version used the `_LOD1` bodies for everything. They are 140
 * triangles against the full model's 424 and they read as a flat slab up
 * close — no wheels to speak of, a suggestion of a windscreen. Traffic spawns
 * 45 m away and drives *toward* the player, so "up close" is most of the time
 * you spend looking at it.
 *
 * The police car keeps its own livery; everything else takes a paint colour.
 * The colours are the vehicle palette from `build_vehicles.py`, plus two
 * muted extras, so a street of them still reads as one world.
 */
const TRAFFIC_MODELS = ['Hatchback', 'Van', 'Hatchback', 'Police'] as const;

const PAINT_COLOURS = ['#c9584b', '#5f7fa8', '#e3ded0', '#8fae7a', '#dcc177', '#7f7a8c'];

/**
 * The patrol car's livery.
 *
 * The model's authored paint is the same red as a civilian car, which beside
 * one reads as an ordinary car that happens to have a light bar. Pale body,
 * beacon left alone.
 */
const POLICE_LIVERY = '#eef0f2';

/** Beyond this, a vehicle switches to its simplified body. */
const DETAIL_DISTANCE = 38;

/** How often a spawn is attempted, seconds. */
const SPAWN_INTERVAL = 1.6;
/** Metres ahead a vehicle looks for anything solid. */
const SENSE_AHEAD = 22;
/** A queue this tight counts as "stopped behind somebody", not as stalled. */
const QUEUE_GAP = 9;

export class TrafficSystem {
  private readonly vehicles: Vehicle[] = [];
  private readonly group = new THREE.Group();
  private readonly rng: () => number;
  private nextId = 1;
  private spawnTimer = 0;
  private elapsed = 0;
  private readonly prototypes = new Map<string, THREE.Object3D>();
  /** Ground lift per model kind, measured from the geometry. */
  private readonly rideHeights = new Map<string, number>();

  readonly stats: TrafficStats = {
    vehicles: 0,
    parked: 0,
    spawned: 0,
    despawned: 0,
    barges: 0,
    forcedRemovals: 0,
    spawnRefusedInView: 0,
  };

  constructor(
    private readonly graph: LaneGraph,
    private readonly models: Map<string, THREE.Object3D>,
    private readonly parent: THREE.Object3D,
    seed: number,
    private maxVehicles: number,
    private readonly bubble: BubbleRanges = DEFAULT_BUBBLE,
  ) {
    this.group.name = 'Traffic';
    this.parent.add(this.group);
    this.rng = mulberry32(seed);
  }

  get count(): number {
    return this.vehicles.length;
  }

  /** Hide every vehicle without removing it. See `Population.setActive`. */
  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  setMaxVehicles(n: number): void {
    this.maxVehicles = Math.max(0, n);
    while (this.vehicles.length > this.maxVehicles) {
      const v = this.vehicles.pop();
      if (v) this.retire(v);
    }
  }

  /** Every vehicle's position, so pedestrians and perception can see them. */
  positions(): TrafficObstacle[] {
    return this.vehicles.map((v) => ({
      x: v.model.position.x,
      z: v.model.position.z,
      radius: 2.2,
    }));
  }

  update(
    dt: number,
    player: { x: number; z: number },
    playerFacing: number,
    obstacles: readonly TrafficObstacle[],
  ): void {
    this.elapsed += dt;
    this.excuseQueues(obstacles);

    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      this.step(v, dt, obstacles);

      const distance = Math.hypot(v.model.position.x - player.x, v.model.position.z - player.z);
      if (distance > this.bubble.despawn) {
        this.vehicles.splice(i, 1);
        this.retire(v);
        this.stats.despawned++;
        continue;
      }

      // Full body up close, simplified beyond. Toggling visibility rather than
      // swapping the object keeps both clones alive and costs one boolean; the
      // hidden one is not drawn, so only the near body's eight draw calls are
      // ever paid, and only for the two or three cars actually near you.
      const detailed = distance < DETAIL_DISTANCE;
      if (v.near.visible !== detailed) {
        v.near.visible = detailed;
        v.far.visible = !detailed;
      }
    }

    this.spawnTimer += dt;
    if (this.spawnTimer >= SPAWN_INTERVAL) {
      this.spawnTimer = 0;
      if (this.vehicles.length < this.maxVehicles) this.trySpawn(player, playerFacing);
    }

    this.stats.vehicles = this.vehicles.length;
    this.stats.parked = this.vehicles.reduce((n, v) => n + (v.parked ? 1 : 0), 0);
  }

  /**
   * Work out who is stopped for a good reason, before anybody moves.
   *
   * A red light excuses the car at the front of the queue. It does not excuse
   * the three behind it — and the first version of this counted every one of
   * them as stalled and barged them through the junction eight seconds later.
   * The screenshot that found it had nine barges on one village street.
   *
   * So the excuse propagates backwards down the lane: if the car ahead of you
   * is excused and you are right behind it, you are excused too. Three passes
   * is enough for any queue this system will ever produce, and it stops short
   * of excusing everybody — two cars each waiting on the *other* at a junction
   * are not behind anyone excused, so a genuine deadlock still barges.
   */
  private excuseQueues(obstacles: readonly TrafficObstacle[]): void {
    for (const v of this.vehicles) {
      v.gapAhead = this.gapAhead(v, obstacles).gap;
      const stop = this.stopLine(v);
      v.excused = Number.isFinite(stop) && stop < 6;
    }

    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const v of this.vehicles) {
        if (v.excused || v.gapAhead > QUEUE_GAP) continue;
        const lead = this.leadVehicle(v);
        if (lead?.excused) {
          v.excused = true;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  /** The nearest vehicle ahead of `v` in the same lane, if any. */
  private leadVehicle(v: Vehicle): Vehicle | null {
    let best: Vehicle | null = null;
    let bestGap = Infinity;
    for (const other of this.vehicles) {
      if (other === v || other.lane.id !== v.lane.id) continue;
      const gap = other.distance - v.distance;
      if (gap > 0 && gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return best;
  }

  private step(v: Vehicle, dt: number, obstacles: readonly TrafficObstacle[]): void {
    if (v.parked) {
      v.speed = 0;
      return;
    }
    if (v.barging > 0) v.barging -= dt;

    const ahead = this.gapAhead(v, obstacles);
    const stop = v.barging > 0 ? Infinity : this.stopLine(v);

    const target = desiredSpeed({
      limit: v.lane.speedLimit,
      speed: v.speed,
      gapAhead: ahead.gap,
      leadSpeed: ahead.speed,
      stopAhead: stop,
    });
    v.speed = integrateSpeed(v.speed, target, dt);
    v.distance += v.speed * dt;

    // Watchdog. Three things it must not count. A parked car is not stalled,
    // it is parked — handled by the early return above. A car at a red light
    // is not stalled either: it is doing exactly the right thing, and the
    // first version barged every one of them through the junction because a
    // red phase outlasts the eight-second threshold. Nor is a car queued
    // behind one of those; `excuseQueues` works that out before anybody moves.
    const heldByLight = v.excused;
    if (v.speed < STALL_SPEED && heldByLight) {
      v.waitingAtLight += dt;
      // A light that never turns green is a bug somewhere else, but a car
      // sitting at one forever is visible, so there is still a ceiling.
      if (v.waitingAtLight > LIGHT_PERIOD_SECONDS * 4) {
        this.stats.forcedRemovals++;
        const index = this.vehicles.indexOf(v);
        if (index >= 0) this.vehicles.splice(index, 1);
        this.retire(v);
        return;
      }
    } else if (v.speed < STALL_SPEED) {
      v.waitingAtLight = 0;
      v.stalled += dt;
      const action = watchdog(v.stalled);
      if (action === 'barge' && v.barging <= 0) {
        v.barging = 4;
        this.stats.barges++;
      } else if (action === 'remove') {
        this.stats.forcedRemovals++;
        const index = this.vehicles.indexOf(v);
        if (index >= 0) this.vehicles.splice(index, 1);
        this.retire(v);
        return;
      }
    } else {
      v.stalled = 0;
      v.waitingAtLight = 0;
    }

    if (v.distance >= v.lane.length) this.advanceLane(v);

    const pose = sampleLane(v.lane, v.distance);
    v.model.position.set(pose.x, pose.y + this.rideHeight(v.kind), pose.z);
    v.model.rotation.y = pose.heading;
  }

  /**
   * Nearest thing in this vehicle's way.
   *
   * Same-lane vehicles are compared by distance along the lane, which is exact
   * and free. Everything else — the player, the player's car, a pedestrian who
   * has wandered off the pavement — is tested against sample points ahead on
   * the lane, which is approximate and cheap. Approximate is the right trade:
   * being wrong by half a metre changes when a car starts slowing, not whether
   * it hits anybody.
   */
  private gapAhead(v: Vehicle, obstacles: readonly TrafficObstacle[]): { gap: number; speed: number } {
    let gap = Infinity;
    let speed = 0;

    for (const other of this.vehicles) {
      if (other === v || other.lane.id !== v.lane.id) continue;
      const d = other.distance - v.distance;
      if (d > 0 && d < gap) {
        gap = d;
        speed = other.speed;
      }
    }

    if (obstacles.length > 0) {
      for (let d = 4; d <= SENSE_AHEAD; d += 3) {
        if (d >= gap) break;
        const at = sampleLane(v.lane, v.distance + d);
        for (const o of obstacles) {
          if (Math.hypot(at.x - o.x, at.z - o.z) <= o.radius + 1.1) {
            gap = d;
            speed = 0;
            break;
          }
        }
        if (Number.isFinite(gap)) break;
      }
    }

    return { gap, speed };
  }

  /** Distance to the next place this vehicle must stop, or Infinity. */
  private stopLine(v: Vehicle): number {
    const found = nextIntersection(v.lane, v.distance, this.graph.intersections);
    if (!found || found.ahead < 0) return Infinity;
    const green = lightIsGreen(found.intersection, v.lane.centrelineId, this.elapsed);
    return green ? Infinity : found.ahead;
  }

  /**
   * End of the lane: take an exit, or park.
   *
   * Parking rather than vanishing matters because a lane can end inside the
   * bubble — the district's road simply stops at the zone edge — and a car
   * that blinks out at the end of the street in full view is worse than one
   * that pulls up. Parked cars are removed by the ordinary distance check once
   * the player has gone.
   */
  private advanceLane(v: Vehicle): void {
    const options = v.lane.next;
    if (options.length === 0) {
      v.parked = true;
      v.distance = v.lane.length;
      v.speed = 0;
      return;
    }
    const pick = options[Math.floor(this.rng() * options.length) % options.length];
    const next = this.graph.laneById(pick);
    if (!next) {
      v.parked = true;
      v.distance = v.lane.length;
      return;
    }
    v.distance -= v.lane.length;
    v.lane = next;
  }

  private trySpawn(player: { x: number; z: number }, facing: number): void {
    if (this.graph.lanes.length === 0) return;

    // A bounded number of attempts rather than a search: at most six lanes are
    // examined per interval, so a player standing where nothing is spawnable
    // costs the same as one driving through the middle of it.
    for (let attempt = 0; attempt < 6; attempt++) {
      const lane = this.graph.lanes[Math.floor(this.rng() * this.graph.lanes.length) % this.graph.lanes.length];
      const distance = this.rng() * lane.length;
      const pose = sampleLane(lane, distance);

      if (!canSpawnAt(player, facing, pose, this.bubble)) {
        this.stats.spawnRefusedInView++;
        continue;
      }
      // Never on top of another car.
      const clash = this.vehicles.some(
        (v) => v.lane.id === lane.id && Math.abs(v.distance - distance) < 9,
      );
      if (clash) continue;

      this.spawn(lane, distance);
      return;
    }
  }

  private spawn(lane: Lane, distance: number): void {
    const kind = TRAFFIC_MODELS[Math.floor(this.rng() * TRAFFIC_MODELS.length) % TRAFFIC_MODELS.length];
    const colour =
      kind === 'Police'
        ? POLICE_LIVERY
        : PAINT_COLOURS[Math.floor(this.rng() * PAINT_COLOURS.length) % PAINT_COLOURS.length];

    const near = this.prototypeFor(kind, colour)?.clone(true);
    const far = this.prototypeFor(`${kind}_LOD1`, colour)?.clone(true);
    if (!near || !far) return;

    const model = new THREE.Group();
    model.name = `traffic:${kind}`;
    far.visible = false;
    model.add(near, far);

    const pose = sampleLane(lane, distance);
    model.position.set(pose.x, pose.y + this.rideHeight(kind), pose.z);
    model.rotation.y = pose.heading;
    this.group.add(model);

    this.vehicles.push({
      id: this.nextId++,
      lane,
      distance,
      // Arriving at the limit rather than from rest: a car that appears
      // stationary and then accelerates reads as a spawn.
      speed: lane.speedLimit * 0.8,
      model,
      near,
      far,
      stalled: 0,
      waitingAtLight: 0,
      barging: 0,
      excused: false,
      gapAhead: Infinity,
      parked: false,
      kind,
    });
    this.stats.spawned++;
  }

  /**
   * How far to lift a model so its wheels touch the road.
   *
   * The GLB anchors a vehicle at its **axle**, not at the ground: a hatchback's
   * bounding box runs from -0.55 to +1.39 in y. Placing the model at the lane's
   * own height therefore buries the bottom half of it, which is precisely what
   * the first version did — the cars looked like painted slabs lying on the
   * tarmac. Measured from the geometry rather than typed in, so a change to the
   * Blender script cannot silently reintroduce it.
   */
  private rideHeight(kind: string): number {
    const cached = this.rideHeights.get(kind);
    if (cached !== undefined) return cached;

    const source = this.models.get(kind);
    let lift = 0;
    if (source) {
      const box = new THREE.Box3().setFromObject(source);
      if (Number.isFinite(box.min.y)) lift = Math.max(0, -box.min.y);
    }
    this.rideHeights.set(kind, lift);
    return lift;
  }

  /**
   * One converted copy of each model and colour, cloned per vehicle.
   *
   * The conversion — importing the GLB's materials into the shared toon cache —
   * happens once per prototype. `clone(true)` shares materials with it, so six
   * red hatchbacks are six draw calls' worth of geometry against one set of
   * materials, and the program cache still sees one program however many
   * colours are in use: `makeToon` keys on the value, and only the paint slot
   * differs between them.
   */
  private prototypeFor(kind: string, colour: string | null): THREE.Object3D | null {
    const key = `${kind}|${colour ?? '-'}`;
    const cached = this.prototypes.get(key);
    if (cached) return cached;

    const source = this.models.get(kind);
    if (!source) return null;

    const proto = source.clone(true);
    proto.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // Out of the camera's occluder raycast. Traffic materials are not
      // fadeable, so testing them is pure cost. See `NpcVisuals`.
      mesh.raycast = () => undefined;

      const convert = (m: THREE.Material): THREE.Material =>
        colour && m?.name === 'vehicle_paint'
          ? makeToon(colour, { id: 'traffic_paint' })
          : toonFromImported(m, 'traffic');

      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(convert)
        : convert(mesh.material);
    });
    this.prototypes.set(key, proto);
    return proto;
  }

  /** Detach a vehicle's model. Geometry and materials are shared, so neither goes. */
  private retire(v: Vehicle): void {
    v.model.removeFromParent();
  }

  dispose(): void {
    for (const v of this.vehicles) this.retire(v);
    this.vehicles.length = 0;
    // Prototypes own nothing the asset bundle does not already own: the
    // geometry belongs to the GLB, and the materials belong to the toon cache
    // and are shared with the player's own vehicles.
    this.prototypes.clear();
    this.group.removeFromParent();
  }
}

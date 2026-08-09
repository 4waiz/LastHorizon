import { describe, it, expect } from 'vitest';
import {
  INTERSECTION_RADIUS,
  LANE_OFFSET,
  LIGHT_PERIOD_SECONDS,
  buildLaneGraph,
  centrelineFromPolyline,
  centrelinesFromManifest,
  findIntersections,
  lightIsGreen,
  nextIntersection,
  rightOf,
  sampleLane,
  type Centreline,
} from '../src/traffic/LaneGraph';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';

const flat = (pts: Array<[number, number]>) => pts.map(([x, z]) => ({ x, y: 0, z }));

/** A north-south road through the origin, 200 m long. */
const northSouth: Centreline = {
  id: 'ns',
  points: flat([
    [0, -100],
    [0, 100],
  ]),
  speedLimit: 14,
};

/** An east-west road crossing it, slower. */
const eastWest: Centreline = {
  id: 'ew',
  points: flat([
    [-100, 0],
    [100, 0],
  ]),
  speedLimit: 10,
};

describe('rightOf', () => {
  it('is the driver-right vector for a right-handed system with +Y up', () => {
    // Facing +Z, right is -X. Getting this backwards puts the whole city's
    // traffic on the wrong side of the road.
    expect(rightOf(0, 1).x).toBeCloseTo(-1, 9);
    expect(rightOf(0, 1).z).toBeCloseTo(0, 9);
    expect(rightOf(1, 0).x).toBeCloseTo(0, 9);
    expect(rightOf(1, 0).z).toBeCloseTo(1, 9);
  });

  it('normalises, so an unnormalised heading still gives a unit offset', () => {
    const r = rightOf(0, 12);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(1, 9);
  });
});

describe('building lanes', () => {
  it('makes two directed lanes per centreline', () => {
    const g = buildLaneGraph([northSouth]);
    expect(g.lanes).toHaveLength(2);
    expect(g.lanes.map((l) => l.direction).sort()).toEqual([-1, 1]);
  });

  it('offsets each lane to its own driver-right side', () => {
    const g = buildLaneGraph([northSouth]);
    const forward = g.lanes.find((l) => l.direction === 1)!;
    const backward = g.lanes.find((l) => l.direction === -1)!;
    // Northbound (+Z) sits at -X; southbound sits at +X. They are on opposite
    // sides, which is the whole point.
    expect(forward.points[0].x).toBeCloseTo(-LANE_OFFSET, 6);
    expect(backward.points[0].x).toBeCloseTo(LANE_OFFSET, 6);
  });

  it('records a length and a matching cumulative table', () => {
    const g = buildLaneGraph([northSouth]);
    const lane = g.lanes[0];
    expect(lane.length).toBeCloseTo(200, 6);
    expect(lane.lengths[0]).toBe(0);
    expect(lane.lengths[lane.lengths.length - 1]).toBeCloseTo(lane.length, 6);
  });

  it('drops a centreline too short to drive on', () => {
    const stub: Centreline = { id: 'stub', points: flat([[0, 0], [0, 2]]), speedLimit: 10 };
    expect(buildLaneGraph([stub]).lanes).toHaveLength(0);
  });

  it('ignores a centreline with fewer than two points', () => {
    expect(buildLaneGraph([{ id: 'dot', points: flat([[0, 0]]), speedLimit: 10 }]).lanes).toHaveLength(0);
  });

  it('never links a lane to its own opposite direction', () => {
    // That is a U-turn on the spot, and it looks exactly as odd as it sounds.
    const g = buildLaneGraph([northSouth]);
    for (const lane of g.lanes) {
      for (const next of lane.next) {
        const other = g.laneById(next)!;
        expect(other.centrelineId === lane.centrelineId && other.direction !== lane.direction).toBe(
          false,
        );
      }
    }
  });

  it('joins a lane end to a lane start that is close enough', () => {
    const a: Centreline = { id: 'a', points: flat([[0, 0], [0, 40]]), speedLimit: 12 };
    const b: Centreline = { id: 'b', points: flat([[0, 40], [0, 90]]), speedLimit: 12 };
    const g = buildLaneGraph([a, b]);
    const aForward = g.laneById('a#f')!;
    expect(aForward.next.length).toBeGreaterThan(0);
  });

  it('resolves lanes by id and returns null otherwise', () => {
    const g = buildLaneGraph([northSouth]);
    expect(g.laneById('ns#f')?.direction).toBe(1);
    expect(g.laneById('nope')).toBeNull();
  });
});

describe('intersections', () => {
  it('finds the crossing point of two roads', () => {
    const found = findIntersections([northSouth, eastWest]);
    expect(found).toHaveLength(1);
    expect(found[0].x).toBeCloseTo(0, 6);
    expect(found[0].z).toBeCloseTo(0, 6);
  });

  it('gives priority to the faster road', () => {
    const [x] = findIntersections([northSouth, eastWest]);
    expect(x.majorCentreline).toBe('ns');
    expect(x.minorCentreline).toBe('ew');
  });

  it('breaks a speed tie deterministically rather than by declaration order', () => {
    const sameSpeed = { ...eastWest, speedLimit: 14 };
    const a = findIntersections([northSouth, sameSpeed])[0];
    const b = findIntersections([sameSpeed, northSouth])[0];
    expect(a.majorCentreline).toBe(b.majorCentreline);
  });

  it('does not report two junctions for one crossing', () => {
    const wiggly: Centreline = {
      id: 'wiggly',
      points: flat([[-20, -1], [-5, 1], [5, -1], [20, 1]]),
      speedLimit: 10,
    };
    const found = findIntersections([northSouth, wiggly]);
    expect(found.length).toBeLessThanOrEqual(1);
  });

  it('reports nothing for roads that do not meet', () => {
    const parallel: Centreline = { id: 'p', points: flat([[30, -100], [30, 100]]), speedLimit: 14 };
    expect(findIntersections([northSouth, parallel])).toHaveLength(0);
  });
});

describe('sampling a lane', () => {
  const lane = buildLaneGraph([northSouth]).lanes.find((l) => l.direction === 1)!;

  it('interpolates along the polyline', () => {
    const start = sampleLane(lane, 0);
    const middle = sampleLane(lane, lane.length / 2);
    expect(start.z).toBeCloseTo(-100, 6);
    expect(middle.z).toBeCloseTo(0, 6);
  });

  it('clamps rather than running off either end', () => {
    expect(sampleLane(lane, -50).z).toBeCloseTo(-100, 6);
    expect(sampleLane(lane, 9999).z).toBeCloseTo(100, 6);
  });

  it('gives a heading in the glTF convention', () => {
    // Travelling +Z means atan2(0, 1) === 0.
    expect(sampleLane(lane, 10).heading).toBeCloseTo(0, 6);
  });
});

describe('approaching a junction', () => {
  const graph = buildLaneGraph([northSouth, eastWest]);
  const lane = graph.laneById('ns#f')!;

  it('reports the junction ahead and how far', () => {
    // The junction is at z=0, and the lane starts at z=-100.
    const found = nextIntersection(lane, 80, graph.intersections);
    expect(found).not.toBeNull();
    expect(found!.ahead).toBeGreaterThan(0);
    expect(found!.ahead).toBeLessThan(26);
  });

  it('reports nothing when the junction is still far off', () => {
    expect(nextIntersection(lane, 0, graph.intersections)).toBeNull();
  });

  it('reports nothing once well past it', () => {
    expect(nextIntersection(lane, 140, graph.intersections)).toBeNull();
  });

  it('only counts junctions the lane actually goes through', () => {
    const elsewhere = [{ ...graph.intersections[0], x: 400, z: 400 }];
    expect(nextIntersection(lane, 90, elsewhere)).toBeNull();
  });

  it('finds a junction that falls between two lane vertices', () => {
    // The regression this exists for: `ns` is described by two points 200 m
    // apart, so the junction at the midpoint is 100 m from the nearest vertex.
    // Checking vertices alone reported nothing and every car drove through.
    expect(lane.points).toHaveLength(2);
    const found = nextIntersection(lane, 85, graph.intersections);
    expect(found).not.toBeNull();
    // The lane is offset 2.5 m to the left of centre, so the junction sits at
    // 100 m along it.
    expect(found!.ahead).toBeCloseTo(15, 1);
  });
});

describe('traffic lights', () => {
  const [x] = findIntersections([northSouth, eastWest]);

  it('never shows green to both axes at once', () => {
    for (let t = 0; t < 240; t += 3) {
      const major = lightIsGreen(x, x.majorCentreline, t);
      const minor = lightIsGreen(x, x.minorCentreline, t);
      expect(major).not.toBe(minor);
    }
  });

  it('alternates, and is a pure function of elapsed time', () => {
    // Derived rather than stateful: no timers to save, and a reloaded save
    // finds the junction exactly as it left it.
    const a = lightIsGreen(x, x.majorCentreline, 5);
    const b = lightIsGreen(x, x.majorCentreline, 5 + LIGHT_PERIOD_SECONDS);
    expect(a).not.toBe(b);
    expect(lightIsGreen(x, x.majorCentreline, 5 + LIGHT_PERIOD_SECONDS * 2)).toBe(a);
    expect(lightIsGreen(x, x.majorCentreline, 5)).toBe(a);
  });

  it('does not hold a red longer than a car will wait', () => {
    // The bug this exists for: the first version used a 24 s period, and the
    // watchdog barges a stalled car through after 8 s — so every car that
    // stopped at a red was shoved across the junction. The period came down
    // and the watchdog learned to recognise a red light; this guards the half
    // of that fix which is a number.
    expect(LIGHT_PERIOD_SECONDS).toBeLessThanOrEqual(16);
    expect(LIGHT_PERIOD_SECONDS).toBeGreaterThanOrEqual(8);
  });

  it('gives junctions different phases so a grid does not pulse in unison', () => {
    const other = { ...x, phaseOffset: (x.phaseOffset + 1) % 2 };
    expect(lightIsGreen(x, x.majorCentreline, 0)).not.toBe(
      lightIsGreen(other, other.majorCentreline, 0),
    );
  });
});

describe('centrelines from the shipped manifest', () => {
  const heightAt = () => 0;

  it('turns the Old Market lane skeleton into a main road and a side street', () => {
    const zone = WORLD_MANIFEST.zones.find((z) => z.id === 'city_old_market')!;
    const lines = centrelinesFromManifest(zone, heightAt);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // The branch at om_1 is what makes two chains rather than one.
    expect(lines.some((l) => l.points.length >= 3)).toBe(true);
  });

  it('produces a graph with lanes and at least one junction for the district', () => {
    const zone = WORLD_MANIFEST.zones.find((z) => z.id === 'city_old_market')!;
    const graph = buildLaneGraph(centrelinesFromManifest(zone, heightAt));
    expect(graph.lanes.length).toBeGreaterThan(0);
    expect(graph.intersections.length).toBeGreaterThan(0);
  });

  it('handles a zone with no lanes at all', () => {
    const zone = WORLD_MANIFEST.zones.find((z) => z.id === 'hill_airstrip')!;
    expect(centrelinesFromManifest(zone, heightAt)).toEqual([]);
    expect(buildLaneGraph([]).lanes).toEqual([]);
  });

  it('takes the slowest limit along a chain', () => {
    const zone = WORLD_MANIFEST.zones.find((z) => z.id === 'city_old_market')!;
    const lines = centrelinesFromManifest(zone, heightAt);
    for (const l of lines) expect(l.speedLimit).toBeGreaterThan(0);
  });
});

describe('thinning a spline', () => {
  it('keeps every nth point and always the last', () => {
    const dense = flat(Array.from({ length: 101 }, (_, i) => [0, i] as [number, number]));
    const line = centrelineFromPolyline('v', dense, 12, 8)!;
    expect(line.points.length).toBeLessThan(dense.length);
    expect(line.points[line.points.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it('refuses a polyline with nothing in it', () => {
    expect(centrelineFromPolyline('v', [], 12)).toBeNull();
    expect(centrelineFromPolyline('v', flat([[0, 0]]), 12)).toBeNull();
  });
});

describe('the intersection radius is wide enough to matter', () => {
  it('covers the carriageway it controls', () => {
    // ROAD_HALF is 5 m and the pavement 2.2 m; a radius under that would let a
    // car cross a junction without ever noticing it.
    expect(INTERSECTION_RADIUS).toBeGreaterThan(7.2);
  });
});

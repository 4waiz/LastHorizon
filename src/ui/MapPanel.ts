// The panel's own stylesheet. Vite emits it as a sibling chunk and resolves
// this module's dynamic import only once the CSS has landed, so the panel
// cannot be shown unstyled.
import './MapPanel.css';
import type { MinimapData, MinimapPoint } from './Minimap';

/**
 * The full map, opened with `M`.
 *
 * The radar bottom-left is a *heading* instrument: it rotates with the player,
 * shows a fixed 78 m, and is meant to be read at a glance while moving. This is
 * the opposite — north-up, pannable, zoomable, and legible while standing
 * still. Trying to make one widget do both is why the radar was hard to read
 * for a while in Phase 2.
 *
 * The projection is pure and lives at the top of this file, so "does the map
 * put things where they belong" is a unit test rather than a screenshot.
 */

export interface MapView {
  /** World point at the centre of the canvas. */
  readonly centreX: number;
  readonly centreZ: number;
  /** Pixels per world metre. */
  readonly scale: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 6;

export const clampScale = (s: number): number =>
  Number.isFinite(s) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)) : 1;

/**
 * World to canvas.
 *
 * North-up: +Z world runs *up* the screen, so a road heading north on the map
 * is a road heading north in the world. The radar's rotation is deliberately
 * absent — a map that spins is a compass, not a map.
 */
export function worldToMap(
  p: MinimapPoint,
  view: MapView,
  width: number,
  height: number,
): ScreenPoint {
  return {
    x: width / 2 + (p.x - view.centreX) * view.scale,
    y: height / 2 - (p.z - view.centreZ) * view.scale,
  };
}

/** Canvas back to world, for turning a drag into a pan. */
export function mapToWorld(
  p: ScreenPoint,
  view: MapView,
  width: number,
  height: number,
): MinimapPoint {
  return {
    x: view.centreX + (p.x - width / 2) / view.scale,
    z: view.centreZ - (p.y - height / 2) / view.scale,
  };
}

/**
 * Zoom about a fixed screen point.
 *
 * Keeping the world point under the cursor stationary is what makes wheel-zoom
 * feel like a map rather than a slideshow; zooming about the centre walks the
 * thing you were looking at off the edge.
 */
export function zoomAbout(
  view: MapView,
  anchor: ScreenPoint,
  factor: number,
  width: number,
  height: number,
): MapView {
  const next = clampScale(view.scale * factor);
  if (next === view.scale) return view;

  const before = mapToWorld(anchor, view, width, height);
  const after = mapToWorld(anchor, { ...view, scale: next }, width, height);
  return {
    scale: next,
    centreX: view.centreX + (before.x - after.x),
    centreZ: view.centreZ + (before.z - after.z),
  };
}

/** A view that frames everything the map knows about, with a margin. */
export function fitToData(
  data: MinimapData,
  width: number,
  height: number,
  margin = 0.86,
): MapView {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const see = (p: MinimapPoint) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  };
  for (const line of data.roads) for (const p of line) see(p);
  for (const b of data.buildings) see(b);

  if (!Number.isFinite(minX)) return { centreX: 0, centreZ: 0, scale: 1 };

  const spanX = Math.max(maxX - minX, 1);
  const spanZ = Math.max(maxZ - minZ, 1);
  return {
    centreX: (minX + maxX) / 2,
    centreZ: (minZ + maxZ) / 2,
    scale: clampScale(Math.min(width / spanX, height / spanZ) * margin),
  };
}

// ---------------------------------------------------------------------------

export interface MapMarker extends MinimapPoint {
  readonly kind: 'keepsake' | 'vehicle' | 'home' | 'garage';
  readonly found?: boolean;
  readonly label?: string;
}

/**
 * What the legend explains, the colours everything is drawn in, and which
 * rows are **filters** rather than captions.
 *
 * `filter: null` means the row describes part of the map itself — roads,
 * buildings, and you. Turning those off would not be a filter, it would be a
 * blank page. Everything else is a layer a player may want out of the way,
 * and the legend is where they say so: it is already the place you look to
 * find out what a mark means, so it is the place to say "not that one".
 */
export const MAP_LEGEND = [
  { key: 'road', colour: '#b9bcb6', label: 'Road', filter: null },
  { key: 'building', colour: '#c08a72', label: 'Building', filter: null },
  { key: 'keepsake', colour: '#e3a63e', label: 'Keepsake to find', filter: 'keepsake' },
  { key: 'found', colour: '#9aa093', label: 'Keepsake found', filter: 'found' },
  { key: 'vehicle', colour: '#4f7fa8', label: 'Your vehicle', filter: 'vehicle' },
  { key: 'garage', colour: '#6f9a72', label: 'Garage', filter: 'garage' },
  { key: 'player', colour: '#4a463e', label: 'You', filter: null },
] as const;

/** The layers a player can switch off. Derived, so the two cannot drift. */
export const MAP_FILTER_KEYS = MAP_LEGEND
  .map((e) => e.filter)
  .filter((f): f is Exclude<typeof f, null> => f !== null);

export type MapFilterKey = (typeof MAP_FILTER_KEYS)[number];

const COL = {
  ground: '#e6e6da',
  grid: 'rgba(120,116,104,0.13)',
  road: '#b9bcb6',
  roadEdge: '#f2ecdc',
  building: '#c08a72',
  buildingEdge: '#9a6a55',
  keepsake: '#e3a63e',
  found: '#9aa093',
  vehicle: '#4f7fa8',
  garage: '#6f9a72',
  player: '#4a463e',
};

/**
 * Draw the map.
 *
 * Separated from the panel that owns the DOM so the same routine can render a
 * static image later — a paper map pinned up in the house, say — without
 * dragging the whole panel along.
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  data: MinimapData,
  view: MapView,
  player: { x: number; z: number; facing: number },
  markers: readonly MapMarker[],
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COL.ground;
  ctx.fillRect(0, 0, width, height);

  // A 50 m grid, so distance is readable without a scale bar in the way.
  const step = 50 * view.scale;
  if (step > 18) {
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    const origin = worldToMap({ x: 0, z: 0 }, view, width, height);
    ctx.beginPath();
    for (let x = origin.x % step; x < width; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
    for (let y = origin.y % step; y < height; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  // Roads: a wide light casing under a narrower dark core reads as a road at
  // any zoom, where a single stroke reads as a scribble when zoomed out.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [
    { colour: COL.roadEdge, width: Math.max(3, 9 * view.scale) },
    { colour: COL.road, width: Math.max(1.5, 6.5 * view.scale) },
  ]) {
    ctx.strokeStyle = pass.colour;
    ctx.lineWidth = pass.width;
    for (const line of data.roads) {
      if (line.length < 2) continue;
      ctx.beginPath();
      line.forEach((p, i) => {
        const s = worldToMap(p, view, width, height);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
  }

  for (const b of data.buildings) {
    const s = worldToMap(b, view, width, height);
    const r = Math.max(2, b.r * view.scale);
    ctx.fillStyle = COL.building;
    ctx.strokeStyle = COL.buildingEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
  }

  for (const m of markers) {
    const s = worldToMap(m, view, width, height);
    const colour =
      m.kind === 'keepsake' ? (m.found ? COL.found : COL.keepsake)
        : m.kind === 'vehicle' ? COL.vehicle
          : COL.garage;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(s.x, s.y, m.kind === 'keepsake' ? 5 : 6, 0, Math.PI * 2);
    ctx.fill();
    if (m.kind !== 'keepsake') {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // The player last, as a triangle pointing where they face.
  const p = worldToMap(player, view, width, height);
  ctx.save();
  ctx.translate(p.x, p.y);
  // Screen-space rotation: world facing is atan2(dir.x, dir.z), and +Z is up.
  ctx.rotate(-player.facing);
  ctx.fillStyle = COL.player;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6, 7);
  ctx.lineTo(0, 3.5);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/** Metres represented by a scale bar of the given pixel width. */
export function scaleBarMetres(view: MapView, pixels = 120): number {
  const raw = pixels / view.scale;
  // Snap to something a person would say out loud.
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return steps.find((s) => s >= raw) ?? steps[steps.length - 1];
}

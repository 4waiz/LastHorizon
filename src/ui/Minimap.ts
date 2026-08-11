import * as THREE from 'three';

/**
 * Bottom-left radar.
 *
 * Rotates with the player so "up" is always the way they are facing, which is
 * what makes a radar readable while moving. Roads, buildings and the
 * un-found keepsakes are drawn from world data rather than a baked image, so
 * it stays correct if the layout changes.
 *
 * Redraw is throttled: at 132 px nobody can see the difference between 20 and
 * 60 fps, and the canvas work is pure overhead on the frame budget.
 */

export interface MinimapPoint {
  x: number;
  z: number;
}

export interface MinimapData {
  /** Road centrelines, already thinned. */
  roads: MinimapPoint[][];
  /** Building footprint centres and their rough radius. */
  buildings: Array<MinimapPoint & { r: number }>;
}

/**
 * A thing worth a dot.
 *
 * Every kind draws a **different shape**, not only a different colour. A
 * radar is 132 px of small marks and colour alone is the one channel a
 * colour-blind player does not have — the same argument the Heat numerals
 * setting and the equipped-item underline both make.
 */
export type MinimapMarkerKind = 'keepsake' | 'vehicle' | 'aircraft' | 'objective';

export interface MinimapMarker extends MinimapPoint {
  readonly kind: MinimapMarkerKind;
}

/**
 * What the radar knows beyond the map itself.
 *
 * `search` is where the police believe the player is — never where they
 * actually are, which is the whole design of `Heat`. Drawing it is what turns
 * "you are wanted" from a number into information you can act on: you can see
 * that they are looking in the wrong place and stay out of it.
 */
export interface MinimapOverlay {
  readonly search: { x: number; z: number; radius: number } | null;
  readonly markers: readonly MinimapMarker[];
}

export const EMPTY_OVERLAY: MinimapOverlay = { search: null, markers: [] };

/** World metres visible from the centre to the rim. */
const RANGE = 78;
const REDRAW_INTERVAL = 1 / 20;

const COL = {
  ground: '#cfdcc4',
  road: '#b9bcb6',
  roadEdge: '#e8e2d2',
  building: '#c08a72',
  buildingEdge: '#9a6a55',
  keepsake: '#e3a63e',
  player: '#4a463e',
  rim: 'rgba(248,244,234,0.92)',
  vehicle: '#6f8fb0',
  aircraft: '#7d9b74',
  objective: '#c2705a',
  search: 'rgba(180, 88, 70, 0.20)',
  searchEdge: 'rgba(180, 88, 70, 0.75)',
};

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly size: number;
  private readonly centre: number;
  private readonly scale: number;
  private accum = 0;
  private pulse = 0;

  constructor(
    private data: MinimapData,
    private readonly keepsakes: () => Array<MinimapPoint & { found: boolean }>,
    /** Police search area and the other markers. Defaults to nothing. */
    private readonly overlay: () => MinimapOverlay = () => EMPTY_OVERLAY,
  ) {
    this.canvas = document.getElementById('minimap') as HTMLCanvasElement;
    this.ctx = this.canvas?.getContext('2d') ?? null;
    this.size = this.canvas?.width ?? 320;
    this.centre = this.size / 2;
    this.scale = (this.size / 2 - 6) / RANGE;
  }

  setVisible(on: boolean): void {
    if (this.canvas) this.canvas.style.display = on ? 'block' : 'none';
  }

  /**
   * Point the radar at a different zone's roads and buildings.
   *
   * Without this it keeps drawing the village after travelling, because the
   * data was captured once at construction.
   */
  setData(data: MinimapData): void {
    this.data = data;
  }

  update(dt: number, player: THREE.Vector3, facing: number): void {
    if (!this.ctx) return;
    this.pulse += dt;
    this.accum += dt;
    if (this.accum < REDRAW_INTERVAL) return;
    this.accum = 0;
    this.draw(player, facing);
  }

  /**
   * One marker, in world space, inside the rotated transform.
   *
   * A square for a vehicle, a triangle for the aeroplane, a diamond for an
   * objective. The shapes are drawn counter-rotated by nothing — they sit in
   * the map's frame and turn with it, which is correct for a radar: a
   * north-up icon on a rotating field reads as a bug.
   */
  private marker(
    ctx: CanvasRenderingContext2D,
    m: MinimapMarker,
    s: number,
    beat: number,
  ): void {
    const r = 3.8 / s;
    ctx.beginPath();
    switch (m.kind) {
      case 'vehicle':
        ctx.rect(m.x - r * 0.8, m.z - r * 0.8, r * 1.6, r * 1.6);
        ctx.fillStyle = COL.vehicle;
        break;
      case 'aircraft':
        ctx.moveTo(m.x, m.z - r);
        ctx.lineTo(m.x + r, m.z + r * 0.8);
        ctx.lineTo(m.x - r, m.z + r * 0.8);
        ctx.closePath();
        ctx.fillStyle = COL.aircraft;
        break;
      case 'objective':
        ctx.moveTo(m.x, m.z - r);
        ctx.lineTo(m.x + r, m.z);
        ctx.lineTo(m.x, m.z + r);
        ctx.lineTo(m.x - r, m.z);
        ctx.closePath();
        ctx.fillStyle = COL.objective;
        break;
      default:
        ctx.arc(m.x, m.z, r * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = COL.keepsake;
        break;
    }
    // Only the objective pulses. If everything pulsed, nothing would.
    ctx.globalAlpha = m.kind === 'objective' ? 0.5 + 0.5 * beat : 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.4 / s;
    ctx.strokeStyle = 'rgba(60,54,46,0.55)';
    ctx.stroke();
  }

  private draw(player: THREE.Vector3, facing: number): void {
    const ctx = this.ctx!;
    const c = this.centre;
    const s = this.scale;

    ctx.clearRect(0, 0, this.size, this.size);

    // Circular field
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COL.ground;
    ctx.fillRect(0, 0, this.size, this.size);

    // World -> radar: translate by the player, then rotate so facing is up.
    ctx.translate(c, c);
    ctx.rotate(facing);
    ctx.translate(-player.x * s, -player.z * s);
    ctx.scale(s, s);

    // Roads, drawn twice for a soft edge line.
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? COL.roadEdge : COL.road;
      ctx.lineWidth = pass === 0 ? 15 / s : 11 / s;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const line of this.data.roads) {
        ctx.beginPath();
        line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
        ctx.stroke();
      }
    }

    // Buildings
    ctx.lineWidth = 2 / s;
    ctx.strokeStyle = COL.buildingEdge;
    ctx.fillStyle = COL.building;
    for (const b of this.data.buildings) {
      const dx = b.x - player.x;
      const dz = b.z - player.z;
      if (dx * dx + dz * dz > (RANGE + b.r) ** 2) continue;
      ctx.beginPath();
      ctx.rect(b.x - b.r, b.z - b.r, b.r * 2, b.r * 2);
      ctx.fill();
      ctx.stroke();
    }

    const beat = 0.55 + 0.45 * Math.sin(this.pulse * 3.0);
    const over = this.overlay();

    /*
     * Where the police think you are.
     *
     * Drawn over the map rather than under it, because it is information
     * about the present rather than part of the world — and drawn at all
     * because `Heat` is built on the police being *wrong*. A search circle
     * you can see is a search circle you can walk around; a wanted number on
     * its own is just pressure.
     */
    if (over.search) {
      const dx = over.search.x - player.x;
      const dz = over.search.z - player.z;
      // Cull only when the whole circle is off the rim, not its centre — the
      // useful case is standing outside an area that is still on screen.
      if (dx * dx + dz * dz < (RANGE + over.search.radius) ** 2) {
        ctx.beginPath();
        ctx.arc(over.search.x, over.search.z, over.search.radius, 0, Math.PI * 2);
        ctx.fillStyle = COL.search;
        ctx.fill();
        ctx.setLineDash([6 / s, 5 / s]);
        ctx.lineWidth = 2.5 / s;
        ctx.strokeStyle = COL.searchEdge;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Keepsakes still out there, pulsing so they read as objectives.
    for (const k of this.keepsakes()) {
      if (k.found) continue;
      const dx = k.x - player.x;
      const dz = k.z - player.z;
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      ctx.beginPath();
      ctx.arc(k.x, k.z, 3.4 / s, 0, Math.PI * 2);
      ctx.fillStyle = COL.keepsake;
      ctx.globalAlpha = 0.45 + 0.55 * beat;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Everything else you own or are heading for. Shape carries the meaning.
    for (const m of over.markers) {
      const dx = m.x - player.x;
      const dz = m.z - player.z;
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      this.marker(ctx, m, s, beat);
    }
    ctx.restore();

    // Player arrow, always centred and pointing up.
    ctx.save();
    ctx.translate(c, c);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fillStyle = COL.player;
    ctx.fill();
    ctx.restore();

    // Rim and the north tick
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = COL.rim;
    ctx.stroke();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(facing);
    ctx.beginPath();
    ctx.moveTo(0, -(c - 7));
    ctx.lineTo(0, -(c - 16));
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c2705a';
    ctx.stroke();
    ctx.restore();
  }
}

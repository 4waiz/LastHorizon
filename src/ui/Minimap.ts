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
    private readonly data: MinimapData,
    private readonly keepsakes: () => Array<MinimapPoint & { found: boolean }>,
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

  update(dt: number, player: THREE.Vector3, facing: number): void {
    if (!this.ctx) return;
    this.pulse += dt;
    this.accum += dt;
    if (this.accum < REDRAW_INTERVAL) return;
    this.accum = 0;
    this.draw(player, facing);
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

    // Keepsakes still out there, pulsing so they read as objectives.
    const beat = 0.55 + 0.45 * Math.sin(this.pulse * 3.0);
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

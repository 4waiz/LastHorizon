import * as THREE from 'three';
import { QualityPreset } from './Settings';
import type { RendererBackend, RendererKind } from './RendererBackend';

/**
 * WebGL renderer setup.
 *
 * Neutral tone mapping rather than ACES: it rolls off highlights without the
 * hue shift ACES puts into warm sunlight, which matters when the whole look
 * depends on flat, authored colour.
 */
export class Renderer implements RendererBackend {
  readonly kind: RendererKind = 'webgl2';
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  private maxPixelRatio = 2;

  constructor(canvas: HTMLCanvasElement, preset: QualityPreset) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = preset.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0xd5e3e8, 1);
    // The composer issues several render() calls per frame and each one would
    // reset the counters, leaving the debug readout showing only the final
    // fullscreen pass. Reset once per frame instead.
    this.renderer.info.autoReset = false;
    this.applyQuality(preset);
  }

  beginFrame(): void {
    this.renderer.info.reset();
  }

  applyQuality(preset: QualityPreset): void {
    this.maxPixelRatio = preset.pixelRatio;
    this.renderer.shadowMap.enabled = preset.shadowsEnabled;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  /** True if the drawing buffer changed size. */
  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const needW = Math.floor(w * dpr);
    const needH = Math.floor(h * dpr);
    if (this.canvas.width === needW && this.canvas.height === needH) return false;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    return true;
  }

  get size(): { width: number; height: number } {
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
  }

  get info(): string {
    const i = this.renderer.info;
    return `${i.render.calls} calls · ${(i.render.triangles / 1000).toFixed(0)}k tris`;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

import * as THREE from 'three';
import type { QualityPreset } from './Settings';
import { Renderer } from './Renderer';
import { featureFlags } from './FeatureFlags';

/**
 * The rendering surface, behind an interface.
 *
 * Phase 1 introduces the seam without moving the game onto a new backend.
 * WebGL2 remains the release default and, today, the only implementation —
 * see docs/adr/0001-renderer-backend.md. In short: the toon look is built on
 * shared materials patched through `onBeforeCompile`, and WebGPURenderer does
 * not run that callback. Swapping backends would silently drop the banding,
 * wind and occluder-fade shaders, which is a visual regression, not a port.
 *
 * The seam exists so a future TSL/node-material backend can be added and
 * measured against the same screenshots and tests, rather than to suggest one
 * is ready.
 */
export type RendererKind = 'webgl2' | 'webgpu';

export interface RendererBackend {
  readonly kind: RendererKind;
  /**
   * The underlying three.js renderer. Typed as WebGLRenderer because that is
   * what every consumer (post-processing, portal render targets, `info`)
   * currently requires; a second backend would have to widen this
   * deliberately rather than by accident.
   */
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  beginFrame(): void;
  applyQuality(preset: QualityPreset): void;
  resize(): boolean;
  readonly size: { width: number; height: number };
  readonly info: string;
  dispose(): void;
}

export interface BackendChoice {
  backend: RendererBackend;
  /** Set when a requested backend could not be created and we fell back. */
  fellBackFrom?: RendererKind;
  reason?: string;
}

/**
 * Build the renderer backend.
 *
 * `?webgpu=1` is accepted so the fallback path is real and exercised rather
 * than hypothetical. There is no WebGPU implementation yet, so the request is
 * reported and WebGL2 is used — which is precisely the "fails cleanly"
 * behaviour a future backend must preserve.
 */
export function createRendererBackend(
  canvas: HTMLCanvasElement,
  preset: QualityPreset,
): BackendChoice {
  const wantsWebGPU = featureFlags().webgpu;

  if (wantsWebGPU) {
    const reason = hasWebGPU()
      ? 'no WebGPU backend is implemented yet: the toon materials rely on ' +
        'onBeforeCompile, which WebGPURenderer does not run'
      : 'this browser does not expose navigator.gpu';
    console.warn(`[LastHorizon] WebGPU requested but unavailable — using WebGL2 (${reason})`);
    return {
      backend: new Renderer(canvas, preset),
      fellBackFrom: 'webgpu',
      reason,
    };
  }

  return { backend: new Renderer(canvas, preset) };
}

/** Capability probe only — never used to select a backend on its own. */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

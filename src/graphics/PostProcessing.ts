import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * One very light grading pass — vignette, a warm lift in the shadows and a
 * touch of desaturation at the edges of frame.
 *
 * There is deliberately no bloom or DOF: the reference look is flat and
 * poster-like, and a composer chain is the easiest way to lose 20 fps on a
 * laptop for an effect nobody asked for. On anything below High quality the
 * composer is skipped entirely and the scene renders straight to the canvas.
 */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.30 },
    uWarmth: { value: 0.045 },
    uEdgeDesat: { value: 0.16 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uWarmth;
    uniform float uEdgeDesat;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float r = dot(d, d);

      // warm the shadows a little; summer light bounces off warm ground
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb += vec3(uWarmth, uWarmth * 0.55, -uWarmth * 0.35) * (1.0 - luma);

      // gentle corner desaturation keeps focus on the character
      float edge = smoothstep(0.06, 0.42, r);
      c.rgb = mix(c.rgb, vec3(luma), edge * uEdgeDesat);

      c.rgb *= 1.0 - uVignette * smoothstep(0.05, 0.62, r);
      gl_FragColor = c;
    }
  `,
};

export class PostProcessing {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  enabled = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on && !this.composer) this.create();
    if (!on) this.destroy();
  }

  private create(): void {
    try {
      const composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(this.scene, this.camera);
      composer.addPass(this.renderPass);
      composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      const size = this.renderer.getSize(new THREE.Vector2());
      composer.setSize(size.x, size.y);
      composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer = composer;
    } catch (err) {
      console.warn('[LastHorizon] post-processing unavailable, rendering direct', err);
      this.enabled = false;
      this.composer = null;
    }
  }

  private destroy(): void {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    if (this.renderPass) this.renderPass.camera = camera;
  }

  /**
   * Scale the warm shadow lift with daylight.
   *
   * The lift is measured against (1 - luma), so at night — when almost the
   * whole frame is dark — it applies everywhere at once and turns the scene
   * olive. It only makes sense as a daytime bounce-light cue.
   */
  setDaylight(dayFactor: number): void {
    GradeShader.uniforms.uWarmth.value = 0.012 + dayFactor * 0.034;
    GradeShader.uniforms.uEdgeDesat.value = 0.06 + dayFactor * 0.10;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.composer?.setPixelRatio(pixelRatio);
    this.composer?.setSize(width, height);
  }

  render(): void {
    if (this.enabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.destroy();
  }
}

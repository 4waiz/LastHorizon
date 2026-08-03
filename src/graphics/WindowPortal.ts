import * as THREE from 'three';

/**
 * Live view through the interior windows.
 *
 * The interior room sits 600 m above the terrain, so its windows would
 * otherwise look out onto nothing. This renders the *outdoor* world into a
 * texture from a camera that mirrors the player's own view, offset by the
 * rigid transform between the room and an anchor point down in the world.
 *
 * Because that offset is a rigid transform (translation plus a yaw) and the
 * projection matrix is shared with the main camera, sampling the result in
 * screen space is geometrically exact: the view slides and parallaxes
 * correctly as you move around the room, the way a real window does.
 */

const PORTAL_VERT = /* glsl */ `
varying vec4 vScreen;
void main() {
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vScreen = p;
  gl_Position = p;
}
`;

const PORTAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tPortal;
uniform vec3 uTint;
uniform float uHaze;
varying vec4 vScreen;

void main() {
  // Perspective divide to screen UV — the same pixel the main camera would
  // have drawn had the wall not been there.
  vec2 uv = (vScreen.xy / vScreen.w) * 0.5 + 0.5;
  vec3 col = texture2D(tPortal, clamp(uv, 0.0, 1.0)).rgb;
  // A breath of glass: slight tint and haze so it still reads as a pane.
  col = mix(col, uTint, uHaze);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class WindowPortal {
  private target: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.PerspectiveCamera();
  readonly material: THREE.ShaderMaterial;

  /** Rigid offset from room space down into the world. */
  private readonly anchor = new THREE.Vector3();
  private yaw = 0;

  private readonly offset = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private scale = 0.5;

  constructor(width: number, height: number) {
    this.target = this.makeTarget(width, height);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PORTAL_VERT,
      fragmentShader: PORTAL_FRAG,
      uniforms: {
        tPortal: { value: this.target.texture },
        uTint: { value: new THREE.Color(0xdfeaf0) },
        uHaze: { value: 0.10 },
      },
      fog: false,
    });
  }

  private makeTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(
      Math.max(2, Math.floor(width * this.scale)),
      Math.max(2, Math.floor(height * this.scale)),
      {
        // Half float: the scene is rendered linear and untonemapped into the
        // target, so values above 1 must survive until the main pass.
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      },
    );
    return rt;
  }

  resize(width: number, height: number): void {
    this.target.setSize(
      Math.max(2, Math.floor(width * this.scale)),
      Math.max(2, Math.floor(height * this.scale)),
    );
  }

  setQuality(scale: number): void {
    this.scale = scale;
  }

  /**
   * Place the room's window view in the world.
   *
   * @param roomOrigin where the interior cell actually lives
   * @param anchor     the spot in the world the room should appear to occupy
   * @param yaw        rotation applied about that anchor
   */
  setAnchor(roomOrigin: THREE.Vector3, anchor: THREE.Vector3, yaw: number): void {
    this.anchor.copy(anchor);
    this.yaw = yaw;
    // offset = T(anchor) * Ry(yaw) * T(-roomOrigin)
    this.offset
      .makeTranslation(anchor.x, anchor.y, anchor.z)
      .multiply(this.tmp.makeRotationY(yaw))
      .multiply(this.tmp.makeTranslation(-roomOrigin.x, -roomOrigin.y, -roomOrigin.z));
  }

  /**
   * Render the outdoor world from the mirrored viewpoint.
   * `hidden` objects are suppressed for the pass and restored afterwards.
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    main: THREE.PerspectiveCamera,
    hidden: THREE.Object3D[],
    onCameraReady?: (cam: THREE.PerspectiveCamera) => void,
  ): void {
    // Share the main camera's lens exactly; the screen-space sample depends
    // on both cameras agreeing about projection.
    this.camera.fov = main.fov;
    this.camera.aspect = main.aspect;
    this.camera.near = main.near;
    this.camera.far = main.far;
    this.camera.projectionMatrix.copy(main.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(main.projectionMatrixInverse);

    main.updateMatrixWorld();
    this.camera.matrixWorld.multiplyMatrices(this.offset, main.matrixWorld);
    this.camera.matrixWorld.decompose(
      this.camera.position,
      this.camera.quaternion,
      this.camera.scale,
    );
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.camera.matrixWorldAutoUpdate = false;

    onCameraReady?.(this.camera);

    const restore = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prevTarget);

    hidden.forEach((o, i) => {
      o.visible = restore[i];
    });
  }

  get cameraPosition(): THREE.Vector3 {
    return this.camera.position;
  }

  get anchorPoint(): THREE.Vector3 {
    return this.anchor;
  }

  get anchorYaw(): number {
    return this.yaw;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}

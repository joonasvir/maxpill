import * as THREE from 'three';

// A cursor drawn INTO the WebGL canvas rather than set with CSS.
//
// This is not decoration — it is the only way it can exist on a recording.
// `canvas.captureStream()` captures the canvas, and the operating system's
// pointer is composited by the window server long after that, so a CSS cursor
// is invisible in every exported clip. Rendering it as geometry puts it in the
// frame.
//
// It draws in its own orthographic pass AFTER the composer, so bloom and depth
// of field never touch it: a defocused cursor reads as a bug, not as style.

export class BigCursor {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);
  private mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;

  /** where the pointer actually is, in CSS pixels from the top-left */
  readonly target = new THREE.Vector2(-9999, -9999);
  /** where it is drawn — trails the target, which is the whole point */
  private pos = new THREE.Vector2(-9999, -9999);

  size = 150;
  /** 0 = frozen, 1 = rigidly locked to the pointer */
  smoothing = 0.16;
  private opacity = 0;
  private wanted = 0;
  /** exposed for debugging: is the sprite actually on screen right now */
  get debug() {
    return { opacity: this.opacity, visible: this.mesh.visible, pos: this.pos.toArray(),
             hasMap: !!(this.mat.map && this.mat.map.image) };
  }

  constructor(url: string) {
    const tex = new THREE.TextureLoader().load(url, () => {
      this.mat.needsUpdate = true;
    });
    // NEAREST on both, and no mipmaps. The source is 64px being drawn at ~150,
    // so linear filtering would smooth away the exact pixel edges that make it
    // read as a pixel cursor at all.
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;

    this.mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
      toneMapped: false, // it is UI, not part of the lit scene
      // DoubleSide is REQUIRED, not defensive. The quad is mirrored on Y to
      // cancel the screen-space camera's flipped axis, and a negative scale
      // inverts triangle winding — so with FrontSide the sprite is back-facing
      // and culled. It reports visible at full opacity and draws nothing.
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.scene.add(this.mesh);
    this.camera.position.z = 10; // keep the quad comfortably inside the frustum
  }

  setVisible(v: boolean) {
    this.wanted = v ? 1 : 0;
  }

  /** Jump without easing — used when the pointer re-enters, so it does not
   *  come flying in from wherever it was left. */
  warp(x: number, y: number) {
    this.target.set(x, y);
    this.pos.set(x, y);
  }

  move(x: number, y: number) {
    this.target.set(x, y);
  }

  update(dt: number, w: number, h: number) {
    // framerate-independent exponential follow: the same weight of trail on a
    // 120Hz phone and a 60Hz laptop
    const k = 1 - Math.pow(1 - THREE.MathUtils.clamp(this.smoothing, 0.01, 1), dt * 60);
    this.pos.lerp(this.target, k);
    this.opacity += (this.wanted - this.opacity) * (1 - Math.pow(0.001, dt));
    this.mat.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01;

    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = 0;
    this.camera.bottom = h;
    this.camera.updateProjectionMatrix();

    // the arrow's tip is its anchor: the art has the point near the top-left,
    // so the quad is offset by half its size rather than centred on the pointer
    const s = this.size;
    // NEGATIVE Y. The camera is set up in screen space (top=0, bottom=h), which
    // inverts the vertical axis, so an unflipped quad renders the art upside
    // down. Mirroring the mesh cancels it.
    this.mesh.scale.set(s, -s, 1);
    this.mesh.position.set(this.pos.x + s * 0.34, this.pos.y + s * 0.30, 0);
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.mesh.visible) return;
    const prevAutoClear = renderer.autoClear;
    // Bind the CANVAS explicitly. EffectComposer can leave one of its own
    // buffers bound after the final pass, in which case this overlay renders
    // correctly into a texture nobody ever looks at — the sprite reports
    // visible with full opacity and simply is not on screen.
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}

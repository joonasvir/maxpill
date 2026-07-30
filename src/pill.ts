import * as THREE from 'three';
import { loadFont, buildText3D } from './text3d';

// The Wabi Max tag is a 115.2 × 53.31 capsule — an aspect of 2.161:1, and the
// same silhouette a pharmaceutical capsule has. That coincidence is the whole
// premise here, so the proportion is taken from the Figma spec (node
// 18562:36454) rather than eyeballed off the reference photograph.
export const PILL_ASPECT = 115.2 / 53.31;

export type Shell =
  | 'glass' | 'prism' | 'spectral' | 'oil' | 'gold' | 'chrome' | 'molten' | 'matte' | 'frosted' | 'tinted';
export const SHELL_NAMES: Shell[] = [
  'glass', 'prism', 'spectral', 'oil', 'gold', 'chrome', 'molten', 'matte', 'frosted', 'tinted',
];

// Spectral is NOT dispersion. Physical dispersion splits a refracted ray and
// shows up as a thin fringe on edges; this reference is the opposite — a broad,
// soft spectrum filling the whole body. That is an emissive gradient driven by
// the surface normal, so it is authored rather than simulated, and it needs its
// own uniforms.
export const spectralUniforms = {
  uHue: { value: 0.0 },
  uSpread: { value: 1.0 },
  uGlow: { value: 1.0 },
};

function injectSpectral(mat: THREE.Material) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uHue = spectralUniforms.uHue;
    shader.uniforms.uSpread = spectralUniforms.uSpread;
    shader.uniforms.uGlow = spectralUniforms.uGlow;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
      #include <emissivemap_fragment>
      {
        // Ramp along the VIEW-space normal, so the spectrum stays pinned to the
        // form's shading rather than sliding around as the object turns — the
        // reference reads as a lit body, not as a decal.
        vec3 vn = normalize(vNormal);
        vec3 vv = normalize(vViewPosition);
        float t = (vn.y * 0.52 + 0.5) + vn.x * 0.10;
        vec3 spec = 0.5 + 0.5 * cos(6.28318530718 * (t * uSpread + vec3(0.00, 0.33, 0.67)) + uHue * 6.28318530718);
        spec = pow(clamp(spec, 0.0, 1.0), vec3(0.80));

        // grazing angles fall to a deep violet — this is what draws the dark
        // rim that separates each form from the one behind it
        float fres = pow(1.0 - clamp(dot(vn, vv), 0.0, 1.0), 2.4);
        spec = mix(spec, spec * vec3(0.30, 0.16, 0.70), fres * 0.9);

        totalEmissiveRadiance += spec * uGlow;
      }`
    );
  };
  mat.customProgramCacheKey = () => 'mp-displace-spectral';
}

// Shared uniforms for the displacement injection. One object, mutated in place,
// so every material that opts in animates off the same clock.
// uPhase runs 0→1 and wraps. The noise is sampled along a CIRCLE in that
// phase rather than drifting linearly with time, so the surface returns to
// exactly its starting shape every cycle. Linear time can never loop; this is
// what lets a melt clip be seamless without freezing the animation.
// The orb→pill reveal. A capsule IS a sphere whose two hemispheres have been
// pulled apart along X, so the whole transition is one scalar: how far apart
// they sit. uStretch 0 gives a mathematically perfect orb, 1 gives the tag's
// proportion, and every value between is a real capsule — no geometry rebuild,
// no ellipsoid cheat. Cap normals are unchanged by the separation and cylinder
// normals are perpendicular to X, so the shading stays correct throughout.
export const revealUniforms = {
  uStretch: { value: 1 },
  uLabelReveal: { value: 1 },
  // uWarp distorts the glyph's own silhouette as it arrives. Warping the ALPHA
  // lookup rather than fading opacity is what makes it read as type forming
  // inside the glass instead of type cross-dissolving on top of it — the
  // letterforms genuinely deform, then resolve.
  uWarp: { value: 0 },
  uWarpPhase: { value: 0 },
};

export const displaceUniforms = {
  uPhase: { value: 0 },
  uAmp: { value: 0 },
  uFreq: { value: 1.4 },
};

// Melting the surface is a VERTEX problem, not a texture one — a normal map
// alone keeps the silhouette hard, and the whole point of the molten reference
// is that the outline itself bulges. So displacement is injected into
// MeshPhysicalMaterial rather than replacing it: we keep three's entire
// transmission/dispersion pipeline and only move the vertices.
//
// The normal has to be rebuilt or the lighting stays flat against a bumpy
// silhouette. Two extra noise taps along a tangent basis give a good enough
// gradient without a second geometry pass.
function injectDisplace(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = displaceUniforms.uPhase;
    shader.uniforms.uAmp = displaceUniforms.uAmp;
    shader.uniforms.uFreq = displaceUniforms.uFreq;
    shader.uniforms.uStretch = revealUniforms.uStretch;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uPhase;
        uniform float uAmp;
        uniform float uFreq;
        uniform float uStretch;
        attribute float aStretch;

        vec3 mp_hash3(vec3 p) {
          p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                   dot(p, vec3(269.5, 183.3, 246.1)),
                   dot(p, vec3(113.5, 271.9, 124.6)));
          return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
        }
        float mp_noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dot(mp_hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                             dot(mp_hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                         mix(dot(mp_hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                             dot(mp_hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
                     mix(mix(dot(mp_hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                             dot(mp_hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                         mix(dot(mp_hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                             dot(mp_hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
        }
        float mp_field(vec3 p) {
          // travel a CIRCLE through the noise field instead of a straight line:
          // at phase 0 and phase 1 the sample point is identical, so the whole
          // surface animation is seamless by construction
          float a = uPhase * 6.28318530718;
          vec3 flow = vec3(cos(a), sin(a), 0.0) * 0.60;
          float n  = mp_noise(p * uFreq + flow);
          n += 0.5 * mp_noise(p * uFreq * 2.1 - flow * 1.35 + 11.0);
          return n * uAmp;
        }`
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        {
          // collapse the cylinder separation first, so the melt is evaluated on
          // the shape actually being drawn rather than on the full-length one
          transformed.x += aStretch * (uStretch - 1.0);
          vec3 nrm = normalize(objectNormal);
          transformed += nrm * mp_field(position);

          // rebuild the normal from the field gradient across a tangent basis
          vec3 t1 = normalize(abs(nrm.x) < 0.9 ? cross(nrm, vec3(1.0, 0.0, 0.0))
                                               : cross(nrm, vec3(0.0, 1.0, 0.0)));
          vec3 t2 = cross(nrm, t1);
          float e = 0.045;
          float d0 = mp_field(position);
          float d1 = mp_field(position + t1 * e);
          float d2 = mp_field(position + t2 * e);
          objectNormal = normalize(nrm - (t1 * (d1 - d0) + t2 * (d2 - d0)) / e);
          #ifdef USE_TANGENT
            vObjectNormal = objectNormal;
          #endif
          vNormal = normalize(normalMatrix * objectNormal);
        }`
      );
  };
  // a distinct key or three reuses the un-displaced program from its cache
  mat.customProgramCacheKey = () => 'mp-displace';
}

/** Capsule laid along +X, carrying the per-vertex cylinder offset the reveal
 *  needs. `aStretch` is the portion of a vertex's x that comes from the two
 *  halves being separated; the caps' own contribution is left alone, which is
 *  what keeps the ends perfectly hemispherical at every stretch value. */
function buildCapsule(radius: number, cyl: number) {
  const g = new THREE.CapsuleGeometry(radius, cyl, 48, 128);
  g.rotateZ(Math.PI / 2);
  const pos = g.attributes.position;
  const half = cyl / 2;
  const a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    a[i] = THREE.MathUtils.clamp(pos.getX(i), -half, half);
  }
  g.setAttribute('aStretch', new THREE.BufferAttribute(a, 1));
  return g;
}

export type Body = 'capsule' | 'slab';
export const BODY_NAMES: Body[] = ['capsule', 'slab'];

/**
 * A FLAT pill with depth rather than a body of revolution: the 2D stadium
 * outline extruded and heavily bevelled.
 *
 * The bevel does all the work — it is the rounded edge that reads as a thick
 * lozenge of glass. Taking it to ~40% of the half-height gives the pillowed
 * section without the shape quietly becoming a capsule again, which is what
 * happens if you let it approach the full radius.
 *
 * ExtrudeGeometry insets the bevel from the outline, so the silhouette stays
 * exactly W x H and the proportion still comes from the Figma spec.
 */
function buildSlab(radius: number, cyl: number, depth: number) {
  const r = radius;
  const W = cyl + r * 2;
  const w = Math.max(0.0001, W / 2 - r);

  // Sampled polyline rather than lineTo + absarc. The arc version put a
  // duplicate vertex where each arc met its adjoining straight, and the beveller
  // turns a zero-length segment into a visible notch in the edge — the kind of
  // artefact that looks like a modelling mistake rather than a seam.
  const pts: THREE.Vector2[] = [];
  const CAP = 40;
  for (let i = 0; i <= CAP; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / CAP;
    pts.push(new THREE.Vector2(w + Math.cos(a) * r, Math.sin(a) * r));
  }
  for (let i = 0; i <= CAP; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / CAP;
    pts.push(new THREE.Vector2(-w + Math.cos(a) * r, Math.sin(a) * r));
  }
  const sh = new THREE.Shape(pts);

  const bevel = Math.min(radius * 0.4, depth * 0.45);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(0.02, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 10,
    curveSegments: 48,
  });
  g.center();
  g.computeVertexNormals();

  // Same aStretch contract as the capsule so the orb reveal still works.
  // Collapsing the straight section turns the slab into a rounded square rather
  // than a sphere, which is the right analogue for a flat body.
  const pos = g.attributes.position;
  const a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    a[i] = THREE.MathUtils.clamp(pos.getX(i), -w, w);
  }
  g.setAttribute('aStretch', new THREE.BufferAttribute(a, 1));
  return g;
}

export interface PillOpts {
  radius: number;
  aspect: number;
}

// ── "Max" as a bevelled height field ────────────────────────────────────────
// A flat plane with a metal material reflects one direction of the environment
// and comes out as a single dead colour. What sells the bevelled-chrome look in
// the Martian-language reference is curvature: the surface has to sweep through
// the environment across each stroke. So the label is a real inflated surface —
// an inner distance transform of the glyph mask, smoothstepped into a dome, and
// differentiated into a normal map. Edges then pick up the whole spectrum.

function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;

  // chamfer 5-7-11, forward then backward — close enough to euclidean for a
  // bevel and a great deal cheaper than an exact transform
  const a = 5, b = 7, c = 11;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? INF : d[y * w + x]);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      m = Math.min(m, at(x - 1, y - 2) + c, at(x + 1, y - 2) + c);
      m = Math.min(m, at(x - 2, y - 1) + c, at(x - 1, y - 1) + b, at(x, y - 1) + a, at(x + 1, y - 1) + b, at(x + 2, y - 1) + c);
      m = Math.min(m, at(x - 1, y) + a);
      d[i] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      m = Math.min(m, at(x - 1, y + 2) + c, at(x + 1, y + 2) + c);
      m = Math.min(m, at(x - 2, y + 1) + c, at(x - 1, y + 1) + b, at(x, y + 1) + a, at(x + 1, y + 1) + b, at(x + 2, y + 1) + c);
      m = Math.min(m, at(x + 1, y) + a);
      d[i] = m;
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= a; // back into pixel units
  return d;
}

export interface TextMaps {
  alpha: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  aspect: number;
}

export function makeTextMaps(text: string, aspect: number, bevelPx = 16): TextMaps {
  // This is only the FALLBACK now — the extruded outlines supersede it as soon
  // as the font parses. It does not need to be high resolution, and the
  // distance transform is O(W·H) on the main thread before first paint, so
  // dropping from 512 to 288 removes roughly two thirds of that cost.
  const H = 288;
  const W = Math.round(H * aspect);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);

  // 37.9px on a 53.31px pill — the tag's own ratio, held at any size
  const fs = H * (37.9 / 53.31);
  g.font = `italic 400 ${fs}px Selecta, system-ui`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  if ('letterSpacing' in g) (g as CanvasRenderingContext2D).letterSpacing = `${-0.379 * (H / 53.31)}px`;
  g.fillText(text, W / 2, H / 2 + H * 0.03);

  const img = g.getImageData(0, 0, W, H);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;

  const dist = distanceTransform(mask, W, H);

  // dome: 0 at the outline, 1 at the stroke spine
  const hgt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const t = Math.min(1, dist[i] / bevelPx);
    hgt[i] = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))); // circular, not linear — a linear ramp reads as a chamfer, this reads as inflation
  }

  const ncv = document.createElement('canvas');
  ncv.width = W;
  ncv.height = H;
  const nctx = ncv.getContext('2d')!;
  const nimg = nctx.createImageData(W, H);
  const at = (x: number, y: number) => hgt[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const strength = 3.2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1 / bevelPx * 12;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const i = (y * W + x) * 4;
      nimg.data[i] = (nx * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const alpha = new THREE.CanvasTexture(cv);
  alpha.colorSpace = THREE.NoColorSpace;
  alpha.anisotropy = 8;
  const normal = new THREE.CanvasTexture(ncv);
  normal.colorSpace = THREE.NoColorSpace;
  normal.anisotropy = 8;

  return { alpha, normal, aspect };
}

// ── the capsule ─────────────────────────────────────────────────────────────

export class Pill {
  readonly group = new THREE.Group();
  readonly shellMesh: THREE.Mesh;
  /** flat alpha-cutout fallback, shown only until the outlines load */
  readonly label: THREE.Mesh;
  /** the real extruded label, once the font has parsed */
  label3d: THREE.Mesh | null = null;
  private font: any = null;
  text = 'Max';
  depth = 0.02;
  bevel = 0.002;
  body: Body = 'capsule';
  slabDepth = 0.6;

  radius: number;
  /** half-length of the capsule's inner segment, local +X/-X */
  half: number;

  // widened from CapsuleGeometry: the body can now be an extruded slab too
  private geo: THREE.BufferGeometry;
  private maps: TextMaps;

  constructor(opts: PillOpts) {
    this.radius = opts.radius;
    const total = opts.radius * 2 * opts.aspect;
    const cyl = Math.max(0.001, total - opts.radius * 2);
    this.half = cyl / 2;

    // CapsuleGeometry runs along +Y; the tag is horizontal, so the geometry is
    // rotated once here and every downstream calculation can assume the axis
    // is local X.
    this.geo = buildCapsule(opts.radius, cyl);

    this.shellMesh = new THREE.Mesh(this.geo, makeShell('glass'));
    this.shellMesh.renderOrder = 2;
    this.group.add(this.shellMesh);

    this.maps = makeTextMaps('Max', PILL_ASPECT);
    const [lw, lh] = this.labelSize(total);
    const labelMat = makeLabelMat(this.maps);
    injectLabelReveal(labelMat);
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), labelMat);
    this.label.renderOrder = 1;
    this.group.add(this.label);

    // Real outlines arrive asynchronously; the cutout plane above is what is on
    // screen until they do, so the first frame is never empty.
    this.ready = this.upgradeToOutlines();
  }

  /** resolves once the real outlines are in (or definitively are not) */
  readonly ready: Promise<void>;

  private async upgradeToOutlines() {
    try {
      const font = await loadFont('fonts/Selecta-Italic.otf');
      this.font = font;
      this.buildLabel3D();
    } catch {
      /* keep the cutout plane — still legible, just not as crisp */
    }
  }

  /** Rebuild the extruded label at the current depth/bevel/size. */
  buildLabel3D() {
    if (!this.font) return;
    const total = this.radius * 2 * (this.half * 2 + this.radius * 2) / (this.radius * 2);
    const [lw] = this.labelSize(this.half * 2 + this.radius * 2);
    const built = buildText3D(this.font, this.text, {
      depth: this.depth,
      bevel: this.bevel,
      size: Math.min(lw / built0Aspect(this.font, this.text), this.radius * 2 * 0.44),
    });
    const old = this.label3d;
    // rebuilt per body: the slab needs glass lettering, the capsule needs metal
    old?.material && (old.material as THREE.Material).dispose();
    const mat = makeSolidLabelMat(this.body === 'slab');
    const mesh = new THREE.Mesh(built.geo, mat);
    if (old) {
      old.geometry.dispose();
      this.group.remove(old);
    }
    this.label3d = mesh;
    mesh.visible = this.label.visible;
    mesh.scale.copy(this.label.scale);
    this.group.add(mesh);
    this.placeLabel();
    // the flat fallback steps aside once the solid exists
    this.label.visible = false;
    void total;
  }

  /** Fit the label inside the capsule on BOTH axes. Sizing it off the length
   *  alone works at the tag's own proportion and then pushes the plane out
   *  through the wall as soon as the shape is stretched — the radius does not
   *  grow with the aspect. */
  private labelSize(total: number): [number, number] {
    const availW = total * 0.90;
    const availH = this.radius * 2 * 0.78;
    const lw = Math.min(availW, availH * PILL_ASPECT);
    return [lw, lw / PILL_ASPECT];
  }

  setAspect(aspect: number) {
    const total = this.radius * 2 * aspect;
    const cyl = Math.max(0.001, total - this.radius * 2);
    this.half = cyl / 2;
    this.geo.dispose();
    this.geo = this.buildBody(cyl);
    this.shellMesh.geometry = this.geo;

    const [lw, lh] = this.labelSize(total);
    this.label.geometry.dispose();
    this.label.geometry = new THREE.PlaneGeometry(lw, lh);
    this.placeLabel();
  }

  private buildBody(cyl: number) {
    return this.body === 'slab'
      ? buildSlab(this.radius, cyl, this.slabDepth)
      : buildCapsule(this.radius, cyl);
  }

  /** Swap between the round capsule and the flat slab. */
  setBody(body: Body, slabDepth: number) {
    this.body = body;
    this.slabDepth = slabDepth;
    this.geo.dispose();
    this.geo = this.buildBody(this.half * 2);
    this.shellMesh.geometry = this.geo;
    // the label's MATERIAL depends on the body, so it has to be rebuilt too
    this.buildLabel3D();
    this.placeLabel();
  }

  /**
   * On a CAPSULE the label is suspended inside, which is what lets it refract
   * through the body and read as a deboss. On a SLAB it sits proud of the front
   * face the way the reference has it — raised glass lettering on the outside,
   * catching its own highlights rather than being read through the thickness.
   */
  placeLabel() {
    const z = this.body === 'slab' ? this.slabDepth * 0.5 : 0;
    this.label.position.z = z;
    if (this.label3d) this.label3d.position.z = z;
  }

  setShell(kind: Shell, env: THREE.Texture | null) {
    const m = makeShell(kind);
    if (env) m.envMap = env;
    (this.shellMesh.material as THREE.Material).dispose();
    this.shellMesh.material = m;
  }

  setLabelText(text: string) {
    this.maps.alpha.dispose();
    this.maps.normal.dispose();
    this.maps = makeTextMaps(text, PILL_ASPECT);
    const m = this.label.material as THREE.MeshPhysicalMaterial;
    m.alphaMap = this.maps.alpha;
    m.normalMap = this.maps.normal;
    m.needsUpdate = true;
  }

  setLabelVisible(v: boolean) {
    if (this.label3d) {
      this.label3d.visible = v;
      this.label.visible = false;
    } else {
      this.label.visible = v;
    }
  }

  /** the mesh the reveal should animate — solid if we have it, else the plane */
  get labelMesh(): THREE.Mesh {
    return this.label3d || this.label;
  }

  setDepth(depth: number, bevel: number) {
    this.depth = depth;
    this.bevel = bevel;
    this.buildLabel3D();
  }
}

export function makeShell(kind: Shell): THREE.MeshPhysicalMaterial {
  const m = buildShell(kind);
  // ORDER IS LOad-BEARING: injectDisplace assigns onBeforeCompile outright,
  // while injectSpectral chains whatever is already there. Spectral must go
  // second or the displacement hook silently replaces it and the body renders
  // black. Displacement is injected into EVERY shell so the melt slider is a
  // property of the object rather than a hidden feature of one material —
  // amplitude 0 costs a few vertex ops and changes nothing.
  injectDisplace(m);
  if (kind === 'spectral') injectSpectral(m);
  return m;
}

function buildShell(kind: Shell): THREE.MeshPhysicalMaterial {
  const base: THREE.MeshPhysicalMaterialParameters = {
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    thickness: 1.15,
    ior: 1.47,
    // three r166+ splits the transmission ray per channel. This is the single
    // parameter that produces the prismatic fringing in the Gao Yang reference;
    // faking it with a chromatic-aberration post pass gives you fringes on the
    // silhouette but not through the body.
    dispersion: 3.4,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.15,
    side: THREE.FrontSide,
  };

  switch (kind) {
    // Threads-mark register: a THIN, high-IOR, very hard glass. Thickness is
    // what kills the rainbow — a thick slab averages the three channel paths
    // back toward white, so the fringe only survives on a shallow one. Paired
    // with the studio env, whose hard-edged softboxes give the edges something
    // with contrast to split.
    case 'prism':
      return new THREE.MeshPhysicalMaterial({
        ...base,
        thickness: 0.30,
        ior: 1.66,
        dispersion: 9.0,
        roughness: 0.0,
        clearcoatRoughness: 0.0,
        envMapIntensity: 1.5,
        iridescence: 0.25,
        iridescenceIOR: 1.5,
      });
    // Champagne metal for the inflated-type look. Not yellow-tinted chrome:
    // the colour sits in the mid warm neutrals and roughness is deliberately
    // well off zero, because a mirror-perfect gold reads as a Christmas
    // bauble. The soft sheen comes from the room, not from the tint.
    case 'gold':
      return new THREE.MeshPhysicalMaterial({
        metalness: 1,
        roughness: 0.155,
        transmission: 0,
        color: new THREE.Color(0xf0dcb4),
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
        envMapIntensity: 1.45,
        side: THREE.FrontSide,
      });
    // Clear glass with the surface actually moving. Slightly thicker and a
    // touch more attenuated than plain glass so the bulges accumulate density
    // and read as a heavy blob rather than a dented shell.
    case 'molten':
      return new THREE.MeshPhysicalMaterial({
        ...base,
        thickness: 1.9,
        ior: 1.52,
        dispersion: 2.2,
        roughness: 0.0,
        attenuationColor: new THREE.Color(0xdfe7ea),
        attenuationDistance: 4.5,
        envMapIntensity: 1.25,
      });
    // A genuinely opaque body. Reaching for transmission with ior 1.0 to fake
    // this is a trap: an IOR of exactly 1 bends nothing, so the ray passes
    // straight through and the object disappears rather than turning solid.
    // Matte cream is a DIFFUSE problem — no transmission, sheen for the waxy
    // edge, and a clearcoat so faint it only wets the surface.
    case 'matte':
      return new THREE.MeshPhysicalMaterial({
        transmission: 0,
        metalness: 0,
        roughness: 0.92,
        color: new THREE.Color(0xf4efe3),
        sheen: 0.55,
        sheenRoughness: 0.85,
        sheenColor: new THREE.Color(0xffffff),
        clearcoat: 0.14,
        clearcoatRoughness: 0.75,
        envMapIntensity: 1.0,
        side: THREE.FrontSide,
      });
    // Soft holographic body: near-black base so the injected emissive spectrum
    // is what you actually see, with a wet clearcoat for the glassy edge.
    case 'spectral':
      return new THREE.MeshPhysicalMaterial({
        transmission: 0,
        metalness: 0,
        roughness: 0.42,
        color: new THREE.Color(0x090909),
        clearcoat: 0.85,
        clearcoatRoughness: 0.16,
        envMapIntensity: 0.55,
        side: THREE.FrontSide,
      });
    // Oil-slick glass: thin-film interference over a dark, highly transmissive
    // body. Iridescence needs a THIN film and a wide thickness range to sweep
    // the full spectrum across the curvature; a narrow range just tints it.
    case 'oil':
      return new THREE.MeshPhysicalMaterial({
        ...base,
        thickness: 0.55,
        ior: 1.58,
        dispersion: 4.5,
        roughness: 0.02,
        iridescence: 1,
        iridescenceIOR: 2.1,
        iridescenceThicknessRange: [100, 900],
        attenuationColor: new THREE.Color(0x2a2036),
        attenuationDistance: 2.2,
        envMapIntensity: 1.6,
      });
    case 'chrome':
      return new THREE.MeshPhysicalMaterial({
        metalness: 1,
        roughness: 0.055,
        transmission: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        iridescence: 1,
        iridescenceIOR: 1.9,
        iridescenceThicknessRange: [120, 780],
        envMapIntensity: 1.6,
        color: 0xffffff,
      });
    case 'frosted':
      return new THREE.MeshPhysicalMaterial({
        ...base,
        roughness: 0.42,
        dispersion: 1.2,
        clearcoatRoughness: 0.3,
        thickness: 1.6,
      });
    case 'tinted':
      return new THREE.MeshPhysicalMaterial({
        ...base,
        attenuationColor: new THREE.Color(0x7fb2ff),
        attenuationDistance: 1.1,
        thickness: 1.7,
        iridescence: 0.45,
        iridescenceIOR: 1.35,
      });
    default:
      return new THREE.MeshPhysicalMaterial(base);
  }
}

// A left-to-right wipe on the label, driven by the same growth. Discarding on
// the alpha-map UV rides on top of the existing cutout, so the label still
// renders in the OPAQUE pass and keeps refracting through the glass — a
// transparent fade here would drop it out of the transmission pass entirely.
function injectLabelReveal(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLabelReveal = revealUniforms.uLabelReveal;
    shader.uniforms.uWarp = revealUniforms.uWarp;
    shader.uniforms.uWarpPhase = revealUniforms.uWarpPhase;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLabelReveal;\nuniform float uWarp;\nuniform float uWarpPhase;')
      .replace(
        '#include <alphamap_fragment>',
        `
        #ifdef USE_ALPHAMAP
          vec2 wuv = vAlphaMapUv;
          if (uWarp > 0.0005) {
            // two crossed low-frequency waves — cheap, and smoother than noise
            // for something that has to resolve to EXACTLY the true glyph
            float n1 = sin(wuv.y * 13.0 + uWarpPhase) + sin(wuv.x * 8.0 - uWarpPhase * 1.31);
            float n2 = cos(wuv.x * 10.0 + uWarpPhase * 0.83) + cos(wuv.y * 6.0 + uWarpPhase);
            wuv += vec2(n1, n2) * uWarp * 0.055;
          }
          diffuseColor.a *= texture2D(alphaMap, wuv).g;
        #endif
        if (vAlphaMapUv.x > uLabelReveal) discard;`
      );
  };
  mat.customProgramCacheKey = () => 'mp-label-reveal';
}

// Solid label: no alphaMap, so no cutout and no staircase. Opaque, therefore
// captured by the transmission pass and refracted through the shell exactly as
// the plane was — but with sides, a bevel and antialiased silhouettes.
/**
 * Two label materials, because the two bodies pose opposite problems.
 *
 * Inside a capsule the label is seen THROUGH glass, so it has to be opaque and
 * bright or the surrounding body swallows it — hence metal.
 *
 * Raised on a slab it is glass sitting on glass, and metal there reads as a
 * flat grey ghost pasted on the front. It needs to be glass itself: its own
 * transmission and a shallow thickness, so each stroke behaves like a bent
 * tube of the same material and catches its own highlight down the spine.
 */
function makeSolidLabelMat(glassy = false) {
  if (glassy) {
    // A HIGHER ior than the body, deliberately. Matching the shell (1.5) made
    // the strokes vanish — identical glass on identical glass has no boundary to
    // see. Pushing to 1.78 with real dispersion and a faint warm attenuation
    // gives each stroke its own refraction and edge colour, which is what makes
    // it read as a separate tube lying on the surface.
    return new THREE.MeshPhysicalMaterial({
      transmission: 1,
      thickness: 0.55,
      ior: 1.78,
      dispersion: 5.0,
      roughness: 0.0,
      metalness: 0,
      attenuationColor: new THREE.Color(0xdfe9c8),
      attenuationDistance: 1.4,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.6,
      side: THREE.FrontSide,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    metalness: 1,
    roughness: 0.12,
    color: 0xffffff,
    iridescence: 0.85,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [180, 620],
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
  });
}

function built0Aspect(font: any, text: string) {
  const p = font.getPath(text, 0, 0, 100);
  const bb = p.getBoundingBox();
  return (bb.x2 - bb.x1) / Math.max(1e-6, bb.y2 - bb.y1);
}

function makeLabelMat(maps: TextMaps) {
  // alphaTest, NOT transparent. A transparent material is skipped by the
  // renderer's transmission pass, so the label would vanish the moment it sat
  // inside the glass. Cutout keeps it in the opaque pass and it refracts.
  return new THREE.MeshPhysicalMaterial({
    alphaMap: maps.alpha,
    alphaTest: 0.5,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(1, 1),
    metalness: 1,
    roughness: 0.12,
    color: 0xffffff,
    iridescence: 0.85,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [180, 620],
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
  });
}

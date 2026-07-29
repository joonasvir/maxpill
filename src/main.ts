import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { SkyEnv } from './sky';
import { Pill, PILL_ASPECT, displaceUniforms, spectralUniforms, revealUniforms } from './pill';
import { Contents } from './contents';
import { WabiLogo } from './logo';
import { BigCursor } from './cursor';
import { buildPanel } from './ui';
import { MOTION_NAMES, type State, type ClipAxis, type ClipTarget } from './types';
import { findLook } from './looks';
import { Recorder, download, turnCurve } from './clip';
import {
  loadSaved, persist, capture, autoName, makeId, settingsMarkdown, downloadText,
  type SavedMoment,
} from './saved';

const DEFAULTS: State = {
  subject: 'pill',
  bigCursor: true,
  cursorSize: 150,
  cursorSmooth: 0.16,
  seed: 0,
  look: 'sky max',
  lastLook: 'sky max',
  env: 'sky',
  shell: 'glass',
  // Empty by default. The references are clean hollow glass — the contents are
  // a mode you opt into, not the resting state of the object.
  fill: 'empty',
  motion: 'float',
  count: 34,
  itemSize: 1,
  aspect: PILL_ASPECT,
  dispersion: 3.4,
  thickness: 0,
  ior: 1.47,
  roughness: 0.02,
  bloom: 0.42,
  exposure: 0.82,
  cloud: 1,
  speed: 1,
  gravity: 5.2,
  label: true,
  zoom: 1,
  // near-flat by default: the Max is cut INTO the glass, not standing off it
  textDepth: 0.02,
  textBevel: 0.002,
  thickLoop: false,
  thickLoopMax: 4,
  revealLoop: true,
  loopSeconds: 10,
  revealSpeed: 1,
  revealStyle: 'thick',
  hue: 0,
  spread: 1,
  glow: 1,
  displace: 0,
  dof: false,
  dofFocus: 1.0,
  dofAperture: 0.6,
  clipAngle: 45,
  clipDur: 4,
  clipAxis: 'yaw',
  clipTarget: 'subject',
  clipLoop: true,
};

// Bump on any defaults change — a stored blob from an older build silently
// wins over new defaults and you end up debugging a look nobody else sees.
const KEY = 'maxpill-v18';
// Which subject you land on is decided by the DOMAIN, and it overrides the
// stored preference. Both hosts serve the same app, but a link has to be
// dependable: max.joonas.wtf must always open on the pill and 3d.joonas.wtf on
// the mark, or sharing either one is a coin toss against whatever the recipient
// last had selected.
function hostSubject(): State['subject'] | null {
  const h = location.hostname;
  if (h.startsWith('max.')) return 'pill';
  if (h.startsWith('3d.')) return 'logo';
  return null;
}

const S: State = { ...DEFAULTS, ...readStore() };
const forced = hostSubject();
if (forced) S.subject = forced;

function readStore(): Partial<State> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* private mode — settings just won't persist */
  }
}

// ── scene ───────────────────────────────────────────────────────────────────

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true, // so the still export can read the buffer back
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
camera.position.set(0, 0, 8.4);

// Fit the camera to the object rather than parking it at a constant distance.
// A fixed distance frames correctly at exactly one aspect ratio and crops the
// pill on every other one — a phone in portrait is the worst case, since the
// object is widest along the axis the viewport is narrowest. Working from the
// BOUNDING SPHERE means the fit holds at any rotation, so a tumble or a 90°
// clip turn can never swing a cap out of shot.
function frameDist() {
  const r =
    S.subject === 'logo'
      ? logo.boundRadius() * 1.22
      : Math.hypot(pill.half + RADIUS + S.displace, RADIUS + S.displace) * 1.22;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, camera.aspect));
  const d = Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2));
  return d / S.zoom;
}

const sky = new SkyEnv(renderer);
const cursor = new BigCursor('cursor-wabi.png');

const RADIUS = 1;
const WALL = 0.085;
const pill = new Pill({ radius: RADIUS, aspect: S.aspect });
scene.add(pill.group);

const contents = new Contents(pill.half, RADIUS - WALL, 0.155);
pill.group.add(contents.group);

// The logo is a second subject sharing the SAME shell material instance, so
// every material control, environment and look applies to it without a parallel
// set of settings. Only one subject is in the scene at a time.
const logo = new WabiLogo(RADIUS * 0.62, pill.shellMesh.material as THREE.Material);
scene.add(logo.group);
logo.group.visible = false;

function applySubject() {
  const isLogo = S.subject === 'logo';
  pill.group.visible = !isLogo;
  logo.group.visible = isLogo;
  document.body.classList.toggle('subject-logo', isLogo);
}

// A couple of real lights on top of the env: image-based lighting alone leaves
// the contents flat, because everything they see is a low-frequency blur.
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-3, 4.5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xbcd8ff, 0.8);
rim.position.set(3.5, -1.5, -4);
scene.add(rim);

// ── post ────────────────────────────────────────────────────────────────────

// Multisampled composer target. Real geometry only looks better than a cutout
// if something actually resolves its edges — with a plain non-MSAA buffer the
// extruded label would alias just as badly as the alpha test did.
const composerRT = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, composerRT);
const renderPass = new RenderPass(scene, camera);
// Focus BEFORE bloom: defocus is a lens event and bloom is a sensor event, so
// blooming first would spread a halo that then survives the blur as a hard ring.
const bokeh = new BokehPass(scene, camera, { focus: 8.4, aperture: 0.00006, maxblur: 0.014 });
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), S.bloom, 0.62, 0.86);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bokeh);
composer.addPass(bloom);
composer.addPass(outputPass);

function applyDof() {
  bokeh.enabled = S.dof;
  const u = (bokeh as any).uniforms;
  if (u) {
    // focus is a FRACTION of the fitted distance, so pulling focus survives a
    // resize; an absolute value silently defocuses when the framing changes
    u.focus.value = frameDist() * S.dofFocus;
    u.aperture.value = S.dofAperture * 0.00006;
    u.maxblur.value = 0.016;
  }
}

// ── environment wiring ──────────────────────────────────────────────────────

// The camera looks along -Z, which samples the sky at the HORIZON — precisely
// where the cumulus is banked, so an untilted sky fills the frame with cloud
// and no blue survives. Pitching the whole environment up ~36° puts the camera
// where the reference photograph is: aimed into open sky, clouds low in frame.
//
// The sign is NEGATIVE: three negates the Euler when it builds the background
// and environment rotation matrices, so a positive pitch here aims the camera
// at the ground. Measured, not assumed — a positive value renders a flat field
// of exactly the `horizon` constant, which is what the bug looked like.
const PITCH: Record<string, number> = {
  sky: -0.62, soft: -0.22, dusk: -0.30, mist: -0.16, studio: -0.10, warm: -0.18,
  chrome: -0.2, noir: -0.12, darkroom: -0.10, golden: -0.16, mono: -0.18, zebra: -0.15,
};

function applyEnv() {
  // ONE call does name + shader + bake, so S.env and the baked buffer cannot
  // drift apart no matter which path got here.
  const env = sky.apply(S.env, S.cloud, S.seed);
  scene.environment = env;
  scene.background = sky.background;
  const p = PITCH[S.env] ?? -0.3;
  scene.backgroundRotation.set(p, 0, 0);
  scene.environmentRotation.set(p, 0, 0);
  (pill.shellMesh.material as THREE.MeshPhysicalMaterial).envMap = env;
  (pill.label.material as THREE.MeshPhysicalMaterial).envMap = env;
  if (pill.label3d) {
    const lm = pill.label3d.material as THREE.MeshPhysicalMaterial;
    lm.envMap = env;
    lm.needsUpdate = true;
  }
  contents.setEnv(env);
}

function applyShell() {
  pill.setShell(S.shell, scene.environment);
  const m = pill.shellMesh.material as THREE.MeshPhysicalMaterial;
  logo.setMaterial(m);
  // Roughness is meaningful on every material; the refraction trio only means
  // anything once light is actually travelling through the body.
  m.roughness = S.roughness;
  if (m.transmission > 0) {
    m.dispersion = S.dispersion;
    m.thickness = S.thickness;
    m.ior = S.ior;
  }
  m.needsUpdate = true;
}

function applyFill() {
  contents.fill(S.fill, S.count, S.itemSize);
  contents.gravityScale = S.gravity;
  contents.setEnv(scene.environment);
}

// The label is a plane suspended INSIDE the body, which is what lets it refract
// through glass and sit under the surface as a deboss. On an opaque shell there
// is by definition nothing to see it through, so the toggle is forced off
// rather than left on doing nothing.
function labelVisible() {
  if (S.subject === 'logo') return false;
  const m = pill.shellMesh.material as THREE.MeshPhysicalMaterial;
  return S.label && m.transmission > 0;
}

function applyCursor() {
  cursor.setVisible(S.bigCursor);
  document.body.classList.toggle('big-cursor', S.bigCursor);
}

function applyAll() {
  applySubject();
  applyCursor();
  applyEnv();
  applyShell();
  applyFill();
  applyDof();
  bloom.strength = S.bloom;
  // One master stop on the whole scene. Dimming the environment shaders instead
  // would change the LIGHTING as well as the exposure — the ratio between the
  // room and its sources is what defines each look, so darkness has to be a
  // camera control, applied after the render.
  renderer.toneMappingExposure = S.exposure;
  spectralUniforms.uHue.value = S.hue;
  spectralUniforms.uSpread.value = S.spread;
  spectralUniforms.uGlow.value = S.glow;
  pill.setLabelVisible(labelVisible());
  document.body.classList.toggle('opaque-shell', !((pill.shellMesh.material as THREE.MeshPhysicalMaterial).transmission > 0));
}

export function applyLook(name: string) {
  const l = findLook(name);
  if (!l) return;
  Object.assign(S, l.set);
  S.look = name;
  S.lastLook = name;
  // Rewind the motion clock. Without this a look that spins can open at any
  // phase — including exactly back-to-front, where the double-sided label
  // reads mirrored and it looks like a bug rather than a turntable.
  motionT0 = clock.getElapsedTime();
  spin.identity();
  applyAll();
  save();
  // Deliberately does NOT auto-play. Switching look is a browsing action; the
  // sequence is something you ask for.
  stopReveal();
  document.dispatchEvent(new CustomEvent('mp:sync'));
}

/** Any hand edit means we are no longer sitting on a curated look. */
function diverge() {
  S.look = '';
}

// ── input: drag to turn, wheel to push in ───────────────────────────────────

// The drawn cursor belongs to the 3D view, so it has to leave the moment the
// pointer is anywhere near the chrome. Hit-testing the BUTTONS is not enough:
// the bars are `pointer-events: none` containers, so the gaps between chips
// still report as canvas and the cursor survived right up until it touched a
// button. This tests the toolbar RECTS instead, grown by a margin, which is
// also the "safety area" — it never gets close enough to overlap.
const CHROME_MARGIN = 28;
const CHROME_IDS = ['topLeft', 'topBars', 'bottomBars', 'fabs'];

function overChrome(x: number, y: number) {
  for (const id of CHROME_IDS) {
    const el = document.getElementById(id);
    // offsetParent is null for display:none, which is how the collapsed nav
    // hides #topBars — its stale rect would otherwise keep a dead zone alive
    if (!el || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (
      x >= r.left - CHROME_MARGIN && x <= r.right + CHROME_MARGIN &&
      y >= r.top - CHROME_MARGIN && y <= r.bottom + CHROME_MARGIN
    ) return true;
  }
  return false;
}

// Tracked on the DOCUMENT, not the canvas: once the pointer is over a button
// the canvas stops receiving pointermove entirely, so a canvas-only listener
// can never see it leave.
document.addEventListener('pointermove', (e) => {
  cursor.move(e.clientX, e.clientY);
  cursor.setVisible(S.bigCursor && !overChrome(e.clientX, e.clientY));
});

const drag = { on: false, x: 0, y: 0, vx: 0, vy: 0, moved: 0 };

// Flick inertia. Dragging stays 1:1 — anything smoothed on the way IN feels
// disconnected from the finger — and the smoothing lives on the RELEASE
// instead. `fling` is a low-passed copy of the recent pointer velocity, so one
// jittery final frame cannot throw the object off; it is then decayed
// framerate-independently, which is what keeps a 120Hz display from stopping
// four times faster than a 30Hz one.
const fling = { x: 0, y: 0 };
const FLING_SMOOTH = 0.35;
// 0.985 per frame at 60Hz ≈ 0.40 of the speed remaining after a second, so a
// flick coasts for four or five seconds instead of a fraction of one. The
// exponent makes that identical on a 120Hz phone and a 30Hz laptop.
const FLING_DECAY = 0.985;
const FLING_STOP = 0.004;

// The mark never fully comes to rest: a slow rotation about a deliberately
// off-vertical axis. Off-axis is what gives it weight — a spin about a clean Y
// reads as a turntable, whereas a tilted axis reads as an object with mass
// carrying its own momentum.
const IDLE_AXIS = new THREE.Vector3(0.22, 1, 0.14).normalize();
const IDLE_RATE = 0.22;
const spin = new THREE.Quaternion();

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    drag.on = false; // hand the gesture over to the pinch
    pinchBase = pinchDist();
    pinchZoom = S.zoom;
    return;
  }
  if (pointers.size > 2) return;
  drag.on = true;
  fling.x = 0; // grabbing kills any spin still running
  fling.y = 0;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size >= 2) {
    const d = pinchDist();
    if (pinchBase > 8 && d > 8) {
      S.zoom = THREE.MathUtils.clamp(pinchZoom * (d / pinchBase), ZOOM_MIN, ZOOM_MAX);
    }
    return;
  }
  if (!drag.on) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.vx = dx;
  drag.vy = dy;
  fling.x += (dx - fling.x) * FLING_SMOOTH;
  fling.y += (dy - fling.y) * FLING_SMOOTH;
  turn(dx, dy);
});
function endDrag() {
  if (!drag.on) return;
  drag.on = false;
  const flick = Math.hypot(drag.vx, drag.vy);
  if (flick > 22) contents.impulse(Math.min(6, flick * 0.12));
  // a tap should not spin anything
  if (drag.moved < 4) {
    fling.x = 0;
    fling.y = 0;
  }
}
function releasePointer(e: PointerEvent) {
  const wasPinching = pointers.size >= 2;
  pointers.delete(e.pointerId);
  if (wasPinching) {
    // lifting one finger must not resume a drag from a stale anchor
    drag.on = false;
    drag.moved = 999;
    if (pointers.size < 2) {
      save();
      document.dispatchEvent(new CustomEvent('mp:sync'));
    }
    return;
  }
  if (drag.moved < 4) contents.impulse(2.6); // a tap rattles it
  endDrag();
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('pointerleave', (e) => {
  releasePointer(e);
  cursor.setVisible(false);
});
document.addEventListener('pointerleave', () => cursor.setVisible(false));
canvas.addEventListener('pointerenter', (e) => {
  // warp rather than ease, so it does not come flying in from wherever it was
  // left when the pointer last went over the chrome
  cursor.warp(e.clientX, e.clientY);
  cursor.setVisible(S.bigCursor && !overChrome(e.clientX, e.clientY));
});

const _tq = new THREE.Quaternion();
const _AX_Y = new THREE.Vector3(0, 1, 0);
const _AX_X = new THREE.Vector3(1, 0, 0);
const _AX_Z = new THREE.Vector3(0, 0, 1);
function turn(dx: number, dy: number) {
  // rotate about the CAMERA's axes, not the pill's — otherwise the control
  // inverts as soon as the pill has tumbled past a quarter turn
  _tq.setFromAxisAngle(_AX_Y, dx * 0.008);
  spin.premultiply(_tq);
  _tq.setFromAxisAngle(_AX_X, dy * 0.008);
  spin.premultiply(_tq);
}

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3.2;

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    // A macOS trackpad pinch arrives as a wheel event with ctrlKey set, at a
    // far finer delta than a mouse notch — so it needs its own gain, or the
    // pinch crawls while the wheel leaps.
    const k = e.ctrlKey ? 0.012 : 0.0022;
    // exponential and driven by MAGNITUDE, not sign: Math.sign threw away how
    // hard you scrolled and made every notch an identical 7% step
    S.zoom = THREE.MathUtils.clamp(S.zoom * Math.exp(-e.deltaY * k), ZOOM_MIN, ZOOM_MAX);
    save();
  },
  { passive: false }
);

// ── two-finger pinch ────────────────────────────────────────────────────────
// Tracked from raw pointer events so a pen or a second mouse behaves the same.
// A pinch is NOT a rotation: while two fingers are down the drag path is
// suspended entirely, or the composition spins every time you scale it.
const pointers = new Map<number, { x: number; y: number }>();
let pinchBase = 0;
let pinchZoom = 1;

function pinchDist() {
  const p = [...pointers.values()];
  return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
}

// ── clip turn ───────────────────────────────────────────────────────────────

// ── the orb → pill reveal ───────────────────────────────────────────────────
// Starts as a perfect Wabi orb and opens into the tag. Three staggered stages,
// because doing them together reads as one blunt scale-up: the orb settles in
// first, THEN the body lengthens, and the Max wipes on only once there is a
// pill for it to sit on.
let reveal: { t0: number } | null = null;
let revealDone: (() => void) | null = null;
const revealSpin = { x: 0, y: 0 };
const TAU = Math.PI * 2;
const REVEAL_BASE = 2600;
const revealDur = () => REVEAL_BASE / Math.max(0.15, S.revealSpeed);
// A looping sequence is a ROUND TRIP, not a replay: grow, turn on the spot for
// a beat, then shrink back to the orb. It therefore ends exactly where it began
// with zero velocity, which is what makes the repeat invisible — the old
// version played forwards and hard-cut back to a sphere.
const GROW_END = 0.34;
const HOLD_END = 0.66;
// The sequence IS a loop now, so its length is a plain duration rather than a
// multiple of the one-way reveal.
const cycleDur = () =>
  (S.revealLoop ? S.loopSeconds * 1000 : REVEAL_BASE) / Math.max(0.15, S.revealSpeed);
let loopAt = 0;

function startReveal() {
  reveal = { t0: performance.now() };
  loopAt = 0;
  document.body.classList.add('revealing');
}

function stopReveal() {
  reveal = null;
  loopAt = 0;
  // A capture parks on `revealDone`; if this is called from the `p` key or a
  // look change mid-record, dropping the resolver strands recordSequence in an
  // await that can never settle — the interval runs forever, body.turning is
  // never removed and every control stays hidden. The app is bricked.
  const done = revealDone;
  revealDone = null;
  done?.();
  restReveal();
  document.body.classList.remove('revealing');
}

// smootherstep: zero FIRST and SECOND derivative at both ends. A cubic ease-out
// still has a velocity discontinuity at the start, which is what you read as a
// "kick" — this one leaves and arrives with no acceleration at all.
const ease = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

function labelMat() {
  return pill.labelMesh.material as THREE.MeshPhysicalMaterial;
}

// With real geometry there is no normal map to fade, so "relief" becomes the
// extrusion itself: scaling Z from 0 grows the solid out of the surface, which
// is the honest version of what the normal-map fade was imitating.
function setRelief(v: number) {
  const m = pill.labelMesh;
  m.scale.z = Math.max(0.001, v);
  if (!pill.label3d) {
    const mat = m.material as THREE.MeshPhysicalMaterial;
    if (mat.normalScale) mat.normalScale.set(v, v);
  }
}

// A continuous breath on the shell's thickness. Raised cosine rather than a
// triangle so it eases at BOTH turning points — a linear ramp reverses with a
// visible corner, and thickness drives refraction, so that corner shows up as a
// snap across the whole body. Seamless by construction: it starts and ends the
// cycle at the same value with the same (zero) velocity.
function thickLoopValue(t: number) {
  const period = 6 / Math.max(0.15, S.revealSpeed);
  const k = 0.5 - 0.5 * Math.cos((t / period) * Math.PI * 2);
  return THREE.MathUtils.lerp(S.thickness, S.thickLoopMax, k);
}

function restReveal() {
  logo.group.scale.setScalar(1);
  logo.spread(1);
  revealSpin.x = 0;
  revealSpin.y = 0;
  const m = pill.shellMesh.material as THREE.MeshPhysicalMaterial;
  if (m.transmission > 0) {
    m.thickness = S.thickLoop ? thickLoopValue(clock.getElapsedTime()) : S.thickness;
  }
  pill.labelMesh.visible = labelVisible();
  revealUniforms.uStretch.value = 1;
  revealUniforms.uLabelReveal.value = 1;
  revealUniforms.uWarp.value = 0;
  pill.group.scale.setScalar(1);
  pill.labelMesh.scale.setScalar(1);
  setRelief(1);
}

function stepReveal(t: number) {
  if (!reveal) {
    restReveal();
    if (loopAt && performance.now() >= loopAt) {
      loopAt = 0;
      startReveal();
    }
    return;
  }
  const p = Math.min(1, (performance.now() - reveal.t0) / cycleDur());

  // ONE curve drives everything. The sequence used to stagger scale, stretch and
  // the label across offset windows, which meant three separate accelerations
  // you could feel individually. Sharing a single smootherstep means every
  // property leaves and arrives together, on the same acceleration — the whole
  // thing lands as one gesture rather than a chain of them.
  // A LOOPING sequence is a round trip: grow, turn on the spot for a beat, then
  // shrink back to the orb. It ends exactly where it began with zero velocity,
  // which is what makes the repeat invisible — playing forwards and cutting
  // back to a sphere is a jump, however well eased each leg is.
  let e: number;
  let spinBeat = 0;
  if (S.revealLoop) {
    if (p < GROW_END) e = ease(p / GROW_END);
    else if (p < HOLD_END) {
      e = 1;
      spinBeat = (p - GROW_END) / (HOLD_END - GROW_END);
    } else {
      e = ease(1 - (p - HOLD_END) / (1 - HOLD_END));
    }
  } else {
    e = ease(p);
  }

  // A FULL turn across the hold, so the pose leaving the beat is the pose that
  // entered it. Any other angle leaves a jump when the return leg starts.
  revealSpin.y = spinBeat * Math.PI * 2;

  // The Max is derived from `e`, not from raw time, so on the way back out it
  // retreats exactly as it arrived — and it still holds off for a beat of pure
  // orb at either end.
  const arrive = THREE.MathUtils.clamp((e - 0.3) / 0.7, 0, 1);

  // The label does NOT have a size animation of its own. It is sized to the
  // body's CURRENT length, so it is always the same fraction of the capsule it
  // will be at rest — it never zooms, it is simply part of the object while the
  // object changes shape.
  //
  // A fixed size cannot work: at full size the label is wider than the orb is
  // across, so it would spear out through both caps until the body is roughly
  // three-quarters lengthened. And a second `arrive`-driven scale on top of the
  // group's own scale is a DOUBLE growth, which is what read as the text
  // zooming independently of the pill.
  const full = 2 * RADIUS + 2 * pill.half;
  const lenRatio = (2 * RADIUS + 2 * pill.half * revealUniforms.uStretch.value) / full;
  pill.labelMesh.visible = labelVisible() && arrive > 0.0001;

  if (S.subject === 'logo') {
    // The mark does NOT grow — it is already itself. The sequence is exactly one
    // revolution, added on top of `spin`, so it begins from whatever angle the
    // mark happens to be at rather than snapping to a canonical pose.
    //
    // The easing is a periodic speed modulation, not an ease-in-out: a normal
    // ease would stop dead at the seam. Here the angular velocity is
    // 2π(1 − k·cos 2πp), which is IDENTICAL at p=0 and p=1, so it breathes
    // through the turn — slow at the ends, quicker across the middle — and
    // still joins itself perfectly.
    logo.group.scale.setScalar(1);
    logo.spread(1);
    const k = 0.55;
    revealSpin.y = TAU * (p - (k / TAU) * Math.sin(TAU * p));
    revealSpin.x = 0;
  } else {
    pill.group.scale.setScalar(0.34 + 0.66 * e);
    logo.group.scale.setScalar(1);
    logo.spread(1);
  }
  if (S.subject === 'logo') {
    // a pure turn: nothing stretches, nothing fades
    revealUniforms.uStretch.value = 1;
  } else {
    revealUniforms.uStretch.value = e;
  }
  revealUniforms.uWarpPhase.value = t * 2.4;

  switch (S.revealStyle) {
    // The Max is present, full size and FIXED from the first frame — it never
    // moves or scales. What changes is the glass in front of it: the shell
    // starts absurdly thick, so refraction smears the label into an unreadable
    // wash, and as the thickness falls to the look's value the type resolves on
    // its own. The distortion is the physical material doing it, not an effect
    // layered over the top, which is why it stays coherent while the body is
    // still expanding out of the orb.
    case 'thick': {
      revealUniforms.uLabelReveal.value = 1;
      revealUniforms.uWarp.value = 0;
      pill.labelMesh.scale.set(lenRatio, lenRatio, 1);
      setRelief(arrive);
      const m = pill.shellMesh.material as THREE.MeshPhysicalMaterial;
      if (m.transmission > 0) m.thickness = THREE.MathUtils.lerp(S.thickLoopMax, S.thickness, arrive);
      break;
    }
    case 'thickness': {
      // The Max is already there at full size — only its RELIEF grows. Reading
      // as flat-then-embossed rather than absent-then-present.
      revealUniforms.uLabelReveal.value = 1;
      revealUniforms.uWarp.value = 0;
      pill.labelMesh.scale.set(lenRatio, lenRatio, 1);
      setRelief(arrive);
      break;
    }
    case 'wipe': {
      revealUniforms.uLabelReveal.value = arrive;
      revealUniforms.uWarp.value = 0;
      pill.labelMesh.scale.set(lenRatio, lenRatio, 1);
      setRelief(1);
      break;
    }
    default: {
      // swell — the glyph grows from small with its silhouette liquefied by the
      // surrounding glass, and both the warp and the bevel resolve together so
      // it snaps into focus exactly as it lands at full size.
      revealUniforms.uLabelReveal.value = 1;
      // no overshoot: a bounce is a second acceleration, which is exactly the
      // seam this pass exists to remove
      pill.labelMesh.scale.set(lenRatio, lenRatio, 1);
      revealUniforms.uWarp.value = (1 - arrive) * (1 - arrive) * 1.15;
      setRelief(arrive);
      break;
    }
  }

  if (p >= 1) {
    reveal = null;
    restReveal();
    document.body.classList.remove('revealing');
    // hold on the finished frame before going again, so a loop reads as a
    // repeated sequence rather than a stutter
    loopAt = S.revealLoop ? performance.now() : 0;
    const done = revealDone;
    revealDone = null;
    done?.();
  }
}

interface Turn {
  t0: number;
  dur: number;
  angle: number;
  axis: ClipAxis;
  target: ClipTarget;
  done?: () => void;
}
let activeTurn: Turn | null = null;
const recorder = new Recorder(canvas, 60);

// The clip poses the pill on the reference diagonal and holds it there, so the
// only motion in shot is the turn itself. Letting the idle float run underneath
// muddies a 45° rake — you can no longer tell which movement is lighting the
// bevel and which is drift.
const CLIP_POSE = new THREE.Euler(0.13, 0, -0.58);

function startTurn(rec: boolean) {
  if (activeTurn) return;
  const t: Turn = {
    t0: performance.now(),
    dur: Math.max(0.4, S.clipDur) * 1000,
    angle: S.clipAngle,
    axis: S.clipAxis,
    target: S.clipTarget,
  };
  const finish = () => {
    if (!rec) return;
    recorder
      .stop()
      .then((b) => download(b, `maxpill-${S.clipAngle}deg.${recorder.ext}`))
      .catch(() => {});
  };
  t.done = finish;
  if (rec) {
    if (!recorder.supported) {
      alert('This browser cannot record canvas video.');
      return;
    }
    recorder.start();
  }
  activeTurn = t;
  document.body.classList.add('turning');
}

function poseTurn(): boolean {
  const t = activeTurn;
  if (!t) return false;
  const p = Math.min(1, (performance.now() - t.t0) / t.dur);
  const a = turnCurve(p, t.angle, S.clipLoop) * t.angle * (Math.PI / 180);

  if (t.target === 'camera') {
    // Orbit the lens, leave the object and the room fixed.
    base.setFromEuler(CLIP_POSE);
    pill.group.position.set(0, 0, 0);
    const d = frameDist();
    if (t.axis === 'yaw') {
      camera.position.set(Math.sin(a) * d, 0, Math.cos(a) * d);
      camera.up.set(0, 1, 0);
    } else if (t.axis === 'pitch') {
      camera.position.set(0, Math.sin(a) * d, Math.cos(a) * d);
      camera.up.set(0, Math.cos(a), -Math.sin(a));
    } else {
      camera.position.set(0, 0, d);
      camera.up.set(Math.sin(a), Math.cos(a), 0);
    }
    camera.lookAt(0, 0, 0);
  } else {
    // Turn the object against a fixed room — this is the one that rakes a
    // highlight along a bevel, because the light source never moves.
    const ax = t.axis === 'yaw' ? _AX_Y : t.axis === 'pitch' ? _AX_X : _AX_Z;
    _tq.setFromAxisAngle(ax, a);
    base.setFromEuler(CLIP_POSE);
    base.premultiply(_tq);
    pill.group.position.set(0, 0, 0);
  }

  if (p >= 1) {
    const done = t.done;
    activeTurn = null;
    document.body.classList.remove('turning');
    resetCamera();
    done?.();
  }
  return true;
}

function resetCamera() {
  camera.position.set(0, 0, frameDist());
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
}

// ── motion ──────────────────────────────────────────────────────────────────

const clock = new THREE.Clock();
// Motion time is measured from here, not from boot, so applying a look can
// rewind the animation to its first frame.
let motionT0 = 0;
const worldDown = new THREE.Vector3(0, -1, 0);
const invQ = new THREE.Quaternion();
const base = new THREE.Quaternion();
const euler = new THREE.Euler();
let shakePhase = 0;

function pose(t: number, dt: number) {
  // poseTurn FIRST. The logo-reveal branch used to return before it, so
  // starting a clip turn while a reveal was running left body.turning on with
  // nothing advancing the turn.
  if (poseTurn()) {
    pill.group.quaternion.copy(base);
    logo.group.quaternion.copy(base);
    logo.group.position.copy(pill.group.position);
    return;
  }
  if (reveal && S.subject === 'logo') {
    euler.set(revealSpin.x, revealSpin.y, 0);
    base.setFromEuler(euler);
    pill.group.position.set(0, 0, 0);
    logo.group.quaternion.copy(spin).multiply(base);
    logo.group.position.set(0, 0, 0);
    return;
  }
  if (poseTurn()) {
    pill.group.quaternion.copy(base);
    logo.group.quaternion.copy(base);
    logo.group.position.copy(pill.group.position);
    return;
  }
  const sp = S.speed;
  switch (S.motion) {
    case 'float':
      // The hero pose, straight from the reference: hanging at a diagonal,
      // drifting rather than spinning. Three incommensurate frequencies so it
      // never visibly repeats.
      euler.set(
        Math.sin(t * 0.21 * sp) * 0.20 + 0.12,
        Math.sin(t * 0.17 * sp + 1.1) * 0.32,
        -0.62 + Math.sin(t * 0.13 * sp + 2.3) * 0.10
      );
      base.setFromEuler(euler);
      pill.group.position.y = Math.sin(t * 0.31 * sp) * 0.11;
      pill.group.position.x = Math.sin(t * 0.19 * sp + 0.7) * 0.07;
      break;
    case 'turntable':
      euler.set(0.16, t * 0.5 * sp, -0.12);
      base.setFromEuler(euler);
      pill.group.position.set(0, 0, 0);
      break;
    case 'tumble':
      euler.set(t * 0.37 * sp, t * 0.53 * sp, t * 0.23 * sp);
      base.setFromEuler(euler);
      pill.group.position.set(0, 0, 0);
      break;
    case 'shake': {
      shakePhase += dt * 13 * sp;
      const a = Math.sin(shakePhase);
      euler.set(a * 0.16, Math.sin(shakePhase * 0.63) * 0.5, -0.5 + a * 0.42);
      base.setFromEuler(euler);
      pill.group.position.set(Math.sin(shakePhase * 1.7) * 0.16, Math.cos(shakePhase) * 0.13, 0);
      if (Math.random() < 0.14 * sp) contents.impulse(1.5);
      break;
    }
    case 'free':
      base.identity();
      pill.group.position.set(0, 0, 0);
      break;
  }
  if (reveal && revealSpin.y !== 0) {
    _tq.setFromAxisAngle(_AX_Y, revealSpin.y);
    base.multiply(_tq);
  }
  pill.group.quaternion.copy(spin).multiply(base);
  logo.group.quaternion.copy(pill.group.quaternion);
  logo.group.position.copy(pill.group.position);
}

// ── loop ────────────────────────────────────────────────────────────────────

let raf = 0;
function frame() {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.033, clock.getDelta());
  const t = clock.getElapsedTime();

  // melt phase wraps over the clip duration so the surface animation is
  // seamless at exactly the length the recorder will capture
  const period = Math.max(0.5, S.clipDur);
  displaceUniforms.uPhase.value = ((t - motionT0) / period) % 1;
  displaceUniforms.uAmp.value = S.displace;

  // coast after a flick
  if (!drag.on && (Math.abs(fling.x) > FLING_STOP || Math.abs(fling.y) > FLING_STOP)) {
    turn(fling.x * dt * 60, fling.y * dt * 60);
    const k = Math.pow(FLING_DECAY, dt * 60);
    fling.x *= k;
    fling.y *= k;
  }

  if (S.subject === 'logo' && !drag.on && !reveal) {
    _tq.setFromAxisAngle(IDLE_AXIS, IDLE_RATE * dt * S.speed);
    spin.premultiply(_tq);
  }

  stepReveal(t);
  pose(t - motionT0, dt);

  // world "down" expressed in the pill's local frame — the whole reason the
  // contents pour correctly when you turn it over
  invQ.copy(pill.group.quaternion).invert();
  contents.gravity.copy(worldDown).applyQuaternion(invQ);
  contents.step(dt);

  if (!activeTurn) camera.position.z = frameDist();
  applyDof();
  composer.render();

  // drawn AFTER the composer, so post never blurs or blooms the pointer
  cursor.size = S.cursorSize;
  cursor.smoothing = S.cursorSmooth;
  cursor.update(dt, canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
  cursor.render(renderer);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
// ResizeObserver alone — it already fires on window resize, and adding the
// window listener too made every resize run this twice.
new ResizeObserver(resize).observe(canvas);

// ── boot ────────────────────────────────────────────────────────────────────

/** Hand the main thread back so the browser can paint and timers can fire.
 *  Boot was one unbroken ~2.5s task, and a setTimeout cannot preempt a blocked
 *  thread — which is why the loader's failsafe kept losing to it. */
const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

async function boot() {
  try {
    await document.fonts.load('italic 400 64px Selecta');
    await document.fonts.ready;
  } catch {
    /* fall through to the system face rather than blocking the scene */
  }
  // NOT calling setLabelText('Max') here — the constructor already built those
  // maps with exactly that string, and rebuilding them runs a half-million-pixel
  // distance transform a second time on the main thread before first paint.

  // Deterministic boot. If a curated look is active, re-apply it in full rather
  // than trusting the stored field-by-field state — otherwise a reload lands on
  // whatever was last touched, which is why the lighting appeared to change at
  // random between visits. A hand-tuned state (look === '') is left alone,
  // because that divergence is deliberate.
  if (S.look && findLook(S.look)) {
    const l = findLook(S.look)!;
    const keepSubject = S.subject;
    Object.assign(S, l.set);
    S.subject = keepSubject;
    S.look = l.name;
  }
  S.seed = 0; // same link, same sky

  await yieldToBrowser();
  applyAll();
  resize();
  await yieldToBrowser();

  // Deliberately NOT waiting on pill.ready here. Parsing the font and extruding
  // the outlines is the slowest thing in the boot, and blocking the splash on it
  // pushed the reveal past three seconds. The flat cutout is already on screen
  // and legible; the solid swaps in a beat later, which is a far better trade
  // than holding a splash screen to avoid one subtle transition.

  buildPanel(S, {
    onLook: (n) => applyLook(n),
    onRevert: () => applyLook(S.lastLook || 'clean'),
    onSubject: () => {
      applySubject();
      applyShell();
      pill.setLabelVisible(labelVisible());
      save();
    },
    onEnv: () => {
      diverge();
      applyEnv();
      applyShell();
      save();
    },
    onShell: () => {
      diverge();
      applyShell();
      pill.setLabelVisible(labelVisible());
      document.body.classList.toggle('opaque-shell', !((pill.shellMesh.material as THREE.MeshPhysicalMaterial).transmission > 0));
      save();
    },
    onFill: () => {
      diverge();
      applyFill();
      save();
    },
    onDepth: () => {
      diverge();
      pill.setDepth(S.textDepth, S.textBevel);
      applyEnv();
      pill.setLabelVisible(labelVisible());
      save();
    },
    onAspect: () => {
      diverge();
      pill.setAspect(S.aspect);
      pill.buildLabel3D();
      contents.resize(pill.half, RADIUS - WALL, 0.155);
      applyFill();
      save();
    },
    onBloom: () => {
      diverge();
      bloom.strength = S.bloom;
      renderer.toneMappingExposure = S.exposure;
      spectralUniforms.uHue.value = S.hue;
      spectralUniforms.uSpread.value = S.spread;
      spectralUniforms.uGlow.value = S.glow;
      save();
    },
    onDof: () => {
      diverge();
      applyDof();
      save();
    },
    onMisc: () => {
      diverge();
      pill.setLabelVisible(labelVisible());
      contents.gravityScale = S.gravity;
      save();
    },
    onShake: () => contents.impulse(5),
    onReshuffle: () => {
      // one deliberate act of randomness: a new cloud layout and a fresh
      // scatter of the contents. Nothing moves unless you ask it to.
      S.seed = (S.seed + 7.3) % 1000;
      applyAll();
      save();
    },
    onPlay: () => (reveal ? stopReveal() : startReveal()),
    onThickLoop: () => {
      if (!S.thickLoop) {
        const m = pill.shellMesh.material as THREE.MeshPhysicalMaterial;
        if (m.transmission > 0) m.thickness = S.thickness;
      }
      save();
    },
    onSpeed: save,
    onCursor: () => {
      applyCursor();
      save();
    },
    onStill: saveStill,
    onPreviewTurn: () => startTurn(false),
    onRecordTurn: () => startTurn(true),
    getSaved: () => saved,
    onSaveMoment: () => saveMoment(false),
    onSaveLoop: () => saveMoment(true),
    onApplySaved: applySaved,
    onDeleteSaved: (id: string) => {
      saved = saved.filter((m) => m.id !== id);
      persist(saved);
    },
    onReorderSaved: (from: number, to: number) => {
      const next = [...saved];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      saved = next;
      persist(saved);
    },
    onRecordSequence: recordSequence,
    onReset: () => {
      Object.assign(S, DEFAULTS);
      save();
      location.reload();
    },
  });

  await yieldToBrowser();
  frame();

  // Two frames on the board before the curtain lifts — the first carries every
  // shader compile, so revealing on it shows a stutter.
  requestAnimationFrame(() => requestAnimationFrame(revealApp));
}

/**
 * Lift the loader. Idempotent, and deliberately NOT the only thing that can
 * call it: index.html arms an independent timer, because a loading screen that
 * depends on the app booting successfully is exactly the screen that gets stuck
 * when the app does not.
 */
function revealApp() {
  if (document.body.classList.contains('loaded')) return;
  document.body.classList.add('loaded');
  // remove it outright — an overlay left in the tree with pointer events
  // swallows the first tap, and this app is driven by dragging the canvas
  setTimeout(() => document.getElementById('loader')?.remove(), 700);
}

// ── saved moments ───────────────────────────────────────────────────────────

let saved: SavedMoment[] = loadSaved();

function saveMoment(loop: boolean) {
  const m: SavedMoment = {
    id: makeId(),
    name: autoName(S, saved) + (loop ? ' ↻' : ''),
    loop,
    state: capture(S),
  };
  saved = [...saved, m];
  persist(saved);
  return m;
}

function applySaved(id: string) {
  const m = saved.find((x) => x.id === id);
  if (!m) return;
  Object.assign(S, m.state);
  S.look = '';
  S.revealLoop = m.loop;
  motionT0 = clock.getElapsedTime();
  spin.identity();
  applyAll();
  save();
  if (m.loop) startReveal();
  else stopReveal();
  document.dispatchEvent(new CustomEvent('mp:sync'));
}

/**
 * Record one full pass of the play sequence and write BOTH files: the video,
 * and a markdown record of the exact settings. A clip on its own is not
 * reproducible — six months later you have a nice mp4 and no way back to it.
 */
let capturing = false;

async function recordSequence() {
  // styles.css deliberately keeps .rec clickable while everything else hides,
  // so a second tap is not a hypothetical — it is the easiest thing to do.
  if (capturing) return;
  if (!recorder.supported) {
    alert('This browser cannot record video from a canvas.');
    return;
  }
  const wasLoop = S.revealLoop;
  S.revealLoop = false; // one pass, not an endless take
  document.body.classList.add('turning'); // chrome out of frame
  const name = autoName(S, saved);

  // Tick the elapsed time out to the UI. Every other control hides itself for
  // the capture, so without this there is nothing on screen saying it is still
  // running — which is how you end up with a forty-second clip you meant to be
  // ten.
  capturing = true;
  const t0 = performance.now();
  const tick = () =>
    document.dispatchEvent(
      new CustomEvent('mp:rec', {
        detail: { recording: true, seconds: (performance.now() - t0) / 1000 },
      })
    );
  const ticker = window.setInterval(tick, 250);
  tick();

  try {
    recorder.start();
    await new Promise<void>((res) => {
      revealDone = res;
      startReveal();
    });
    // hold on the finished frame so the clip does not cut the instant it lands
    await new Promise((r) => setTimeout(r, 700));
    const blob = await recorder.stop();
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    download(blob, `maxpill-${slug}.${recorder.ext}`);
    downloadText(settingsMarkdown(S, name, stamp), `maxpill-${slug}.md`);
  } catch (e) {
    console.error(e);
  } finally {
    // in `finally` so a failed capture cannot leave the button stuck showing a
    // timer that is no longer counting anything
    capturing = false;
    clearInterval(ticker);
    document.dispatchEvent(new CustomEvent('mp:rec', { detail: { recording: false, seconds: 0 } }));
    S.revealLoop = wasLoop;
    document.body.classList.remove('turning');
  }
}

function saveStill() {
  composer.render();
  canvas.toBlob((b) => {
    if (b) download(b, `maxpill-${Date.now()}.png`);
  }, 'image/png');
}

// keyboard: quick behavior switching for screenshotting
const sync = () => document.dispatchEvent(new CustomEvent('mp:sync'));
addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const n = Number(e.key);
  if (n >= 1 && n <= MOTION_NAMES.length) {
    S.motion = MOTION_NAMES[n - 1];
    save();
    document.dispatchEvent(new CustomEvent('mp:sync'));
  }
  if (e.key === 's') saveStill();
  if (e.key === 'p') { reveal ? stopReveal() : startReveal(); sync(); }
  if (e.key === 'x') { S.seed = (S.seed + 7.3) % 1000; applyAll(); save(); }
  if (e.key === 'k') { S.thickLoop = !S.thickLoop; save(); sync(); }
  if (e.key === 'l') { S.revealLoop = !S.revealLoop; if (S.revealLoop && !reveal) startReveal(); save(); sync(); }
  if (e.key === '[') { S.revealSpeed = Math.max(0.25, +(S.revealSpeed - 0.25).toFixed(2)); save(); sync(); }
  if (e.key === ']') { S.revealSpeed = Math.min(3, +(S.revealSpeed + 0.25).toFixed(2)); save(); sync(); }
  if (e.key === '0') { S.revealSpeed = 1; save(); sync(); }
  if (e.key === 't') startTurn(false);
  if (e.key === 'r') startTurn(true);
  if (e.key === ' ') {
    e.preventDefault();
    contents.impulse(5);
  }
});

boot().catch((e) => {
  // show the scene anyway; a half-built playground beats a frozen splash
  console.error('boot failed', e);
  revealApp();
});

// debug handle — lets a headless browser drive the scene deterministically
// (the preview panel throttles rAF, so screenshots need an explicit step)
(window as any).__mp = {
  S,
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      const t = clock.getElapsedTime();
      displaceUniforms.uPhase.value = ((t - motionT0) / Math.max(0.5, S.clipDur)) % 1;
      displaceUniforms.uAmp.value = S.displace;
      stepReveal(t);
      pose(t - motionT0, dt);
      invQ.copy(pill.group.quaternion).invert();
      contents.gravity.copy(worldDown).applyQuaternion(invQ);
      contents.step(dt);
    }
    if (!activeTurn) camera.position.z = frameDist();
    applyDof();
    composer.render();
  },
  set(k: keyof State, v: any) {
    (S as any)[k] = v;
    applyAll();
  },
  look: applyLook,
  load(partial: Partial<State>) {
    Object.assign(S, partial);
    S.look = '';
    applyAll();
    save();
    document.dispatchEvent(new CustomEvent('mp:sync'));
  },
  play: startReveal,
  cursor,
  sky,
  revealAt(p: number) {
    // MUST use cycleDur, the same clock stepReveal reads — dividing by a
    // different duration here silently samples a different point in the
    // sequence. And pose() has to run while `reveal` is still set, or the
    // hold-beat spin never reaches the quaternion and this reports a still
    // frame for an animation that is in fact turning.
    reveal = { t0: performance.now() - p * cycleDur() };
    const t = clock.getElapsedTime();
    stepReveal(t);
    pose(t - motionT0, 1 / 60);
    reveal = null;
    composer.render();
  },
  pill,
  contents,
  scene,
  camera,
  renderer,
  stop: () => cancelAnimationFrame(raf),
};

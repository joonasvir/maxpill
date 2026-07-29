import * as THREE from 'three';

// The environment is the whole lighting rig. A transmissive capsule has almost
// no shading of its own — everything you see through it and reflected off it
// comes from here, so the env map is not decoration, it IS the look.
//
// Each preset is a fragment shader evaluated over an equirectangular buffer,
// which then serves two jobs: scene.background (what you see behind the pill)
// and, after PMREM, scene.environment (what the glass refracts and reflects).

export type EnvName = 'sky' | 'soft' | 'golden' | 'dusk' | 'noir' | 'darkroom' | 'studio' | 'mono' | 'zebra' | 'chrome' | 'warm' | 'mist';

export const ENV_NAMES: EnvName[] = ['sky', 'soft', 'golden', 'dusk', 'noir', 'darkroom', 'studio', 'mono', 'zebra', 'chrome', 'warm', 'mist'];

const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uCloud;

const float PI = 3.14159265359;

// direction from equirect uv
vec3 dirFromUv(vec2 uv) {
  float lon = uv.x * 2.0 * PI;
  float lat = (uv.y - 0.5) * PI;
  float cl = cos(lat);
  return vec3(cl * sin(lon), sin(lat), cl * cos(lon));
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return s;
}
`;

// Kodak-ish daylight sky, straight off the reference frame: a deep saturated
// blue overhead falling to a pale, slightly warm horizon, with soft cumulus
// banked low. Clouds are billowy rather than wispy — high fbm gain, then a
// hard-ish smoothstep so they have an edge to catch the light.
const SKY = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 zenith  = vec3(0.032, 0.196, 0.660);
  vec3 mid     = vec3(0.157, 0.435, 0.855);
  vec3 horizon = vec3(0.640, 0.800, 0.945);

  float t = smoothstep(0.5, 1.0, h);
  vec3 col = mix(mix(horizon, mid, smoothstep(0.44, 0.72, h)), zenith, t);

  // sun bloom, high and behind-left so the capsule rim lights from above
  vec3 sunDir = normalize(vec3(-0.35, 0.62, 0.70));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.93, 0.80) * pow(sd, 220.0) * 6.0;
  col += vec3(1.0, 0.90, 0.74) * pow(sd, 9.0) * 0.30;

  // Cumulus, banked low and SPARSE — the sky has to stay mostly open or the
  // frame turns into milk. fbm here is ~N(0.5, 0.12), so the detail octave is
  // added as a zero-mean perturbation; folding it in raw shifts the mean up and
  // pushes every threshold into permanent overcast.
  vec3 cp = d * 2.1 + vec3(uTime * 0.012, 0.0, 0.0);
  float n = fbm(cp, 6);
  n += (fbm(cp * 3.4 + 11.0, 4) - 0.5) * 0.24;
  // Density falls off with ELEVATION rather than sitting in a band around the
  // horizon: the camera is pitched up into the sky, so a horizon band lands
  // entirely below frame and you never see a cloud. This puts them low in shot
  // and leaves the top of the frame open blue, as in the reference.
  float band = smoothstep(0.88, 0.02, d.y);
  float cover = smoothstep(0.55, 0.75, n) * band * uCloud;

  // shade the underside so the puffs read as volumes, not stickers
  float lit = 0.55 + 0.45 * smoothstep(-0.2, 0.5, dot(normalize(cp), sunDir));
  vec3 cloud = mix(vec3(0.62, 0.69, 0.80), vec3(1.02, 1.01, 0.99), lit);

  col = mix(col, cloud, clamp(cover, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

// Late sun. Warm low key, long horizontal cloud streaks — the glass picks up
// an orange rim on one side and a violet one on the other, which is what makes
// dispersion visible without the scene turning into a rainbow.
const DUSK = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 low  = vec3(0.98, 0.47, 0.22);
  vec3 mid  = vec3(0.83, 0.44, 0.52);
  vec3 high = vec3(0.16, 0.16, 0.42);

  vec3 col = mix(mix(low, mid, smoothstep(0.42, 0.60, h)), high, smoothstep(0.55, 0.95, h));

  vec3 sunDir = normalize(vec3(0.55, 0.06, 0.83));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.62, 0.28) * pow(sd, 90.0) * 5.0;
  col += vec3(1.0, 0.50, 0.22) * pow(sd, 5.0) * 0.42;

  // stretched streaks: squash the sample space vertically
  vec3 cp = d * vec3(1.6, 7.0, 1.6) + vec3(uTime * 0.010, 0.0, 0.0);
  float n = fbm(cp, 5);
  float band = smoothstep(0.44, 0.0, abs(d.y - 0.10));
  float cover = smoothstep(0.46, 0.78, n) * band * uCloud;
  float lit = 0.35 + 0.65 * pow(max(dot(d, sunDir), 0.0), 1.6);
  vec3 cloud = mix(vec3(0.30, 0.18, 0.30), vec3(1.15, 0.72, 0.42), lit);

  col = mix(col, cloud, clamp(cover, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

// Product-shot cyclorama: near-white sweep, two big soft boxes overhead and a
// dark floor gradient. Reads as a clean studio table and gives the capsule
// crisp specular bars instead of a mushy all-over glow.
const STUDIO = /* glsl */ `
float box(vec3 d, vec3 c, vec2 s) {
  vec3 n = normalize(c);
  float f = dot(d, n);
  if (f < 0.05) return 0.0;
  vec3 up = abs(n.y) > 0.95 ? vec3(0, 0, 1) : vec3(0, 1, 0);
  vec3 rx = normalize(cross(up, n));
  vec3 ry = cross(n, rx);
  vec2 p = vec2(dot(d, rx), dot(d, ry)) / f;
  vec2 q = abs(p) - s;
  float m = smoothstep(0.30, 0.0, max(q.x, q.y));
  return m;
}

void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  // MID-TONE sweep, not white. Clear glass shows you the room, so a white room
  // gives a white object with nothing to refract — that is what made the first
  // pass read as milk. Holding the backdrop near 0.2 leaves headroom for
  // sources far above 1.0, and it is that ratio, not the material, that puts a
  // hard split on the edges.
  vec3 col = mix(vec3(0.012), vec3(0.150), smoothstep(0.30, 0.56, h));
  col = mix(col, vec3(0.235), smoothstep(0.54, 0.94, h));

  // hard-edged sources, deliberately blown well past 1.0
  col += vec3(1.0) * box(d, vec3(-0.45, 0.85, 0.35), vec2(0.40, 0.26)) * 9.0;
  col += vec3(0.96, 0.98, 1.0) * box(d, vec3(0.72, 0.50, -0.40), vec2(0.14, 0.62)) * 6.0;
  col += vec3(1.0, 0.98, 0.95) * box(d, vec3(0.10, -0.30, 0.95), vec2(0.52, 0.10)) * 2.2;
  col += vec3(0.90, 0.95, 1.0) * box(d, vec3(-0.85, -0.10, -0.50), vec2(0.10, 0.40)) * 3.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

// The Gao Yang register: saturated primaries in hard bands with black gaps.
// A chrome or high-IOR surface samples this across its curvature, so a single
// highlight smears into a full spectrum — that is where the iridescence in the
// Martian-language reference actually comes from. It is the environment doing
// the work, not the material.
const CHROME = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);

  float a = atan(d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));

  // vertical colour wheel + horizontal banding
  float hue = fract(a / 6.2831853 + 0.5 + lat * 0.22 + uTime * 0.004);
  vec3 spectrum = 0.5 + 0.5 * cos(6.2831853 * (hue + vec3(0.0, 0.33, 0.67)));
  spectrum = pow(spectrum, vec3(0.65));

  float bands = sin(lat * 26.0) * 0.5 + 0.5;
  bands = smoothstep(0.34, 0.66, bands);

  float stripes = sin(a * 9.0 + lat * 3.0) * 0.5 + 0.5;
  stripes = smoothstep(0.42, 0.58, stripes);

  vec3 col = spectrum * mix(0.06, 1.9, bands * stripes);

  // a couple of blown highlights so there is something to bloom
  col += vec3(1.0) * pow(max(dot(d, normalize(vec3(-0.3, 0.8, 0.5))), 0.0), 160.0) * 5.0;
  col += vec3(1.0) * pow(max(dot(d, normalize(vec3(0.6, -0.2, -0.7))), 0.0), 200.0) * 3.0;

  // floor falls to black to keep the contrast that makes chrome read as chrome
  col *= mix(0.12, 1.0, smoothstep(-0.55, -0.05, d.y));

  gl_FragColor = vec4(col, 1.0);
}
`;

// Champagne room, for the inflated-chrome look. Warm neutrals in a narrow band
// with ONE broad soft source and a long falloff — polished metal is a mirror,
// so its whole tonality is the room's tonality. A cool or high-contrast room
// makes gold read as chrome; keeping every value warm and close together is
// what gives that soft, almost matte champagne.
const WARM = /* glsl */ `
float softbox(vec3 d, vec3 c, vec2 s, float feather) {
  vec3 n = normalize(c);
  float f = dot(d, n);
  if (f < 0.05) return 0.0;
  vec3 up = abs(n.y) > 0.95 ? vec3(0, 0, 1) : vec3(0, 1, 0);
  vec3 rx = normalize(cross(up, n));
  vec3 ry = cross(n, rx);
  vec2 p = vec2(dot(d, rx), dot(d, ry)) / f;
  vec2 q = abs(p) - s;
  return smoothstep(feather, 0.0, max(q.x, q.y));
}

void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  // Polished metal is a MIRROR — its tonality is the room's tonality, one for
  // one. So the room is kept in the warm mid-tones with a big ratio to the
  // sources: that yields the reference's tan field with bright ridges running
  // down each stroke. A bright room just gives you a white blob.
  vec3 deep = vec3(0.030, 0.024, 0.016);
  vec3 mid  = vec3(0.175, 0.146, 0.098);
  vec3 top  = vec3(0.360, 0.310, 0.220);

  vec3 col = mix(deep, mid, smoothstep(0.18, 0.54, h));
  col = mix(col, top, smoothstep(0.52, 0.92, h));

  // one broad overhead source plus a kicker — the long sweep across these is
  // what draws the specular ridge down the middle of an inflated stroke
  col += vec3(1.00, 0.94, 0.80) * softbox(d, vec3(-0.30, 0.90, 0.30), vec2(0.50, 0.34), 0.70) * 7.0;
  col += vec3(0.98, 0.90, 0.72) * softbox(d, vec3(0.85, 0.20, -0.45), vec2(0.16, 0.62), 0.55) * 3.4;
  col += vec3(1.00, 0.96, 0.86) * pow(max(dot(d, normalize(vec3(-0.2, 0.75, 0.62))), 0.0), 90.0) * 5.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

// Cold mountain air: a teal sky, a thick band of luminous fog across the middle
// and a dark rocky mass below. Clear glass in front of this picks up a bright
// top, a pale waist and a near-black base — the tonal sandwich that makes the
// Sartre letterforms read as heavy molten glass rather than as an outline.
const MIST = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 skyTop = vec3(0.180, 0.420, 0.560);
  vec3 skyLow = vec3(0.560, 0.680, 0.720);
  vec3 col = mix(skyLow, skyTop, smoothstep(0.48, 0.95, h));

  // fog bank, thick and slow
  vec3 fp = d * 1.7 + vec3(uTime * 0.008, 0.0, 0.0);
  float f = fbm(fp, 5);
  float fogBand = smoothstep(0.30, 0.02, abs(d.y - 0.02));
  float fog = clamp(smoothstep(0.34, 0.72, f) * fogBand * (0.55 + uCloud * 0.55), 0.0, 1.0);
  col = mix(col, vec3(0.880, 0.900, 0.895), fog);

  // rock below the fog — broken, dark, faintly warm
  vec3 rp = d * 3.4;
  float r = fbm(rp, 6);
  float ground = smoothstep(-0.02, -0.28, d.y);
  vec3 rock = mix(vec3(0.045, 0.038, 0.028), vec3(0.180, 0.150, 0.105), smoothstep(0.36, 0.68, r));
  col = mix(col, rock, ground);

  // a pale sun burning through the bank, so there is one hot spot to catch
  col += vec3(1.0, 0.97, 0.92) * pow(max(dot(d, normalize(vec3(-0.5, 0.42, 0.75))), 0.0), 34.0) * 0.85;

  gl_FragColor = vec4(col, 1.0);
}
`;

// The matte-cream register: a cool blue wash on one side sliding into warm
// paper on the other, with NO hard source anywhere. Deliberately the opposite
// of `studio` — a matte body has no specular to place, so contrast in the room
// only shows up as dirt in the shading. What sells cream is a long, clean
// gradient across the form and nothing else.
const SOFT = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  // lateral gradient — this is what puts blue on one flank and paper on the
  // other, which is the entire lighting event in the reference
  float lateral = clamp(d.x * 0.5 + 0.5, 0.0, 1.0);

  vec3 cool = vec3(0.315, 0.470, 0.680);
  vec3 pale = vec3(0.760, 0.790, 0.820);
  vec3 warm = vec3(0.880, 0.865, 0.830);

  vec3 col = mix(cool, warm, smoothstep(0.10, 0.90, lateral));
  col = mix(col, pale, smoothstep(0.75, 0.05, h) * 0.35);
  col += vec3(0.06) * smoothstep(0.45, 1.0, h);

  // one very broad, very gentle overhead lift — no edges
  float lift = pow(max(dot(d, normalize(vec3(-0.25, 0.85, 0.45))), 0.0), 2.2);
  col += vec3(1.0, 0.99, 0.96) * lift * 0.55;

  gl_FragColor = vec4(col, 1.0);
}
`;

// Black table. Almost the entire sphere is near-zero, with two tight, very hot
// sources — one warm, one cool. Thin-film iridescence only shows where there IS
// light to interfere, so on black the colour appears exactly along the grazing
// bands the sources rake across. A brighter room would wash the effect out
// completely; the darkness is what makes the oil slick readable.
const NOIR = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  vec3 col = vec3(0.004, 0.004, 0.006);

  // long warm bar, low and to the right — draws the amber edge
  vec3 warmDir = normalize(vec3(0.72, 0.20, 0.66));
  float w = pow(max(dot(d, warmDir), 0.0), 26.0);
  col += vec3(1.00, 0.62, 0.24) * w * 14.0;

  // cool counter-source, opposite and higher — the blue-violet flank
  vec3 coolDir = normalize(vec3(-0.62, 0.42, -0.66));
  float c = pow(max(dot(d, coolDir), 0.0), 34.0);
  col += vec3(0.34, 0.55, 1.00) * c * 10.0;

  // a faint overhead sheet keeps the top of the form from going fully black
  col += vec3(0.30, 0.32, 0.40) * pow(max(d.y, 0.0), 6.0) * 0.35;

  gl_FragColor = vec4(col, 1.0);
}
`;

// Sun on the horizon. Low-key and strongly directional: a hot, small disc just
// above the skyline, a broad warm bloom around it, and everything else falling
// away to deep indigo. Clear glass in front of this catches one blazing edge
// and stays nearly black elsewhere — the whole point of a low-light setting.
const GOLDEN = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 ground = vec3(0.020, 0.016, 0.024);
  vec3 band   = vec3(0.720, 0.300, 0.110);
  vec3 upper  = vec3(0.105, 0.090, 0.200);
  vec3 zenith = vec3(0.020, 0.026, 0.075);

  vec3 col = mix(band, upper, smoothstep(0.50, 0.66, h));
  col = mix(col, zenith, smoothstep(0.64, 0.95, h));
  col = mix(ground, col, smoothstep(0.44, 0.505, h));

  vec3 sunDir = normalize(vec3(0.30, 0.045, 0.95));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(1.00, 0.66, 0.30) * pow(sd, 4.0) * 0.55;   // broad haze
  col += vec3(1.00, 0.80, 0.48) * pow(sd, 60.0) * 4.0;   // inner glow
  col += vec3(1.00, 0.93, 0.78) * pow(sd, 900.0) * 40.0; // the disc itself

  // thin cloud bars catching the last light from underneath
  vec3 cp = d * vec3(1.5, 9.0, 1.5) + vec3(uTime * 0.008, 0.0, 0.0);
  float n = fbm(cp, 5);
  float bandMask = smoothstep(0.30, 0.0, abs(d.y - 0.075));
  float cover = smoothstep(0.50, 0.74, n) * bandMask * uCloud;
  float lit = pow(max(dot(d, sunDir), 0.0), 2.2);
  vec3 cloud = mix(vec3(0.055, 0.040, 0.065), vec3(1.25, 0.72, 0.34), lit);
  col = mix(col, cloud, clamp(cover, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

// Abstract monochrome. Big soft-edged white sweeps drifting across charcoal,
// with no hue anywhere — so the only colour the glass can show is the colour it
// makes itself out of dispersion. That is the point of shooting glass against
// black and white: it separates the material's own behaviour from the room's.
const MONO = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  float base = mix(0.010, 0.155, smoothstep(0.22, 0.78, h));

  // broad organic sweeps — low-frequency fbm pushed to a wide soft threshold
  vec3 sp = d * 1.15 + vec3(uTime * 0.010, 0.0, 0.0);
  float n = fbm(sp, 4);
  float sweep = smoothstep(0.48, 0.80, n);
  base += sweep * 2.6;

  // one tight blown source so there is a true specular to catch
  base += pow(max(dot(d, normalize(vec3(-0.35, 0.80, 0.48))), 0.0), 130.0) * 9.0;

  gl_FragColor = vec4(vec3(base), 1.0);
}
`;

// The lighting-check standard: hard black and white bands. Every bend in a
// surface shows up as a kink in a stripe, so curvature, bevels and dispersion
// all become legible at a glance. Graphic rather than photographic, and the
// most revealing room in the set.
const ZEBRA = /* glsl */ `
void main() {
  vec3 d = dirFromUv(vUv);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float a = atan(d.z, d.x);

  // bands that widen toward the poles so they do not alias into grey
  float bands = sin(lat * 11.0 + sin(a * 2.0) * 0.35);
  float v = smoothstep(-0.05, 0.05, bands);

  // a couple of vertical breaks stop it reading as a barcode
  float cut = smoothstep(0.06, 0.14, abs(sin(a * 3.0)));
  v *= mix(0.35, 1.0, cut);

  vec3 col = vec3(mix(0.006, 3.4, v));
  col += vec3(1.0) * pow(max(dot(d, normalize(vec3(0.2, 0.9, 0.35))), 0.0), 220.0) * 8.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

// The inverse of `studio`. Same rig, exposure pulled right down: a near-black
// sweep with restrained sources, so a clear body reads as dark glass carrying a
// few bright edges rather than as a pale object on a pale field. Everything the
// eye gets is silhouette and specular, which is exactly what makes an inverted
// product shot work.
const DARKROOM = /* glsl */ `
float dbox(vec3 d, vec3 c, vec2 s) {
  vec3 n = normalize(c);
  float f = dot(d, n);
  if (f < 0.05) return 0.0;
  vec3 up = abs(n.y) > 0.95 ? vec3(0, 0, 1) : vec3(0, 1, 0);
  vec3 rx = normalize(cross(up, n));
  vec3 ry = cross(n, rx);
  vec2 p = vec2(dot(d, rx), dot(d, ry)) / f;
  vec2 q = abs(p) - s;
  return smoothstep(0.26, 0.0, max(q.x, q.y));
}

void main() {
  vec3 d = dirFromUv(vUv);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 col = mix(vec3(0.0025), vec3(0.021), smoothstep(0.28, 0.62, h));
  col = mix(col, vec3(0.040), smoothstep(0.62, 0.96, h));

  col += vec3(1.0, 0.99, 0.97) * dbox(d, vec3(-0.40, 0.86, 0.32), vec2(0.34, 0.20)) * 7.0;
  col += vec3(0.86, 0.92, 1.0) * dbox(d, vec3(0.80, 0.34, -0.46), vec2(0.09, 0.54)) * 5.0;
  col += vec3(1.0, 0.95, 0.88) * dbox(d, vec3(0.05, -0.42, 0.90), vec2(0.44, 0.07)) * 1.4;

  gl_FragColor = vec4(col, 1.0);
}
`;

const FRAG: Record<EnvName, string> = {
  sky: COMMON + SKY,
  darkroom: COMMON + DARKROOM,
  soft: COMMON + SOFT,
  noir: COMMON + NOIR,
  golden: COMMON + GOLDEN,
  mono: COMMON + MONO,
  zebra: COMMON + ZEBRA,
  dusk: COMMON + DUSK,
  studio: COMMON + STUDIO,
  chrome: COMMON + CHROME,
  warm: COMMON + WARM,
  mist: COMMON + MIST,
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class SkyEnv {
  private renderer: THREE.WebGLRenderer;
  private pmrem: THREE.PMREMGenerator;
  // TWO buffers, alternated. scene.environment worked because PMREM hands back
  // a NEW texture object every bake, so three re-evaluates it. scene.background
  // was handed the same object with the same `version` forever, and three's
  // background renderer caches on exactly that pair — so the buffer's contents
  // changed underneath it and it never looked again. Ping-ponging gives the
  // background a new identity per bake, which is the same signal that already
  // made the environment work.
  private rts: THREE.WebGLRenderTarget[] = [];
  private idx = 0;
  private get rt() {
    return this.rts[this.idx];
  }
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private quad!: THREE.Mesh;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private name: EnvName = 'sky';
  private cloud = 1;
  // The bake is DETERMINISTIC: `uTime` is driven by this seed, not by the wall
  // clock. Baking off elapsed time meant the clouds landed somewhere different
  // on every env switch, which reads as the app randomising itself — the noise
  // was always deterministic, it was the sample offset that drifted.
  seed = 0;

  /** Equirect texture — use as scene.background. Re-read it after every bake;
   *  it is a different object each time, deliberately. */
  get background(): THREE.Texture {
    return this.rt.texture;
  }

  /** debug: read the baked buffer back so a stale environment is provable */
  probe(x = 0.5, y = 0.75) {
    const buf = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(
      this.rt, Math.round(this.rt.width * x), Math.round(this.rt.height * y), 1, 1, buf);
    return { name: this.name, seed: this.seed, px: [buf[0], buf[1], buf[2]] };
  }

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    // Half-float so the sun and the blown highlights stay above 1.0 — clamping
    // them to LDR here is what makes procedural glass look like plastic.
    // 1024x512 rather than 2048x1024: this is baked AND run through PMREM (a
    // full mip chain of blur passes) on every environment change, and the
    // content is low-frequency, so only the background softens slightly.
    for (let i = 0; i < 2; i++) {
      const t = new THREE.WebGLRenderTarget(1024, 512, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      t.texture.mapping = THREE.EquirectangularReflectionMapping;
      this.rts.push(t);
    }

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG.sky,
      uniforms: { uTime: { value: 0 }, uCloud: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quadScene.add(this.quad);
  }

  set(name: EnvName, cloud = this.cloud) {

    // Build a FRESH material rather than swapping `fragmentShader` on the
    // existing one. Reassigning the source and setting needsUpdate does not
    // reliably get a ShaderMaterial recompiled — the symptom is that several
    // environments render identically to each other, because they are all still
    // running whichever program was compiled first. A new material has a new
    // cache key by construction, and this runs once per switch, not per frame.
    this.build(name, cloud);
    this.render();
  }

  /** Swap the shader. Returns false for an unknown name WITHOUT claiming it —
   *  `S.env` comes from localStorage and from look definitions, neither of which
   *  is validated, and silently reporting an environment we are not rendering is
   *  precisely the failure this class already had once. */
  private build(name: EnvName, cloud: number): boolean {
    const frag = FRAG[name];
    if (!frag) {
      console.warn('[sky] unknown environment:', name);
      return false;
    }
    this.mat.dispose();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms: { uTime: { value: this.seed }, uCloud: { value: cloud } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad.material = this.mat;
    this.name = name;
    this.cloud = cloud;
    return true;
  }

  get current() {
    return this.name;
  }

  /**
   * The ONLY entry point callers should use. Previously the name, the shader
   * and the baked buffer were updated by separate calls across two code paths,
   * which allows the class of bug where `current` reports one environment while
   * the buffer still holds another — the name is set first, so anything that
   * goes wrong afterwards leaves them disagreeing, silently and with no error.
   *
   * Recompiles only when the environment actually changed; a cloud or seed
   * change just re-bakes.
   */
  apply(name: EnvName, cloud: number, seed: number): THREE.Texture {
    // build(), not set() — set() bakes, and apply() bakes immediately after, so
    // routing through it cost two full 1024x512 renders and two PMREM chains on
    // every environment change.
    if (name !== this.name) this.build(name, cloud);
    this.cloud = cloud;
    return this.render(seed);
  }

  /** Re-bake the equirect and its PMREM. Cheap enough to call on a slider drag. */
  render(seed = this.seed): THREE.Texture {
    this.seed = seed;
    this.mat.uniforms.uTime.value = seed;
    this.mat.uniforms.uCloud.value = this.cloud;

    // alternate, so the texture handed to scene.background is a new object
    this.idx ^= 1;
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.quadScene, this.quadCam);
    this.renderer.setRenderTarget(prevRT);

    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromEquirectangular(this.rt.texture);
    return this.envRT.texture;
  }

  dispose() {
    this.rts.forEach((t) => t.dispose());
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}

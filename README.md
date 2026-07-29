# max pill

**Live: [max.joonas.wtf](https://max.joonas.wtf) · [3d.joonas.wtf](https://3d.joonas.wtf)**

A 3D playground for the Wabi **Max** pill and the Wabi mark — real refractive
glass, per-channel dispersion, curated lighting, and a clip exporter. Built with
three.js and a pile of hand-written environment shaders.

> **Fonts are not in this repo.** Selecta is a licensed commercial typeface, so
> the binaries are gitignored rather than redistributed. The app degrades
> gracefully without them: the CSS falls back to `system-ui`, and the extruded
> `Max` label falls back to its flat cutout (`loadFont` fails, the plane stays).
> To get the real thing, drop `Selecta-Italic.otf`, `Selecta-Italic.woff2`,
> `Selecta-Regular.otf` and `Selecta-Medium.otf` into `public/fonts/`.

```bash
npm install
npm run dev
```

## The premise

The Wabi Max tag (Figma node `18562:36454`) is **115.2 × 53.31** — an aspect of
**2.161:1**, with a corner radius of exactly half its height. That is not a
rounded rectangle, it is a *capsule*: the same silhouette as a pharmaceutical
pill. This app takes that coincidence literally and builds the tag as a real
refractive glass capsule you can turn over in your hand.

`PILL_ASPECT` is derived from the Figma numbers rather than eyeballed, and the
`proportion` slider reads back the literal string `Max` when it sits at that
value — so you can wander off it and find your way home.

## References

Two, pulling in different directions, and the app is the overlap:

- **The sky frame** — a glass capsule hanging at a diagonal in deep blue with
  cumulus banked low, packed with coral and cream pills. Soft, photographic,
  dreamy. This is the `sky` environment and the `float` behavior.
- **Gao Yang, _火星美学 / The beauty of Martian language_**
  ([vimeo.com/474968679](https://vimeo.com/474968679)) — iridescent chrome
  typography, heavy bevels, hard prismatic dispersion. This is the `chrome`
  environment and the bevelled `Max` label.

What both have in common is **glass bending light**, which is the axis the whole
playground turns on.

## How the look is actually made

**Dispersion is a material property, not a post effect.** three r166+ splits the
transmission ray per colour channel on `MeshPhysicalMaterial.dispersion`. A
chromatic-aberration post pass gives you fringes on the *silhouette* only; real
dispersion fringes everything seen *through* the body, which is the entire
Martian-language read. Default 3.4, slider to 10.

**The environment is the lighting rig.** A transmissive capsule has almost no
shading of its own — everything is refracted or reflected environment. So the
four env presets (`sky` · `dusk` · `studio` · `chrome`) are full fragment shaders
baked to a **half-float** equirect buffer and then PMREM'd. Half-float matters:
clamping the sun and the blown highlights to LDR is exactly what makes procedural
glass look like plastic.

The `chrome` preset is saturated primaries in hard bands separated by black. A
curved high-IOR surface sweeps across those bands and a single highlight smears
into a full spectrum — the iridescence in the reference comes from the
*environment*, not from cranking `iridescence` on the material.

**The `Max` label is an inflated height field.** A flat plane with a metal
material reflects one direction of the env and comes out a dead flat colour. So
the glyph mask gets an inner **chamfer distance transform** (5-7-11, two passes),
smoothstepped through a *circular* profile into a dome, then differentiated into
a normal map. Circular, not linear — a linear ramp reads as a chamfer, a circular
one reads as inflation, which is the Wabi bevel language.

The label uses **`alphaTest`, never `transparent`**. The renderer builds its
transmission pass from the *opaque* scene, so a `transparent: true` label would
vanish the instant it sat inside the glass. Cutout keeps it in the opaque pass
and it refracts properly. Same rule governs everything in `contents.ts`.

**Contents simulate in the capsule's local frame.** World "down" is rotated into
the pill's local space every frame, so when you turn the capsule over the pills
actually pour along the new down. That is what makes it read as a *container*
rather than a prop with some particles parented to it. Containment is a
point-to-segment clamp (the capsule interior is just "within r of the axis
segment"), pair separation is O(n²) — n caps at 120 and the volume is tight, so a
broadphase would cost more than it saves.

## Curated looks

The bar across the top of the canvas, in order. The first three are Joonas's
own, dialled in by hand and read back off the panel; the rest are built from the
reference frames. Selecting one stamps every field, and every field stays
adjustable afterwards — touching any control clears the active-look highlight.

`sky max` · `soap` · `cream` — then `prism` · `molten` · `frost` · `haze` ·
`dusk` · `spectrum` · `oil slick` · `golden hour` · `studio` · `mono` · `zebra` ·
`capsule`.

## The play sequence

A capsule **is** a sphere whose two hemispheres have been pulled apart along X,
so the orb→pill transition is one scalar. `aStretch` on each vertex stores the
portion of its x that comes from that separation; `uStretch` scales it. 0 gives a
mathematically perfect orb, 1 the tag's proportion, every value between a real
capsule — no geometry rebuild, no ellipsoid cheat. Cap normals are unchanged by
the separation and cylinder normals are perpendicular to X, so shading stays
correct throughout.

Four ways the Max arrives:

- **thick** (default) — the label is present, full size and FIXED from frame one.
  The shell starts at thickness 4.0, so refraction smears it into an unreadable
  wash, and it resolves as the glass thins. The distortion is the material doing
  it, not an effect layered on top.
- **swell** — grows from small with its silhouette liquefied, warp and bevel
  resolving together. The warp offsets the ALPHA lookup, so the letterforms
  genuinely deform rather than cross-dissolving.
- **thickness** — already there at full size; only its relief grows.
- **wipe** — a straight left-to-right reveal.

Playback lives on the second top bar: play/stop, loop (with a hold at the end so
a repeat reads as a repeat, not a stutter), and 0.5×/1×/1.5×/2×. It never
auto-plays — switching look is browsing, the sequence is something you ask for.

## Subjects

A top-level toggle between the **Max pill** and the **Wabi logo**. The mark is
taken from `wabi-logo-mark.svg` rather than traced: five circles of r=28 that
normalise to five *unit* circles in hexagonal close packing — top row of three
at y=+√3/2, bottom row of two, row offset exactly √3 to four decimals. They
genuinely touch; it is a packing, not an arrangement, and building it from those
constants keeps it true at any scale.

The logo shares the pill's **material instance**, so every shell, environment,
look and post setting applies to it with no parallel set of state. The reveal
reuses one scalar across both: the capsule's hemispheres pull apart, the mark's
five orbs separate out of a single orb.

## Determinism

Same link, same picture. Two things used to make that untrue:

- The sky was baked from `clock.getElapsedTime()`, so the cloud **sample offset**
  landed somewhere new on every environment switch. The noise was always
  hash-based; it was the offset drifting. `uTime` is now driven by `S.seed`,
  fixed at 0 on boot.
- A reload restored the stored state field by field, which after a session of
  tweaking is arbitrary. Boot now **re-applies the curated look in full** if one
  is active. A hand-tuned state (`look === ''`) is left alone — that divergence
  is deliberate.

`reshuffle` (bottom right, or `x`) is the only randomness, and it is opt-in: a
new cloud layout and a fresh scatter of the contents.

Verified by loading a cold context three times and hashing the framebuffer —
identical.

## Feel

Dragging is 1:1; anything smoothed on the way *in* feels disconnected from the
finger. The smoothing lives on the **release**: `fling` is a low-passed copy of
recent pointer velocity, so one jittery final frame cannot throw the object off,
and it decays framerate-independently (`decay ^ (dt*60)`) so a 120 Hz phone and
a 30 Hz laptop coast for the same length of time.

The **mark never fully stops** — a slow rotation about a deliberately
off-vertical axis. Off-axis is what gives it weight: a spin about a clean Y
reads as a turntable, a tilted axis reads as an object with mass.

The mark also does **not** grow during the play sequence. It is already itself,
so its sequence is a weighted spin — nearly two turns of yaw with a lean that
rises and falls — while the capsule's is the orb→pill stretch.

## Saved moments

`+ save moment` banks the whole current state; `+ save loop` banks it and marks
it to replay continuously when applied. They land in the `saved` tray, are
click-to-apply, ×-to-delete and drag-to-reorder, and persist in `localStorage`.

A moment stores the **whole state, not a diff** against a curated look — a diff
goes stale the moment a look is retuned, and a saved thing has to keep looking
like it did when you saved it.

`record sequence` records one full pass of the play sequence and writes **two**
files: the video (mp4 where supported, webm otherwise) and a markdown sidecar
with every setting, including a `__mp.load({...})` block that puts you straight
back. A clip on its own is not reproducible — six months later you have a nice
mp4 and no way back to it.

## Clip export

Looping is geometry, not an export setting: a clip is seamless only if the last
frame's pose **and** velocity match the first's. There are exactly two ways to
get that from a turn — a full revolution driven linearly, or anything less taken
there and back on a raised cosine. So `seamless loop` reshapes the motion rather
than trimming the recording. The melt is loop-safe too: its noise travels a
circle in phase rather than drifting with time, so it returns to its starting
shape every cycle.

## Controls

| section | what |
|---|---|
| **motion** | `float` (the hero — three incommensurate frequencies so it never visibly repeats) · `turntable` · `tumble` · `shake` · `free`, speed, shake button |
| **shell** | `glass` · `prism` · `spectral` · `oil` · `gold` · `chrome` · `molten` · `matte` · `frosted` · `tinted`, dispersion, thickness, ior, roughness, hue/bands/glow (spectral), melt, proportion, Max label |
| **contents** | `pills` · `orbs` · `mixed` · `empty`, count, size, gravity |
| **light** | environment (`sky` · `soft` · `golden` · `dusk` · `noir` · `studio` · `mono` · `zebra` · `chrome` · `warm` · `mist`), **darkness**, clouds, bloom, depth of field + focus + aperture |
| **export** | save png, reset |

Drag to turn (about the **camera's** axes, not the pill's — otherwise the control
inverts the moment the pill tumbles past a quarter turn). Tap to rattle the
contents, flick to shake them loose, wheel to push in. Keys `1`–`5` switch
behavior, `p` plays/stops the sequence, `l` loops it, `[` / `]` slow it down and
speed it up, `0` resets to 1×, `s` saves a still, `t` previews a turn, `r`
records one, space rattles.

`window.__mp` is the debug handle — `step(n, dt)` advances and renders
deterministically, which is how you screenshot it in a throttled preview panel.

## Gotchas banked

- `CapsuleGeometry` runs along **+Y**; the tag is horizontal. The geometry is
  rotated once at construction so every downstream calculation can assume the
  axis is local **X**.
- A capsule instance's bounding radius is `length/2 + r`, not `r` — the instance
  matrix scales by `r * 0.5` to keep the collision sphere honest against the
  geometry's `r=1, length=2`.
- `main.ts` and `ui.ts` would import each other; shared state types live in
  `types.ts` instead. The cycle typechecks fine but can trip a TDZ error once the
  bundler reorders the modules.
- **three NEGATES the Euler** when building `backgroundRotation` /
  `environmentRotation`. A positive sky pitch aims the camera at the *ground* —
  the symptom is a flat field of exactly the `horizon` constant, which looks like
  a dead shader rather than a wrong sign. Measured, not assumed.
- `injectDisplace` **assigns** `onBeforeCompile`; `injectSpectral` **chains** it.
  Spectral must be applied second or the displacement hook silently replaces it
  and the body renders black.
- A matte solid is not `transmission: 1` with `ior: 1.0`. An IOR of exactly 1
  bends nothing, so the ray passes straight through and the object *disappears*
  rather than turning opaque. Use the `matte` shell.
- The camera **fits to the bounding sphere** each frame. A fixed distance frames
  correctly at one aspect ratio and crops on every other — portrait is the worst
  case, since the pill is widest where the viewport is narrowest.
- **Swapping `fragmentShader` on a live ShaderMaterial does not reliably
  recompile it**, even with `needsUpdate`. The symptom is subtle and misleading:
  several environments render *identically to each other*, because they are all
  still running whichever program was compiled first — it looks like the env
  switch is a no-op rather than like a shader bug. `SkyEnv.set()` builds a fresh
  material per switch, which has a new cache key by construction.
- The Max is **real extruded geometry** from the Selecta outlines (opentype.js →
  `THREE.Shape` → `ExtrudeGeometry`), not an alpha-cutout plane. `alphaTest` is a
  binary per-pixel decision, so a cutout staircases at every edge no matter how
  large the mask canvas is. Counters are found by containment, not by winding —
  winding direction is not safe to rely on across fonts. The composer target is
  multisampled (`samples: 4`); real geometry only beats a cutout if something
  actually resolves its edges.
- `wawoff2` decompresses `Selecta-Italic.woff2` → `.otf` at author time, because
  opentype.js cannot read WOFF2.
- `localStorage` is versioned (`maxpill-v9`). Bump it on any defaults change or a
  stored blob silently wins and you debug a look nobody else can see.

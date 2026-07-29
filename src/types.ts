import type { EnvName } from './sky';
import type { Shell } from './pill';
import type { Fill } from './contents';

// Shared shape lives here rather than in main.ts so the panel can import it
// without the two modules importing each other — a cycle that typechecks fine
// but can trip a temporal-dead-zone error once the bundler reorders them.

export type Motion = 'float' | 'turntable' | 'tumble' | 'shake' | 'free';
export const MOTION_NAMES: Motion[] = ['float', 'turntable', 'tumble', 'shake', 'free'];

export type RevealStyle = 'thick' | 'swell' | 'thickness' | 'wipe';
export const REVEAL_STYLES: RevealStyle[] = ['thick', 'swell', 'thickness', 'wipe'];

export type ClipAxis = 'yaw' | 'pitch' | 'roll';
export const CLIP_AXES: ClipAxis[] = ['yaw', 'pitch', 'roll'];

export type ClipTarget = 'subject' | 'camera';
export const CLIP_TARGETS: ClipTarget[] = ['subject', 'camera'];

export type Subject = 'pill' | 'logo';
export const SUBJECTS: Subject[] = ['pill', 'logo'];

export interface State {
  /** which object the whole rig is pointed at */
  subject: Subject;
  /** the big pixel cursor drawn into the canvas so it survives a recording */
  bigCursor: boolean;
  cursorSize: number;
  cursorSmooth: number;

  /** deterministic bake seed — same seed, same sky, every time */
  seed: number;
  /** name of the curated look currently in force; cleared the moment any
   *  individual control is touched, so the chip never claims a state you have
   *  since edited out from under it */
  look: string;
  /** the last curated look applied. `look` is cleared the moment any control is
   *  touched; this is not, so "custom" always has somewhere to go back to. */
  lastLook: string;
  env: EnvName;
  shell: Shell;
  fill: Fill;
  motion: Motion;
  count: number;
  itemSize: number;
  aspect: number;
  dispersion: number;
  thickness: number;
  ior: number;
  roughness: number;
  bloom: number;
  /** global scene exposure — the master darkness control */
  exposure: number;
  cloud: number;
  speed: number;
  gravity: number;
  label: boolean;
  zoom: number;

  /** spectral shell: hue rotation, how many bands wrap the body, brightness */
  hue: number;
  spread: number;
  glow: number;

  /** extruded Max: how deep the solid is, and how rounded its cut edge */
  textDepth: number;
  textBevel: number;

  /** continuously breathe the shell thickness up and down */
  thickLoop: boolean;
  thickLoopMax: number;

  /** loop the play sequence, and how fast it runs */
  revealLoop: boolean;
  revealSpeed: number;
  /** seconds for one full sequence loop */
  loopSeconds: number;

  /** how the Max arrives during the play sequence */
  revealStyle: RevealStyle;

  /** molten surface displacement amplitude */
  displace: number;

  /** depth of field — the photographic register every reference shares */
  dof: boolean;
  dofFocus: number;
  dofAperture: number;

  /** clip recorder */
  clipAngle: number;
  clipDur: number;
  clipAxis: ClipAxis;
  clipTarget: ClipTarget;
  /** reshape the turn so the exported clip loops seamlessly */
  clipLoop: boolean;
}

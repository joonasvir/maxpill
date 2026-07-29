import type { State } from './types';

// Moments you bank yourself, alongside the built-in curated looks.
//
// A moment stores the WHOLE state, not a diff against a look. A diff would go
// stale the moment a curated look was retuned — the saved thing has to keep
// looking like it did when you saved it, independently of anything else moving.

export interface SavedMoment {
  id: string;
  name: string;
  /** replays continuously when applied, rather than resting on a still frame */
  loop: boolean;
  state: Partial<State>;
}

const KEY = 'maxpill-saved-v1';

export function loadSaved(): SavedMoment[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function persist(list: SavedMoment[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode — the tray just won't survive a reload */
  }
}

/** Fields that describe the picture. Deliberately excludes `look`, because a
 *  saved moment IS its own look — carrying the name it was derived from would
 *  light up the wrong chip the moment you applied it. */
const CAPTURED: Array<keyof State> = [
  'subject', 'env', 'shell', 'fill', 'motion', 'count', 'itemSize', 'aspect',
  'dispersion', 'thickness', 'ior', 'roughness', 'bloom', 'exposure', 'cloud',
  'speed', 'gravity', 'label', 'zoom', 'hue', 'spread', 'glow', 'displace',
  'dof', 'dofFocus', 'dofAperture', 'textDepth', 'textBevel',
  'revealStyle', 'revealSpeed', 'thickLoopMax',
];

export function capture(S: State): Partial<State> {
  const out: Partial<State> = {};
  for (const k of CAPTURED) (out as any)[k] = S[k];
  return out;
}

/** Auto-name from what actually distinguishes it, so a tray of ten moments is
 *  still readable without anyone typing anything. */
export function autoName(S: State, existing: SavedMoment[]) {
  const base = S.subject === 'logo' ? `logo · ${S.env}` : `${S.env} · ${S.shell}`;
  let name = base;
  let n = 2;
  while (existing.some((m) => m.name === name)) name = `${base} ${n++}`;
  return name;
}

export function makeId() {
  return 'm' + Date.now().toString(36);
}

/**
 * A reproducible record of the moment. The video shows what it looked like; this
 * says exactly how to get back there. The JSON block is the load-bearing part —
 * a table of numbers is readable but not actionable, so the same values go in
 * twice, once for a person and once for `__mp.load(...)`.
 */
export function settingsMarkdown(S: State, name: string, when: string) {
  const st = capture(S);
  const rows = Object.entries(st)
    .map(([k, v]) => `| \`${k}\` | ${typeof v === 'number' ? Number(v.toFixed(4)) : String(v)} |`)
    .join('\n');

  return `# Max Pill — ${name}

Captured ${when} from https://3d.joonas.wtf

## Reproduce

Open the site, open the console, and paste:

\`\`\`js
__mp.load(${JSON.stringify(st)})
\`\`\`

## Settings

| setting | value |
|---|---|
${rows}

---

Subject is \`${st.subject}\`, material \`${st.shell}\`, environment \`${st.env}\`.
${st.dof ? `Depth of field is on at aperture ${st.dofAperture}, focused at ${st.dofFocus}× the fitted camera distance.` : 'Depth of field is off.'}
${(st.displace ?? 0) > 0 ? `Surface melt is ${st.displace}.` : ''}
`;
}

export function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 6000);
}

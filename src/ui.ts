import { ENV_NAMES, type EnvName } from './sky';
import { SHELL_NAMES, PILL_ASPECT, type Shell } from './pill';
import { FILL_NAMES, type Fill } from './contents';
import {
  MOTION_NAMES,
  CLIP_AXES,
  CLIP_TARGETS,
  type Motion,
  type ClipAxis,
  type ClipTarget,
  type State,
} from './types';
import { LOOKS } from './looks';
import type { Subject } from './types';
import type { SavedMoment } from './saved';
import { REVEAL_STYLES, type RevealStyle } from './types';
import { loopInfo } from './clip';

export interface Hooks {
  onLook(name: string): void;
  onRevert(): void;
  onSubject(): void;
  onEnv(): void;
  onShell(): void;
  onFill(): void;
  onAspect(): void;
  onDepth(): void;
  onBloom(): void;
  onDof(): void;
  onMisc(): void;
  onShake(): void;
  onReshuffle(): void;
  onPlay(): void;
  onThickLoop(): void;
  onSpeed(): void;
  onCursor(): void;
  onStill(): void;
  onPreviewTurn(): void;
  onRecordTurn(): void;
  getSaved(): SavedMoment[];
  onSaveMoment(): SavedMoment;
  onSaveLoop(): SavedMoment;
  onApplySaved(id: string): void;
  onDeleteSaved(id: string): void;
  onReorderSaved(from: number, to: number): void;
  onRecordSequence(): void;
  onReset(): void;
}

type Sync = () => void;
const syncs: Sync[] = [];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
}

function section(host: HTMLElement, title: string, open = true): HTMLElement {
  // name class so other state can hide a whole section — the contents belong to
  // the capsule, and there is nothing to put inside the logo
  const sec = el('div', `sec sec-${title.replace(/\s+/g, '-')}`, host);
  if (!open) sec.classList.add('closed');
  const head = el('button', 'sechead', sec);
  head.type = 'button';
  head.textContent = title;
  const body = el('div', 'secbody', sec);
  head.addEventListener('click', () => sec.classList.toggle('closed'));
  return body;
}

function chips<T extends string>(
  host: HTMLElement,
  label: string,
  names: readonly T[],
  get: () => T,
  set: (v: T) => void
) {
  const row = el('div', 'row', host);
  if (label) el('span', 'lbl', row).textContent = label;
  const wrap = el('div', 'chips', row);
  const btns = names.map((n) => {
    const b = el('button', 'chip', wrap);
    b.type = 'button';
    b.textContent = n;
    b.addEventListener('click', () => {
      set(n);
      syncs.forEach((s) => s());
    });
    return b;
  });
  syncs.push(() => {
    const cur = get();
    btns.forEach((b, i) => b.classList.toggle('on', names[i] === cur));
  });
}

function slider(
  host: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  fmt: (v: number) => string = (v) => v.toFixed(2)
) {
  const row = el('div', 'row', host);
  const top = el('div', 'sliderhead', row);
  el('span', 'lbl', top).textContent = label;
  const val = el('span', 'val', top);
  const inp = el('input', 'range', row) as HTMLInputElement;
  inp.type = 'range';
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.addEventListener('input', () => {
    set(Number(inp.value));
    val.textContent = fmt(Number(inp.value));
  });
  syncs.push(() => {
    inp.value = String(get());
    val.textContent = fmt(get());
  });
}

function toggle(host: HTMLElement, label: string, cls: string, get: () => boolean, set: (v: boolean) => void) {
  const row = el('div', 'row', host);
  const b = el('button', `toggle ${cls}`, row);
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', () => {
    set(!get());
    syncs.forEach((s) => s());
  });
  syncs.push(() => b.classList.toggle('on', get()));
}

function button(host: HTMLElement, label: string, fn: () => void, cls = '') {
  const b = el('button', `btn ${cls}`, host);
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

export function buildPanel(S: State, h: Hooks) {
  // ── collapsible top nav ───────────────────────────────────────────────────
  // Four stacked rows of chips eat most of a phone screen, which leaves almost
  // nothing to look at — and looking at it is the entire point. Collapsed by
  // default on narrow screens, with the active look shown on the toggle so the
  // collapsed state still tells you where you are.
  {
    const nav = document.getElementById('navToggle') as HTMLElement;
    const label = document.getElementById('navLabel') as HTMLElement;
    const narrow = () => window.matchMedia('(max-width: 820px)').matches;
    let open = !narrow();
    const apply = () => {
      document.body.classList.toggle('nav-collapsed', !open);
      nav.setAttribute('aria-expanded', String(open));
    };
    nav.addEventListener('click', () => {
      open = !open;
      apply();
    });
    syncs.push(() => {
      label.textContent = S.look || `custom · ${S.lastLook || 'clean'}`;
    });
    addEventListener('resize', () => {
      // only force it shut when crossing INTO narrow, so an explicit open is
      // not undone by an orientation change
      if (narrow() && open && !document.body.dataset.navUser) open = false;
      apply();
    });
    nav.addEventListener('click', () => (document.body.dataset.navUser = '1'), { once: true });
    apply();
  }

  const sheet = document.getElementById('sheet') as HTMLElement;
  const scrim = document.getElementById('scrim') as HTMLElement;
  const openBtn = document.getElementById('openPanel') as HTMLElement;

  openBtn.addEventListener('click', () => document.body.classList.toggle('sheet-open'));
  scrim.addEventListener('click', () => document.body.classList.remove('sheet-open'));

  // ── curated: on the canvas AND in the sheet, driven by one list so the two
  // can never disagree about which look is active
  {
    const bar = document.getElementById('curatedBar') as HTMLElement;
    const b = section(sheet, 'curated');
    const note = el('p', 'note', b);
    note.textContent = 'a whole composition each — light, material and framing together';

    const mk = (host: HTMLElement, cls: string) =>
      LOOKS.map((l) => {
        const btn = el('button', cls, host);
        btn.type = 'button';
        btn.textContent = l.name;
        btn.title = l.note;
        btn.addEventListener('click', () => {
          note.textContent = l.note;
          h.onLook(l.name);
          syncs.forEach((s) => s());
        });
        return btn;
      });

    // subject toggle: a real two-up switch rather than two loose buttons
    const subjHost = document.getElementById('subjectToggle') as HTMLElement;
    const SUBJ: Array<[Subject, string]> = [['pill', 'Max pill'], ['logo', 'Wabi logo']];
    const subjBtns = SUBJ.map(([v, labelTxt]) => {
      const btn = el('button', '', subjHost);
      btn.type = 'button';
      btn.textContent = labelTxt;
      btn.addEventListener('click', () => {
        S.subject = v;
        h.onSubject();
        syncs.forEach((s) => s());
      });
      return btn;
    });
    syncs.push(() => subjBtns.forEach((b, i) => b.classList.toggle('on', S.subject === SUBJ[i][0])));

    // Quick cursor size: one tap cycles off - S - M - L - XL, covering both
    // "turn it off" and "make it bigger" without a popover. The tier is derived
    // from the CURRENT size by nearest match, so this and the sheet slider can
    // never disagree after a hand edit or a restored moment.
    const cursorBtn = document.getElementById('cursorBtn') as HTMLElement;
    const cursorTier = document.getElementById('cursorTier') as HTMLElement;
    const TIERS: Array<[string, number]> = [
      ['off', 0], ['S', 100], ['M', 160], ['L', 230], ['XL', 310],
    ];
    const tierIndex = () => {
      if (!S.bigCursor) return 0;
      let best = 1;
      let d = Infinity;
      for (let i = 1; i < TIERS.length; i++) {
        const gap = Math.abs(S.cursorSize - TIERS[i][1]);
        if (gap < d) { d = gap; best = i; }
      }
      return best;
    };
    cursorBtn.addEventListener('click', () => {
      const next = (tierIndex() + 1) % TIERS.length;
      S.bigCursor = next > 0;
      if (next > 0) S.cursorSize = TIERS[next][1];
      h.onCursor();
      syncs.forEach((s) => s());
    });
    syncs.push(() => {
      const i = tierIndex();
      cursorTier.textContent = TIERS[i][0];
      cursorBtn.classList.toggle('off', i === 0);
    });

    // Record. At rest it is a dot and a word; while running the dot pulses and
    // the word becomes elapsed time. That matters because every other control
    // hides itself during a capture, so this is the only thing left telling you
    // the recorder is still going.
    const recBtn = document.getElementById('recBtn') as HTMLElement;
    const recMenu = document.getElementById('recMenu') as HTMLElement;
    const recLabel = recBtn.querySelector('.rec-label') as HTMLElement;
    const setMenu = (open: boolean) => {
      recMenu.hidden = !open;
      recBtn.setAttribute('aria-expanded', String(open));
    };
    recBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.body.classList.contains('recording')) return;
      setMenu(recMenu.hidden);
    });
    // any click elsewhere dismisses it, including on the canvas
    document.addEventListener('click', () => setMenu(false));
    recMenu.addEventListener('click', (e) => e.stopPropagation());
    const act = (id: string, fn: () => void) =>
      (document.getElementById(id) as HTMLElement).addEventListener('click', () => {
        setMenu(false);
        fn();
      });
    act('recSeqBtn', h.onRecordSequence);
    act('recTurnBtn', h.onRecordTurn);
    act('stillBtn', h.onStill);
    document.addEventListener('mp:rec', (e) => {
      const d = (e as CustomEvent).detail as { recording: boolean; seconds: number };
      document.body.classList.toggle('recording', d.recording);
      if (!d.recording) {
        recLabel.textContent = 'record';
        return;
      }
      const mm = Math.floor(d.seconds / 60);
      const ss = Math.floor(d.seconds % 60);
      recLabel.textContent = mm + ':' + String(ss).padStart(2, '0');
    });

    const reshuffle = document.getElementById('reshuffleBtn') as HTMLElement;
    reshuffle.addEventListener('click', () => h.onReshuffle());

    const play = document.getElementById('playBtn') as HTMLElement;
    play.addEventListener('click', () => { h.onPlay(); syncs.forEach((s) => s()); });

    const speedHost = document.getElementById('speedChips') as HTMLElement;
    const SPEEDS = [0.5, 1, 1.5, 2];
    const sBtns = SPEEDS.map((v) => {
      const btn = el('button', '', speedHost);
      btn.type = 'button';
      btn.textContent = `${v}×`;
      btn.addEventListener('click', () => {
        S.revealSpeed = v;
        h.onSpeed();
        syncs.forEach((s) => s());
      });
      return btn;
    });
    syncs.push(() => sBtns.forEach((b, i) => b.classList.toggle('on', S.revealSpeed === SPEEDS[i])));

    // Divergence used to be invisible: touching ANY control clears S.look, so
    // no preset stayed lit and a reload restored an unnamed mixture — which is
    // why every visit looked different with nothing to explain it. This chip
    // makes that state legible AND gives it a way home.
    const custom = el('button', 'chip custom', bar);
    custom.type = 'button';
    custom.addEventListener('click', () => {
      h.onRevert();
      syncs.forEach((s) => s());
    });
    syncs.push(() => {
      const diverged = !S.look;
      custom.style.display = diverged ? '' : 'none';
      custom.textContent = `custom ↩ ${S.lastLook || 'clean'}`;
      custom.title = `back to “${S.lastLook || 'clean'}”`;
    });

    const barBtns = mk(bar, 'chip');
    const sheetBtns = mk(el('div', 'chips looks', b), 'chip');
    syncs.push(() => {
      LOOKS.forEach((l, i) => {
        const on = l.name === S.look;
        barBtns[i].classList.toggle('on', on);
        sheetBtns[i].classList.toggle('on', on);
      });
    });
  }

  // ── saved moments, in the SHEET ───────────────────────────────────────────
  // These were four buttons and a tray across the canvas, which is a lot of
  // chrome for something you touch rarely. The capability is unchanged; only
  // its home moved. Recording stays on the canvas because it is a live action.
  {
    const b = section(sheet, 'saved', false);
    el('p', 'note', b).textContent =
      'bank the current state, or a version that replays as a loop';
    const row = el('div', 'row btns', b);
    button(row, '+ moment', () => { h.onSaveMoment(); render(); });
    button(row, '+ loop', () => { h.onSaveLoop(); render(); });
    const tray = el('div', '', b);
    tray.id = 'savedTray';

    let dragFrom = -1;
    function render() {
      const list = h.getSaved();
      tray.replaceChildren();
      if (!list.length) {
        el('span', 'tray-empty', tray).textContent = 'nothing saved yet';
        return;
      }
      list.forEach((m, i) => {
        const chip = el('div', 'saved-chip', tray);
        chip.draggable = true;
        const label = el('button', 'saved-label', chip);
        label.type = 'button';
        label.textContent = m.name;
        label.title = m.loop ? 'plays as a loop' : 'a still moment';
        label.addEventListener('click', () => {
          h.onApplySaved(m.id);
          syncs.forEach((s) => s());
        });
        const del = el('button', 'saved-del', chip);
        del.type = 'button';
        del.textContent = '×';
        del.setAttribute('aria-label', `delete ${m.name}`);
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          h.onDeleteSaved(m.id);
          render();
        });
        chip.addEventListener('dragstart', () => { dragFrom = i; chip.classList.add('dragging'); });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
        chip.addEventListener('dragover', (e) => e.preventDefault());
        chip.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragFrom >= 0 && dragFrom !== i) h.onReorderSaved(dragFrom, i);
          dragFrom = -1;
          render();
        });
      });
    }
    render();
  }

  // ── clip
  {
    const b = section(sheet, 'clip');
    el('p', 'note', b).textContent =
      'turn the object against a fixed room so the light rakes the detail';
    chips<ClipTarget>(b, 'turn', CLIP_TARGETS, () => S.clipTarget, (v) => {
      S.clipTarget = v;
      h.onMisc();
    });
    chips<ClipAxis>(b, 'axis', CLIP_AXES, () => S.clipAxis, (v) => {
      S.clipAxis = v;
      h.onMisc();
    });
    const arow = el('div', 'row', b);
    el('span', 'lbl', arow).textContent = 'angle';
    const awrap = el('div', 'chips', arow);
    [30, 45, 90, 180, 360].forEach((a) => {
      const btn = el('button', 'chip', awrap);
      btn.type = 'button';
      btn.textContent = `${a}°`;
      btn.addEventListener('click', () => {
        S.clipAngle = a;
        h.onMisc();
        syncs.forEach((s) => s());
      });
      syncs.push(() => btn.classList.toggle('on', S.clipAngle === a));
    });
    toggle(b, 'thickness loop', '', () => S.thickLoop, (v) => {
      S.thickLoop = v;
      h.onThickLoop();
    });
    slider(b, 'loop seconds', 3, 30, 0.5, () => S.loopSeconds, (v) => {
      S.loopSeconds = v;
      h.onMisc();
    }, (v) => `${v.toFixed(1)}s`);
    slider(b, 'thickness loop peak', 1, 6, 0.05, () => S.thickLoopMax, (v) => {
      S.thickLoopMax = v;
      h.onThickLoop();
    });
    slider(b, 'seconds', 1, 20, 0.5, () => S.clipDur, (v) => {
      S.clipDur = v;
      h.onMisc();
    }, (v) => `${v.toFixed(1)}s`);
    toggle(b, 'seamless loop', '', () => S.clipLoop, (v) => {
      S.clipLoop = v;
      h.onMisc();
    });
    const info = el('p', 'note tight', b);
    syncs.push(() => {
      info.textContent = loopInfo(S.clipAngle, S.clipDur, S.clipLoop).label;
    });
    const row = el('div', 'row btns', b);
    button(row, 'preview', h.onPreviewTurn);
    // NOT class "rec" — that now means the big canvas record pill, and reusing
    // it here would render a sheet button as a 44px capsule with a live dot
    button(row, 'record turn', h.onRecordTurn, 'quiet');
  }

  // ── motion
  {
    const b = section(sheet, 'motion', false);
    chips<Motion>(b, 'behavior', MOTION_NAMES, () => S.motion, (v) => {
      S.motion = v;
      h.onMisc();
    });
    slider(b, 'speed', 0.1, 3, 0.05, () => S.speed, (v) => {
      S.speed = v;
      h.onMisc();
    });
    slider(b, 'zoom', 0.35, 3.2, 0.01, () => S.zoom, (v) => {
      S.zoom = v;
      h.onMisc();
    });
    chips<RevealStyle>(b, 'reveal', REVEAL_STYLES, () => S.revealStyle, (v) => {
      S.revealStyle = v;
      h.onMisc();
      h.onPlay();
    });
    toggle(b, 'big cursor', '', () => S.bigCursor, (v) => {
      S.bigCursor = v;
      h.onCursor();
    });
    slider(b, 'cursor size', 40, 320, 2, () => S.cursorSize, (v) => {
      S.cursorSize = v;
      h.onCursor();
    }, (v) => `${v | 0}px`);
    slider(b, 'cursor damping', 0.03, 1, 0.01, () => S.cursorSmooth, (v) => {
      S.cursorSmooth = v;
      h.onCursor();
    });
    const rowa = el('div', 'row btns', b);
    button(rowa, 'play reveal', h.onPlay);
    button(rowa, 'shake', h.onShake);
  }

  // ── shell
  {
    const b = section(sheet, 'shell');
    chips<Shell>(b, 'material', SHELL_NAMES, () => S.shell, (v) => {
      S.shell = v;
      h.onShell();
    });
    slider(b, 'dispersion', 0, 12, 0.1, () => S.dispersion, (v) => {
      S.dispersion = v;
      h.onShell();
    });
    slider(b, 'thickness', 0, 4, 0.05, () => S.thickness, (v) => {
      S.thickness = v;
      h.onShell();
    });
    slider(b, 'ior', 1, 2.4, 0.01, () => S.ior, (v) => {
      S.ior = v;
      h.onShell();
    });
    slider(b, 'roughness', 0, 0.9, 0.005, () => S.roughness, (v) => {
      S.roughness = v;
      h.onShell();
    });
    slider(b, 'hue', 0, 1, 0.005, () => S.hue, (v) => {
      S.hue = v;
      h.onBloom();
    });
    slider(b, 'spectrum bands', 0.3, 3, 0.02, () => S.spread, (v) => {
      S.spread = v;
      h.onBloom();
    });
    slider(b, 'glow', 0, 2.5, 0.02, () => S.glow, (v) => {
      S.glow = v;
      h.onBloom();
    });
    slider(b, 'text depth', 0, 0.4, 0.005, () => S.textDepth, (v) => {
      S.textDepth = v;
      h.onDepth();
    });
    slider(b, 'text bevel', 0, 0.06, 0.001, () => S.textBevel, (v) => {
      S.textBevel = v;
      h.onDepth();
    }, (v) => v.toFixed(3));
    slider(b, 'melt', 0, 0.3, 0.005, () => S.displace, (v) => {
      S.displace = v;
      h.onMisc();
    });
    slider(
      b,
      'proportion',
      1.2,
      4,
      0.01,
      () => S.aspect,
      (v) => {
        S.aspect = v;
        h.onAspect();
      },
      (v) => (Math.abs(v - PILL_ASPECT) < 0.005 ? 'Max' : v.toFixed(2))
    );
    toggle(b, 'Max label', 'lbl-max', () => S.label, (v) => {
      S.label = v;
      h.onMisc();
    });
  }

  // ── contents
  {
    const b = section(sheet, 'contents', false);
    chips<Fill>(b, 'inside', FILL_NAMES, () => S.fill, (v) => {
      S.fill = v;
      h.onFill();
    });
    slider(b, 'count', 0, 120, 1, () => S.count, (v) => {
      S.count = v;
      h.onFill();
    }, (v) => String(v | 0));
    slider(b, 'size', 0.4, 2.2, 0.02, () => S.itemSize, (v) => {
      S.itemSize = v;
      h.onFill();
    });
    slider(b, 'gravity', 0, 16, 0.1, () => S.gravity, (v) => {
      S.gravity = v;
      h.onFill();
    });
  }

  // ── backdrop ─────────────────────────────────────────────────────────────
  // Twelve environments is too many for a segmented dock, and they were
  // previously a wrapped grid of chips that read as a second copy of the
  // curated looks. A named dropdown says what it is and shows the current value.
  {
    const btn = document.getElementById('bgBtn') as HTMLElement;
    const menu = document.getElementById('bgMenu') as HTMLElement;
    const label = document.getElementById('bgLabel') as HTMLElement;
    menu.classList.add('cols');
    const setOpen = (open: boolean) => {
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    };
    const btns = ENV_NAMES.map((n) => {
      const b = el('button', '', menu);
      b.type = 'button';
      b.textContent = n;
      b.addEventListener('click', () => {
        S.env = n;
        h.onEnv();
        setOpen(false);
        syncs.forEach((s) => s());
      });
      return b;
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => setOpen(false));
    syncs.push(() => {
      label.textContent = S.env;
      btns.forEach((b, i) => b.classList.toggle('on', ENV_NAMES[i] === S.env));
    });
  }

  // ── brightness ───────────────────────────────────────────────────────────
  // A segmented dock rather than a native <select>: the picker could not be
  // styled to match anything else on the canvas, which is what made this corner
  // look bolted on. Same primitive as every other grouped control.
  {
    const host = document.getElementById('brightDock') as HTMLElement;
    const LEVELS: Array<[string, number]> = [
      ['bright', 1.30], ['natural', 0.85], ['dim', 0.60], ['dark', 0.40], ['black', 0.20],
    ];
    const btns = LEVELS.map(([name, v]) => {
      const b = el('button', '', host);
      b.type = 'button';
      b.textContent = name;
      b.addEventListener('click', () => {
        S.exposure = v;
        h.onBloom();
        syncs.forEach((s) => s());
      });
      return b;
    });
    syncs.push(() =>
      btns.forEach((b, i) => b.classList.toggle('on', Math.abs(S.exposure - LEVELS[i][1]) < 0.02))
    );
  }

  // ── light
  {
    const b = section(sheet, 'light');
    chips<EnvName>(b, 'environment', ENV_NAMES, () => S.env, (v) => {
      S.env = v;
      h.onEnv();
    });
    slider(b, 'darkness', 0.15, 1.6, 0.01, () => S.exposure, (v) => {
      S.exposure = v;
      h.onBloom();
    }, (v) => (v < 0.55 ? 'dark' : v > 1.15 ? 'bright' : v.toFixed(2)));
    slider(b, 'clouds', 0, 1.6, 0.02, () => S.cloud, (v) => {
      S.cloud = v;
      h.onEnv();
    });
    slider(b, 'bloom', 0, 2, 0.02, () => S.bloom, (v) => {
      S.bloom = v;
      h.onBloom();
    });
    toggle(b, 'depth of field', '', () => S.dof, (v) => {
      S.dof = v;
      h.onDof();
    });
    slider(b, 'focus', 0.55, 1.5, 0.01, () => S.dofFocus, (v) => {
      S.dofFocus = v;
      h.onDof();
    });
    slider(b, 'aperture', 0, 4, 0.05, () => S.dofAperture, (v) => {
      S.dofAperture = v;
      h.onDof();
    });
  }

  // ── export
  {
    const b = section(sheet, 'export', false);
    const row = el('div', 'row btns', b);
    button(row, 'save png', h.onStill);
    button(row, 'reset', h.onReset, 'quiet');
  }

  document.addEventListener('mp:sync', () => syncs.forEach((s) => s()));
  syncs.forEach((s) => s());
}

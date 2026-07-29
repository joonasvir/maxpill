// Clip recorder. The point of a turn clip is that a fixed environment rakes
// across a moving surface — you cannot read an inflated bevel or an edge
// dispersion from a still, because both are entirely about how the highlight
// travels. So the tool records a controlled rotation of a known angle rather
// than "some seconds of the idle animation".

const MIMES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mime: string;
  readonly supported: boolean;

  constructor(
    private canvas: HTMLCanvasElement,
    private fps = 60
  ) {
    const found = MIMES.find((m) => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    });
    this.mime = found || '';
    this.supported = typeof MediaRecorder !== 'undefined' && !!found;
  }

  get ext() {
    return this.mime.includes('mp4') ? 'mp4' : 'webm';
  }

  start() {
    if (!this.supported) throw new Error('MediaRecorder unavailable');
    // Overwriting this.rec would leave the previous recorder and its
    // captureStream running with no reference and no way ever to stop them.
    if (this.rec) throw new Error('already recording');
    this.chunks = [];
    // captureStream(0) would only push frames on explicit requestFrame(); a
    // fixed rate keeps it in step with the render loop without extra plumbing.
    const stream = this.canvas.captureStream(this.fps);
    this.rec = new MediaRecorder(stream, {
      mimeType: this.mime,
      videoBitsPerSecond: 16_000_000,
    });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.rec.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const r = this.rec;
      if (!r) return reject(new Error('not recording'));
      r.onstop = () => {
        this.rec = null;
        resolve(new Blob(this.chunks, { type: this.mime }));
      };
      r.stop();
    });
  }

  get recording() {
    return !!this.rec && this.rec.state === 'recording';
  }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 6000);
}

/**
 * Position along the turn for progress `p`, as a fraction of the full angle.
 *
 * Looping is a geometry problem, not an export setting — a clip can only be
 * seamless if the last frame's pose AND velocity match the first's. There are
 * exactly two ways to get that from a turn:
 *
 *  - a FULL revolution driven linearly: 360° lands back on 0° and the speed
 *    never changes, so the seam is invisible. Easing it would stall at the cut.
 *  - anything less than a full revolution, taken there AND back: the raised
 *    cosine returns to the start with zero velocity at both ends.
 *
 * A 45° turn that just stops cannot loop, which is why `loop` reshapes the
 * motion rather than merely trimming the recording.
 */
export function turnCurve(p: number, degrees: number, loop: boolean) {
  const full = Math.abs(degrees) >= 359.5;
  if (loop && !full) return 0.5 - 0.5 * Math.cos(p * Math.PI * 2); // out and back
  if (full) return p; // linear revolution
  return p * p * (3 - 2 * p); // one-way, cinematic in/out
}

/** What the recorded clip will actually be, in words and seconds. */
export function loopInfo(degrees: number, dur: number, loop: boolean) {
  const full = Math.abs(degrees) >= 359.5;
  if (!loop) return { seamless: full, label: full ? `${dur.toFixed(1)}s · seamless` : `${dur.toFixed(1)}s · one way` };
  if (full) return { seamless: true, label: `${dur.toFixed(1)}s · seamless revolution` };
  return { seamless: true, label: `${dur.toFixed(1)}s · seamless, out and back` };
}

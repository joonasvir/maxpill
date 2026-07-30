import { defineConfig } from 'vite';

// Base defaults to the DOMAIN ROOT, because that is where this app actually
// lives (3d.joonas.wtf). The miniapps bundle passes MINIAPPS_BASE=/maxpill/
// explicitly — same contract as whiteout and vinyl. Defaulting the other way
// round silently ships a root deploy whose asset URLs all 404.
// Stamped at build time so a stale tab is DIAGNOSABLE. Without it, "the fix
// isn't working" and "you are running yesterday's bundle" look identical from
// the outside, and we spent a long time unable to tell them apart.
const BUILD = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig(({ command }) => ({
  define: { __BUILD__: JSON.stringify(BUILD) },
  base: command === 'build' ? process.env.MINIAPPS_BASE || '/' : '/',
  server: {
    port: Number(process.env.PORT) || 3552,
    strictPort: true,
  },
}));

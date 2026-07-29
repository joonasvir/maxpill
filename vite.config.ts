import { defineConfig } from 'vite';

// Base defaults to the DOMAIN ROOT, because that is where this app actually
// lives (3d.joonas.wtf). The miniapps bundle passes MINIAPPS_BASE=/maxpill/
// explicitly — same contract as whiteout and vinyl. Defaulting the other way
// round silently ships a root deploy whose asset URLs all 404.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.MINIAPPS_BASE || '/' : '/',
  server: {
    port: Number(process.env.PORT) || 3552,
    strictPort: true,
  },
}));

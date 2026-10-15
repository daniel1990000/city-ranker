import { defineConfig } from 'vite';
import pkg from './package.json';

// `vite build --mode crazygames` / `--mode poki` makes a web-portal build (src/platform/portal.ts) in its own folder
export default defineConfig(({ mode }) => {
  const portal = mode === 'crazygames' || mode === 'poki' ? mode : '';
  return {
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    ...(portal ? { 'import.meta.env.VITE_PORTAL': JSON.stringify(portal) } : {}),
    // `vite build --mode qa` (npm run build:qa) keeps the QA hooks (window.cartHero) that the scripts in scripts/qa use;
    // store and portal builds never include them
    'import.meta.env.VITE_QA': JSON.stringify(mode === 'qa' ? '1' : ''),
  },
  build: {
    target: 'es2020',
    outDir: portal ? `dist-${portal}` : 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // the fuzz and bot tests simulate whole runs: give slow CI runners room (the default is 5 s)
    testTimeout: 30000,
  },
  } as any;
});

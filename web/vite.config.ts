import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(webRoot, '../shared');

/**
 * `shared/cost.ts` imports `./types.js` — the NodeNext-style specifier the backend
 * needs. TypeScript resolves that to `types.ts`, but Vite does not, so teach it the
 * same substitution for files that live inside `shared/`.
 *
 * In practice the import is `import type`, so esbuild usually erases it before
 * resolution ever happens. This keeps a value import from breaking the build later.
 */
function sharedTsExtensions() {
  return {
    name: 'dezine:shared-ts-extensions',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      if (!path.resolve(importer).startsWith(sharedDir)) return null;
      const candidate = path.resolve(path.dirname(importer), `${source.slice(0, -3)}.ts`);
      return fs.existsSync(candidate) ? candidate : null;
    },
  };
}

export default defineConfig({
  // GitHub Pages serves this project from a subpath (salimkt.github.io/3xdezine/),
  // so asset URLs must be relative to it. Overridable for other hosts, and left
  // as '/' in dev.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), sharedTsExtensions()],
  resolve: {
    alias: { '@shared': sharedDir },
  },
  server: {
    port: 5173,
    strictPort: true,
    // `shared/` sits outside the Vite root, so it has to be explicitly allowed.
    fs: { allow: [webRoot, sharedDir] },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
  },
});

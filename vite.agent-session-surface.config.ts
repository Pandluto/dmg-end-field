import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url));
const surfaceRoot = resolve(repositoryRoot, 'src/agentSessionSurface');

export default defineConfig({
  root: surfaceRoot,
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: resolve(repositoryRoot, 'dist/agent/ui'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(surfaceRoot, 'index.html'),
    },
  },
});

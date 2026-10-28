import { defineConfig } from 'vite';

// Relative base, so the build works under any path (GitHub Pages serves the
// project at /<repo>/).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});

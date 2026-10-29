import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Relative base, so the build works under any path (GitHub Pages serves the
// project at /<repo>/).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  // shown in the page footer; what changed is in docs/RELEASE_NOTES.md
  define: { __APP_VERSION__: JSON.stringify(version) },
});

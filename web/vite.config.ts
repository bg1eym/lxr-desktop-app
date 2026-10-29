import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
/* The commit being built: on GitHub Actions GITHUB_SHA, else the checkout's. */
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}

// Relative base, so the build works under any path (GitHub Pages serves the
// project at /<repo>/).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  // shown in the page footer (what changed is in docs/RELEASE_NOTES.md); the
  // build also goes into the URLs of the files in public/, which keep their
  // names, so a page never runs with an audio worklet from another build
  define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILD__: JSON.stringify(buildId()) },
});

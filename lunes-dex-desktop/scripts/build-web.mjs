#!/usr/bin/env node
/**
 * Builds lunes-dex-main with REACT_APP_DESKTOP=true and copies the output
 * into lunes-dex-desktop/web (packaged into the app and served on app://lunex/).
 *
 *   node scripts/build-web.mjs                 # npm run build (tsc + vite)
 *   node scripts/build-web.mjs --skip-typecheck  # vite build only
 *
 * All REACT_APP_* variables in the environment (or lunes-dex-main/.env*)
 * are baked into the bundle by Vite exactly like the web deployment.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const webDir = path.resolve(desktopDir, '..', 'lunes-dex-main');
const outDir = path.join(webDir, 'build');
const target = path.join(desktopDir, 'web');
const skipTypecheck = process.argv.includes('--skip-typecheck');

const env = { ...process.env, REACT_APP_DESKTOP: 'true', NODE_ENV: 'production' };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = skipTypecheck
  ? ['exec', '--', 'vite', 'build', '--mode', 'production']
  : ['run', 'build'];

console.log(`[build-web] ${npm} ${args.join(' ')} (cwd=${webDir})`);
const res = spawnSync(npm, args, { cwd: webDir, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (res.status !== 0) {
  console.error('[build-web] web build failed');
  process.exit(res.status ?? 1);
}
if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  console.error(`[build-web] ${outDir}/index.html not found`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(outDir, target, { recursive: true });
// Never ship source maps inside the desktop bundle.
for (const entry of fs.readdirSync(target, { recursive: true })) {
  if (String(entry).endsWith('.map')) fs.rmSync(path.join(target, String(entry)));
}
console.log(`[build-web] copied ${outDir} -> ${target}`);

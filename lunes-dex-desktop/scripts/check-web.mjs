#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
if (!fs.existsSync(path.join(web, 'index.html'))) {
  console.error(`[check-web] ${web}/index.html missing — run "npm run build:web" first.`);
  process.exit(1);
}
console.log(`[check-web] web bundle present at ${web}`);

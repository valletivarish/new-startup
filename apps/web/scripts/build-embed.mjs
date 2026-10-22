#!/usr/bin/env node
/** Builds embed/embed.ts into public/embed.js (one small IIFE, no framework). Runs before dev and build. */

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outfile = resolve(root, 'public/embed.js');
await build({
  entryPoints: [resolve(root, 'embed/embed.ts')],
  outfile,
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2019'],
  legalComments: 'none',
  logLevel: 'warning',
});
const bytes = readFileSync(outfile);
const gz = gzipSync(bytes).length;
if (gz > 15 * 1024) throw new Error(`embed.js is ${gz} bytes gzipped; keep it under 15 KB`);
console.log(`embed.js ${bytes.length} B, ${gz} B gzipped`);

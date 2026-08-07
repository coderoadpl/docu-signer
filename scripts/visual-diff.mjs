// Pixel-diff two PNGs: node scripts/visual-diff.mjs <a.png> <b.png> <diff.png>
import { readFileSync, writeFileSync } from 'node:fs';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const [aPath, bPath, diffPath] = process.argv.slice(2);
const a = PNG.sync.read(readFileSync(aPath));
const b = PNG.sync.read(readFileSync(bPath));

if (a.width !== b.width || a.height !== b.height) {
  console.log(`SIZE MISMATCH: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  process.exit(1);
}

const diff = new PNG({ width: a.width, height: a.height });
const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
if (diffPath) writeFileSync(diffPath, PNG.sync.write(diff));
const pct = ((mismatched / (a.width * a.height)) * 100).toFixed(2);
console.log(`${mismatched} px differ (${pct}%)`);

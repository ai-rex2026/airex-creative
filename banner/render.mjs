// spec(JSON) → HTML → Chrome ヘッドレスで PNG。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { renderHtml } from './template.mjs';

const run = promisify(execFile);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const here = path.dirname(new URL(import.meta.url).pathname);

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(path.join(here, 'specs')).filter((f) => f.endsWith('.json')).map((f) => path.join(here, 'specs', f));

await mkdir(path.join(here, 'out'), { recursive: true });
await mkdir(path.join(here, '.build'), { recursive: true });

for (const specPath of targets) {
  const spec = JSON.parse(await readFile(specPath, 'utf8'));
  const name = path.basename(specPath, '.json');
  // 画像は file:// の絶対パスで渡す（Chrome の CWD に依存させない）
  if (spec.art) spec.art = 'file://' + path.resolve(here, spec.art);
  if (spec.logo?.mark) spec.logo.mark = 'file://' + path.resolve(here, spec.logo.mark);
  const htmlPath = path.join(here, '.build', `${name}.html`);
  await writeFile(htmlPath, renderHtml(spec), 'utf8');
  const out = path.join(here, 'out', `${name}.png`);
  await run(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${spec.size.w},${spec.size.h}`, `--screenshot=${out}`, `file://${htmlPath}`,
  ]);
  console.log(`✓ ${path.relative(here, out)}  ${spec.size.w}x${spec.size.h}`);
}

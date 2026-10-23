// 构建自包含的 pinyin-stroke.js：把快雪 W500 的子集(woff2→base64 data URI) 与
// 笔画数据(strokes.json) 内联进模板 pinyin-stroke.template.js。
//
//   node tools/build.mjs
//
// 产出 ../pinyin-stroke.js（可单独 <script src> 引入，无外部字体/数据依赖）。
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const tpl = await readFile(join(root, 'pinyin-stroke.template.js'), 'utf8');
const fontBuf = await readFile(join(here, 'toneoz-sub.woff2'));
const strokes = (await readFile(join(here, 'strokes.json'), 'utf8')).trim();

const fontSrc = `data:font/woff2;base64,${fontBuf.toString('base64')}`;

if (!tpl.includes('__FONT_SRC__') || !tpl.includes('__STROKES__')) {
  console.error('模板缺少占位符 __FONT_SRC__ / __STROKES__');
  process.exit(1);
}

const out = tpl
  .replace('__FONT_SRC__', () => fontSrc)
  .replace('__STROKES__', () => strokes);

await writeFile(join(root, 'pinyin-stroke.js'), out);
console.log(`built pinyin-stroke.js (${(out.length / 1024).toFixed(1)} KB)`);
console.log(`  font data-uri: ${(fontSrc.length / 1024).toFixed(1)} KB base64`);
console.log(`  strokes json : ${(strokes.length / 1024).toFixed(1)} KB`);

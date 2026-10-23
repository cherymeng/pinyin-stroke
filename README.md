# pinyin-stroke

一个零依赖的 Web Component，把拼音**按教材笔顺一笔一画写出来**：四线三格、单层 ɑ、声调在音节末尾标、支持拖动进度逐帧查看。

A dependency-free Web Component that animates pinyin **stroke by stroke, in the stroke order taught in Chinese primary schools**: four-line grid, single-storey ɑ, tone marks written after the whole syllable, and a scrubber to inspect any frame.

- 演示 Demo：`pinyin-stroke.html`
- 笔尖对比 Pen comparison：`compare.html`
- 笔顺检查 Stroke data inspector：`tools/preview.html?c=abcdef`

---

## 中文

### 特性

- **笔顺按教材编排**，不是从字体骨架推测：ɑ = 左半圆 + 竖右弯，e = 横 + 左半圆（一笔），f / t = 弯竖 + 横，k = 竖 + 左斜右斜，z = 一笔横折横，w = 两笔，o 左上起笔逆时针。
- **声调最后写**：写完整个音节的所有字母才标调（`hǎo` → h → a → o → ˇ），`i` 标调去点，`ü` 先两点后标调。
- **字形用字体真字形**：墨迹是 ToneOZ 快雪拼音体（W500）的字形，笔尖只决定“先露出哪一块”，所以笔迹有偏差也不会把字写歪。
- **四线三格**：格线按字体度量（ascender 74.0 / x-height 52.3 / descender 20.0，100 号字）自动对齐。
- **两种笔尖**：`flat` 圆头等宽 / `brush` 起笔渐粗、收笔提细。
- **自包含 73 KB**：字体子集（woff2 → base64）、笔画数据、逻辑全部内联，一个 `<script>` 即可用，无需外部字体与网络请求。
- **可逐帧检查**：`seek(0~1)` 拖到任意进度。

### 支持字符

26 个字母（a–z 去掉 v，含 ü）+ 24 个带调字符，共 **50 个**：

```
a b c d e f g h i j k l m n o p q r s t u ü w x y z
ā á ǎ à  ō ó ǒ ò  ē é ě è  ī í ǐ ì  ū ú ǔ ù  ǖ ǘ ǚ ǜ
```

> 只覆盖拼音字母，不含汉字；声调必须是**预组合字符**（用 `ā`，不是 `a` + ˉ）。

### 快速开始

```html
<script src="pinyin-stroke.js"></script>

<pinyin-stroke text="mā hǎo" speed="800" gap="160" autoplay loop></pinyin-stroke>
```

空格分词，一个空格 = 一个音节（调号在该音节末尾写）。

### 属性

| 属性 | 默认 | 说明 |
|---|---|---|
| `text` | `''` | 要写的拼音，空格分词 |
| `speed` | `800` | **每个字母**的书写时长（ms，最小 80），笔画长的分到更多时间 |
| `gap` | `160` | 字母之间的停顿（ms） |
| `grid` | 显示 | 四线三格；`grid="false"` 关闭 |
| `loop` | 关 | 循环播放 |
| `color` | `#c0392b` | 墨色 |
| `autoplay` | 开 | `autoplay="false"` 关闭自动播放 |
| `pen` | `flat` | `flat` 圆头等宽 / `brush` 笔锋 |
| `taper` | `0.5` | 笔锋强度 0–1（仅 `pen="brush"`） |
| `easing` | `linear` | `natural` = 起笔快、收笔缓 |

### 方法

```js
const el = document.querySelector('pinyin-stroke');
el.play(); el.pause(); el.reset(); el.replay();
el.seek(0.42);   // 拖到整段动画的 42%，便于逐帧检查
```

属性变化会整体重排；`autoplay` 开启时会从头重播。`seek()` 会先暂停。

### 实现原理

1. **墨是字形**：每个字母渲染成一个 `<text>`（真实字形），放在 `<g mask="url(#psmN)">` 里。
2. **笔尖是遮罩**：每笔一条白色 `<path>` 放进同一个 `<mask>`，笔尖走过哪里，字形才露出哪里 —— 所以笔迹与字形有细微偏差也不会变形。
3. **笔顺是数据**：`tools/gen.mjs` 里手工编排每个字母的笔画（几笔、顺序、方向），坐标写在 Andika 的度量空间，构建时按「度量分段 + 每字包围盒」映射到快雪 W500 的字形空间；调号位置从字体墨迹里提取。
4. **时间轴**：按笔画长度分配时长；每个音节先写完所有字母的 body，再写调号；每个字母写完补一次蒙版（120ms），避免笔迹收尾处留下缺口。

### 目录

```
pinyin-stroke.js            产物：自包含组件（73 KB）
pinyin-stroke.template.js   组件源码（含占位符）
pinyin-stroke.html          主演示
compare.html                三种笔尖对比 + 进度拖动
tools/
  gen.mjs                   生成笔画数据 → strokes.json
  build.mjs                 内联字体与数据 → pinyin-stroke.js
  strokes.json              笔画数据（50 字符）
  ToneOZ-Quicksnow-W500.ttf 渲染字体源文件
  toneoz-sub.woff2          构建用字符子集（7 KB）
  ToneOZ-Quicksnow-OFL.txt  字体许可（分发时必须保留）
  preview.html              笔顺/笔数检查页，?c=abcdef
  font-compare.html         字体对比页
  package.json              构建脚本 npm run gen / build / all
```

### 重新生成 / 构建

```bash
cd tools
npm install     # 首次，只依赖 opentype.js
npm run all     # gen.mjs（写 strokes.json）+ build.mjs（写 ../pinyin-stroke.js）
```

改笔顺或坐标只改 `tools/gen.mjs` 里的 `LETTERS` 表；换字重/字体时改 `gen.mjs` 顶部字体文件名，并同步 `pinyin-stroke.template.js` 里的四线格常量与子集。

### 字体与许可

- 渲染字体：**ToneOZ 快雪拼音体 Medium / W500**（拉丁部分基于 Quicksand 改造），SIL Open Font License 1.1。
- `tools/ToneOZ-Quicksnow-OFL.txt` **必须随代码一起分发**（`pinyin-stroke.js` 内联了字体子集，属于字体分发）。
- 许可未声明保留字体名（RFN），子集可沿用原名。
- 代码许可：以仓库根 `LICENSE` 为准（当前未添加，如有需要请自行补充）。

### 已知限制

- 仅上述 50 个字符，不支持任意汉字或其他拉丁字符。
- 依赖 Custom Elements + SVG `<mask>`，不支持 IE。
- `brush` 的笔锋比较克制（蒙版架构决定）；`taper` 调到 0.8 以上更明显。
- 字体笔画较细（W500 字干 8/100 em），小字号下建议 `color` 用深色。

---

## English

### What it is

A `<pinyin-stroke>` custom element that animates pinyin the way Chinese primary schools teach it: correct stroke count and order, tone marks written **after** the whole syllable, aligned to the four-line grid, with a pen-tip that follows each stroke instead of wiping the whole glyph.

### Features

- **Textbook stroke order**, authored by hand (not inferred from font skeletons): ɑ = left bowl + vertical-with-tail, e = bar then bowl in one stroke, f / t = curved stem + bar, k = vertical + one "<" stroke, z = one stroke, w = two strokes, o starts top-left and runs counter-clockwise.
- **Tone last**: all letters of a syllable are written before its tone mark (`hǎo` → h → a → o → ˇ); the dot of `i` is dropped when a tone is added; `ü` writes its two dots before the tone.
- **Real font glyphs as ink**: the visible ink is the actual ToneOZ Quicksnow (W500) glyph; the pen only decides which part is revealed, so small path deviations cannot distort the letterform.
- **Four-line grid** derived from the font metrics (ascender 74.0 / x-height 52.3 / descender 20.0 per 100 units).
- **Two pen styles**: `flat` (round, constant width) and `brush` (thicker at the start, tapered at the lift).
- **73 KB, fully self-contained**: font subset (woff2 → base64), stroke data and logic are inlined into one file — no external font, no network request.
- **Scrubbable**: `seek(0~1)` jumps to any point of the timeline.

### Supported characters

25 Latin letters + ü, plus 24 toned forms — **50 characters** in total:

```
a b c d e f g h i j k l m n o p q r s t u ü w x y z
ā á ǎ à  ō ó ǒ ò  ē é ě è  ī í ǐ ì  ū ú ǔ ù  ǖ ǘ ǚ ǜ
```

> Pinyin letters only (no Chinese characters). Tones must be precomposed characters (`ā`, not `a` + `ˉ`).

### Quick start

```html
<script src="pinyin-stroke.js"></script>

<pinyin-stroke text="mā hǎo" speed="800" gap="160" autoplay loop></pinyin-stroke>
```

Whitespace splits syllables; the tone mark of a syllable is written at its end.

### Attributes

| Attribute | Default | Description |
|---|---|---|
| `text` | `''` | Pinyin to write; spaces separate syllables |
| `speed` | `800` | Writing time per **letter** in ms (min 80); long strokes get more time |
| `gap` | `160` | Pause between letters in ms |
| `grid` | on | Four-line grid; `grid="false"` hides it |
| `loop` | off | Loop the animation |
| `color` | `#c0392b` | Ink color |
| `autoplay` | on | `autoplay="false"` disables autoplay |
| `pen` | `flat` | `flat` or `brush` |
| `taper` | `0.5` | Brush strength 0–1 (only with `pen="brush"`) |
| `easing` | `linear` | `natural` eases in fast and out slow |

### Methods

```js
const el = document.querySelector('pinyin-stroke');
el.play(); el.pause(); el.reset(); el.replay();
el.seek(0.42);   // jump to 42% of the timeline (pauses playback)
```

Changing an attribute re-renders the component; with `autoplay` on it restarts from the beginning.

### How it works

1. **Ink is the glyph** — each letter is a `<text>` node (the real font glyph) wrapped in `<g mask="url(#psmN)">`.
2. **The pen is a mask** — each stroke is a white `<path>` inside the same `<mask>`; wherever the pen passes, the glyph becomes visible. Slight path offsets therefore never deform the letter.
3. **Stroke order is data** — `tools/gen.mjs` declares the strokes per letter (count, order, direction) in Andika's metric space; at build time they are mapped into the Quicksnow W500 glyph space (piecewise metric mapping + per-letter bounding boxes), and tone-mark positions are extracted from the font's own ink.
4. **Timeline** — durations are proportional to stroke length; a syllable writes all letter bodies first, then its tone mark; after each letter a 120 ms mask flush fills the small residual gaps at the pen's tail.

### Project layout

```
pinyin-stroke.js            built, self-contained component (73 KB)
pinyin-stroke.template.js   component source (with placeholders)
pinyin-stroke.html          main demo
compare.html                pen-style comparison with a scrubber
tools/
  gen.mjs                   stroke data generator → strokes.json
  build.mjs                 inlines font subset + data → pinyin-stroke.js
  strokes.json              stroke data (50 characters)
  ToneOZ-Quicksnow-W500.ttf render font (source)
  toneoz-sub.woff2          subset used by the build (7 KB)
  ToneOZ-Quicksnow-OFL.txt  font license (must be distributed)
  preview.html              stroke-count / order inspector, ?c=abcdef
  font-compare.html         font comparison page
  package.json              npm run gen / build / all
```

### Rebuild

```bash
cd tools
npm install     # first time; only depends on opentype.js
npm run all     # gen.mjs (writes strokes.json) + build.mjs (writes ../pinyin-stroke.js)
```

Stroke order and coordinates live in the `LETTERS` table of `tools/gen.mjs`. To switch weight/font, change the file name at the top of `gen.mjs`, then update the grid constants and the subset in `pinyin-stroke.template.js`.

### Font & license

- Render font: **ToneOZ Quicksnow Medium / W500** (Latin based on Quicksand), SIL Open Font License 1.1.
- `tools/ToneOZ-Quicksnow-OFL.txt` **must ship with the code** — `pinyin-stroke.js` embeds a font subset, which counts as font distribution.
- No Reserved Font Name (RFN) is declared, so the subset may keep the original name.
- Code license: see the repository's `LICENSE` (not added yet).

### Known limitations

- Only the 50 characters above; no Chinese characters or other Latin glyphs.
- Requires Custom Elements and SVG `<mask>` (no IE support).
- `brush` tapering is intentionally subtle in this masking architecture; raise `taper` to 0.8+ for a stronger effect.
- The W500 strokes are fairly thin (8/100 em); prefer a dark `color` at small sizes.

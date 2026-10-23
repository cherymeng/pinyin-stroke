/**
 * 生成「笔迹数据」：按小学教材的笔顺手工编排每个拼音字母的笔画，
 * 再把坐标映射到目标字体（ToneOZ 快雪 W500）的字形空间。
 *
 * 为什么不直接从字体骨架推导笔顺：骨架在连笔处会切断/并错笔画
 * （a 的竖右弯只剩半截、f/t 丢横、k 的竖被劈开、z 被拆成两笔、s/y 方向反），
 * 而拼音教学要求笔数、笔顺、方向都与教材一致，所以顺序与笔数由下面的表指定，
 * 几何位置由字体决定。
 *
 * 输出 tools/strokes.json：
 *   { "a": { adv, body:[{w,p}…], tones:[{w,p}…] } }
 *   body = 字母本身（含 i/j/ü 的点）；tones = 声调符号（写完整个音节后再写）
 */
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SIZE = 100;

// 编排坐标写在 Andika 的度量空间里（REF，包围盒已固化为下表），渲染字体是 ToneOZ 快雪拼音体 Medium / W500（CUR）
const REF_BBOX = {
  a: [5.126953, 51.513672, -50.781250, 1.220703],
  b: [6.347656, 51.757813, -78.125000, 1.220703],
  c: [4.638672, 45.166016, -50.781250, 1.220703],
  d: [5.126953, 53.955078, -78.125000, 1.220703],
  e: [4.638672, 48.583984, -50.781250, 1.220703],
  f: [1.953125, 39.306641, -79.101563, 0.000000],
  g: [5.126953, 48.339844, -50.781250, 22.949219],
  h: [6.347656, 50.781250, -78.125000, 0.000000],
  i: [7.568359, 20.019531, -72.265625, 0.000000],
  j: [-9.277344, 21.484375, -72.265625, 22.949219],
  k: [6.347656, 49.560547, -78.125000, 0.000000],
  l: [8.300781, 19.287109, -78.125000, 0.000000],
  m: [6.103516, 74.707031, -50.781250, 0.000000],
  n: [5.126953, 51.269531, -50.781250, 0.000000],
  o: [4.638672, 51.025391, -50.781250, 1.220703],
  p: [5.126953, 52.490234, -50.781250, 23.925781],
  q: [5.126953, 49.072266, -50.781250, 23.925781],
  r: [5.126953, 42.968750, -50.781250, 0.000000],
  s: [5.371094, 42.968750, -50.781250, 1.220703],
  t: [1.464844, 37.109375, -64.453125, 1.220703],
  u: [6.591797, 53.222656, -49.804688, 1.220703],
  v: [0.976563, 51.269531, -49.804688, 0.000000],
  w: [2.197266, 73.486328, -49.804688, 0.000000],
  x: [2.441406, 50.537109, -49.804688, 0.000000],
  y: [-0.976563, 50.781250, -49.804688, 22.949219],
  z: [5.126953, 46.142578, -49.804688, 0.000000],
  'ü': [6.591797, 53.222656, -72.265625, 1.220703],
};


const font = opentype.loadSync(path.join(HERE, 'ToneOZ-Quicksnow-W500.ttf'));

const metricsOf = (f) => {
  const s = SIZE / f.unitsPerEm;
  return {
    asc: f.charToGlyph('l').yMax * s,
    xh: f.charToGlyph('x').yMax * s,
    desc: -f.charToGlyph('p').yMin * s,
    s
  };
};
const REF = { asc: 78.1, xh: 49.8, desc: 23.9, s: 1 };
const CUR = metricsOf(font);

// ---------- 度量（100 号字，y 向下，基线 0）----------
const ASC = +CUR.asc.toFixed(2);    // 上格顶
const XH = +CUR.xh.toFixed(2);      // 中格顶
const DESC = +CUR.desc.toFixed(2);  // 下格底
// 笔画宽度：从 'o' 的距离场里量（p90 × 2）
const STROKE_W = (() => {
  const ras = raster(glyphContoursOf(font, 'o'), 6, 4);
  const d = distance(ras.data, ras.W, ras.H);
  const v = Array.from(d).filter(x => x > 0).sort((a, b) => a - b);
  return +Math.min(12, Math.max(4, 2 * Math.max(...v) / ras.ss)).toFixed(2);
})();
const DOT_W = +(STROKE_W * 1.5).toFixed(2);

// ---------- 采样工具 ----------
function line(a, b, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return out;
}
function cubic(a, c1, c2, b, n = 18) {
  if (typeof b === 'number') return { rel: [c1, c2, a], n: b };
  if (b === undefined) return { rel: [c1, c2, a], n };
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
      u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]
    ]);
  }
  return out;
}
function arc(cx, cy, rx, ry, a0, a1, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}
function join(...segs) {
  const out = [];
  for (const s of segs) {
    const pts = Array.isArray(s) ? s : cubic(out[out.length - 1], s.rel[0], s.rel[1], s.rel[2], s.n);
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.01) out.push(p);
    }
  }
  return out;
}

// ---------- 笔画图元 ----------
const V = (x, y1, y2, n = 14) => line([x, y1], [x, y2], n);
const H = (y, x1, x2) => line([x1, y], [x2, y], 8);

// 左半圆：右上(xr,yt) → 最左(xl,中) → 右下(xr,yb)
function lb(xr, yt, yb, xl) {
  const my = (yt + yb) / 2;
  return join(
    cubic([xr, yt], [xr - (xr - xl) * 0.62, yt - 9], [xl, my - (my - yt) * 0.62], [xl, my]),
    cubic([xl, my], [xl, my + (yb - my) * 0.62], [xr - (xr - xl) * 0.62, yb + 9], [xr, yb])
  );
}
// 右半圆：左上(xl,yt) → 最右(xr,中) → 左下(xl,yb)
function rb(xl, yt, yb, xr) {
  const my = (yt + yb) / 2;
  return join(
    cubic([xl, yt], [xl + (xr - xl) * 0.62, yt - 9], [xr, my - (my - yt) * 0.62], [xr, my]),
    cubic([xr, my], [xr, my + (yb - my) * 0.62], [xl + (xr - xl) * 0.62, yb + 9], [xl, yb])
  );
}
// 右弯竖：中格顶向右拱出，再落到基线（n / h / m）
function arch(x0, x1, yTop, yBot) {
  return join(
    cubic([x0, yTop + 10], [x0, yTop], [x1, yTop], [x1, yTop + 14]),
    line([x1, yTop + 14], [x1, yBot], 6)
  );
}

// ---------- 笔顺表：数组顺序 = 书写顺序 ----------
const LETTERS = {
  // ɑ：①左半圆 ②竖右弯
  a: { adv: 56.2, body: [
    lb(45.8, -45.1, -4.5, 10.8),
    join(V(45.8, -45.1, -7, 10), cubic([45.8, -7], [45.8, -3], [48, -1], [50.5, -1]))
  ] },
  // b：①竖 ②右半圆
  b: { adv: 56.4, body: [V(11.9, -72.4, -4.5, 16), rb(11.9, -45.1, -4.5, 46.1)] },
  // c：左半圆一笔
  c: { adv: 49.8, body: [lb(39.5, -45.1, -4.5, 10.3)] },
  // d：①左半圆 ②竖
  d: { adv: 58.1, body: [
    lb(48.3, -45.1, -4.5, 10.8),
    join(V(48.3, -72.4, -4, 16), cubic([48.3, -4], [48.3, -1], [50, 0], [52, 0], 6))
  ] },
  // e：一笔：先横，不抬笔再写左半圆
  e: { adv: 53.5, body: [
    join(
      H(-26, 10, 40),
      cubic([40, -26], [44, -31], [45, -36], [44, -40]),
      cubic([44, -40], [38, -47], [20, -48], [13, -40]),
      cubic([13, -40], [10, -34], [10, -28], [10, -22]),
      cubic([10, -22], [10, -13], [16, -7], [24, -6]),
      cubic([24, -6], [33, -5], [41, -9], [44, -14])
    )
  ] },
  // f：①弯竖 ②横
  f: { adv: 36.6, body: [
    join(cubic([33.6, -71], [24, -75.5], [16, -69], [16, -58]), V(16, -58, -5.7, 14)),
    H(-45, 9, 31.4)
  ] },
  // g：①左半圆 ②竖左弯
  g: { adv: 54.9, body: [
    lb(42.6, -45.1, -4.5, 10.8),
    join(V(42.6, -45.1, 11, 12), cubic([42.6, 11], [42.6, 19], [34, 22], [25, 19.5]))
  ] },
  // h：①竖 ②右弯竖
  h: { adv: 57.4, body: [V(12, -72.4, -5.7, 16), arch(12, 45.1, -44.3, -5.7)] },
  // i：①竖 ②点
  i: { adv: 27.6, body: [V(14, -44.3, -5.7, 12)], dots: [[14, -66]] },
  // j：①竖左弯 ②点
  j: { adv: 29.1, body: [
    join(V(15, -44.3, 11, 12), cubic([15, 11], [15, 20], [6, 22.5], [-3, 18]))
  ], dots: [[15, -66]] },
  // k：①竖 ②左斜右斜（一笔）
  k: { adv: 50.5, body: [
    V(12, -72.4, -5.7, 16),
    join(line([43.9, -44.5], [22, -25], 8), line([22, -25], [46, -5.7], 8))
  ] },
  // l：竖
  l: { adv: 27.6, body: [V(14, -72.4, -5.7, 16)] },
  // m：①竖 ②右弯竖 ③右弯竖
  m: { adv: 82.3, body: [V(11.8, -44.3, -5.7, 12), arch(11.8, 40.5, -44.3, -5.7), arch(40.5, 69, -44.3, -5.7)] },
  // n：①竖 ②右弯竖
  n: { adv: 57.9, body: [V(10.8, -44.3, -5.7, 12), arch(10.8, 45.6, -44.3, -5.7)] },
  // o：左上起笔，逆时针一笔画圆（角度递减 = 屏幕逆时针）
  o: { adv: 55.7, body: [arc(27.8, -24.8, 17.5, 20.3, -120, -480, 48)] },
  // p：①竖 ②右半圆
  p: { adv: 57.1, body: [V(10.8, -44.3, 18.2, 16), rb(10.8, -45.1, -5.7, 46.8)] },
  // q：①左半圆 ②竖
  q: { adv: 55.2, body: [lb(43.4, -45.1, -5.7, 10.8), V(43.4, -45.1, 18.2, 14)] },
  // r：①竖 ②右上弯
  r: { adv: 43.5, body: [V(10.8, -44.3, -5.7, 12), cubic([10.8, -37], [10.8, -45], [24, -46.5], [36.5, -44])] },
  // s：一笔，右上起笔
  s: { adv: 47.1, body: [
    join(
      cubic([37, -43], [26, -49], [12, -47], [10, -39]),
      cubic([8, -33], [16, -28], [24, -25]),
      cubic([34, -22], [38, -16], [34, -10]),
      cubic([29, -3], [16, -3], [9, -10])
    )
  ] },
  // t：①竖右弯 ②横
  t: { adv: 40.8, body: [
    join(V(16, -58.8, -9, 14), cubic([16, -9], [16, -5], [19, -4.2], [25, -4.2], 8)),
    H(-45, 7.2, 31.4)
  ] },
  // u：①竖右弯 ②竖
  u: { adv: 57.9, body: [
    join(V(11, -44.1, -16, 10), cubic([11, -8], [20, -4.2], [29, -4.2]), cubic([38, -4.2], [46, -8], [47.5, -14])),
    V(47.5, -44.1, -5.7, 12)
  ] },
  // ü：u + 两点（左→右）
  'ü': { adv: 57.9, body: [
    join(V(11, -44.1, -16, 10), cubic([11, -8], [20, -4.2], [29, -4.2]), cubic([38, -4.2], [46, -8], [47.5, -14])),
    V(47.5, -44.1, -5.7, 12)
  ], dots: [[18, -67], [39, -67]] },
  // w：①斜下斜上 ②斜下斜上
  w: { adv: 75.7, body: [
    join(line([7.9, -44.1], [21, -5.7], 10), line([21, -5.7], [37.5, -42], 10)),
    join(line([37.5, -42], [54, -5.7], 10), line([54, -5.7], [67.8, -44.1], 10))
  ] },
  // x：①右斜 ②左斜
  x: { adv: 53.0, body: [line([8.1, -44.1], [44.8, -5.7], 12), line([44.8, -44.1], [8.1, -5.7], 12)] },
  // y：①右斜 ②左斜（带下垂尾）
  y: { adv: 51.8, body: [
    line([4.7, -44.1], [26, -19], 10),
    join(line([45.1, -44.1], [21, 12], 12), cubic([21, 12], [18, 17], [12, 19], [5, 17.5]))
  ] },
  // z：一笔横折横
  z: { adv: 50.8, body: [
    join(line([10.8, -44.1], [40.4, -44.1], 8), line([40.4, -44.1], [12, -5.7], 10), line([12, -5.7], [40.4, -5.7], 8))
  ] }
};

// 带调字母 = 基础字母 + 声调符号
const TONED = {
  'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
  'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
  'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
  'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
  'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
  'ǖ': ['ü', 1], 'ǘ': ['ü', 2], 'ǚ': ['ü', 3], 'ǜ': ['ü', 4]
};

// ---------- 字形 → 轮廓 / 光栅 / 距离场 ----------
function glyphContoursOf(f, ch) {
  const p = f.charToGlyph(ch).getPath(0, 0, SIZE);
  const cs = [];
  let cur = null;
  for (const c of p.commands) {
    if (c.type === 'M') { cur = [[c.x, c.y]]; cs.push(cur); }
    else if (c.type === 'L') cur.push([c.x, c.y]);
    else if (c.type === 'Q') {
      const [px, py] = cur[cur.length - 1];
      for (let i = 1; i <= 10; i++) {
        const t = i / 10, u = 1 - t;
        cur.push([u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y]);
      }
    } else if (c.type === 'C') {
      const [px, py] = cur[cur.length - 1];
      const seg = cubic([px, py], [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y], 14);
      cur.push(...seg.slice(1));
    }
  }
  return cs.filter(c => c.length > 2);
}

const glyphContours = (ch) => glyphContoursOf(font, ch);

function raster(contours, ss = 4, pad = 4) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const c of contours) for (const [x, y] of c) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  const x0 = minx - pad, y0 = miny - pad;
  const W = Math.ceil((maxx - minx + 2 * pad) * ss), H = Math.ceil((maxy - miny + 2 * pad) * ss);
  const edges = [];
  for (const c of contours) for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
  }
  const data = new Uint8Array(W * H);
  const xs = [];
  for (let py = 0; py < H; py++) {
    const y = y0 + (py + 0.5) / ss;
    xs.length = 0;
    for (const e of edges) {
      if ((e[1] <= y && e[3] > y) || (e[3] <= y && e[1] > y)) xs.push(e[0] + (y - e[1]) / (e[3] - e[1]) * (e[2] - e[0]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const l = Math.max(0, Math.round((xs[i] - x0) * ss - 0.5));
      const r = Math.min(W - 1, Math.round((xs[i + 1] - x0) * ss - 0.5));
      for (let px = l; px <= r; px++) data[py * W + px] = 1;
    }
  }
  return { data, W, H, x0, y0, ss };
}

function distance(bin, W, H) {
  const INF = 1e9, d = new Float32Array(W * H), D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = bin[i] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!bin[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) v = Math.min(v, d[i - W] + 1);
    if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + D);
    if (x < W - 1 && y > 0) v = Math.min(v, d[i - W + 1] + D);
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!bin[i]) continue;
    let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < H - 1) v = Math.min(v, d[i + W] + 1);
    if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + D);
    if (x > 0 && y < H - 1) v = Math.min(v, d[i + W - 1] + D);
    d[i] = v;
  }
  return d;
}

// ---------- 声调符号：位置取字体里该调号的实际墨迹 ----------
function blobs(ch, ras) {
  const { data, W, H, x0, y0, ss } = ras;
  const comp = new Int32Array(W * H).fill(-1);
  const out = [];
  const stack = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i] || comp[i] !== -1) continue;
    const id = out.length;
    let area = 0;
    let bx1 = 1e9, by1 = 1e9, bx2 = -1, by2 = -1;
    stack.length = 0; stack.push(i); comp[i] = id;
    while (stack.length) {
      const p = stack.pop(); const x = p % W, y = (p / W) | 0;
      area++;
      if (x < bx1) bx1 = x; if (x > bx2) bx2 = x;
      if (y < by1) by1 = y; if (y > by2) by2 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!data[j] || comp[j] !== -1) continue;
        comp[j] = id; stack.push(j);
      }
    }
    out.push({ area: area / (ss * ss), x1: x0 + bx1 / ss, y1: y0 + by1 / ss,
      x2: x0 + (bx2 + 1) / ss, y2: y0 + (by2 + 1) / ss });
  }
  return out;
}

function toneStroke(ch, tone, ras) {
  const bs = blobs(ch, ras).sort((a, b) => a.y1 - b.y1);
  const top = bs[0];
  if (!top) return null;
  const pad = 3.2;
  const x1 = top.x1 + pad, x2 = top.x2 - pad, y1 = top.y1 + pad, y2 = top.y2 - pad;
  let pts;
  if (tone === 1) pts = line([x1, (y1 + y2) / 2], [x2, (y1 + y2) / 2], 6);       // 阴平：左→右
  else if (tone === 2) pts = line([x1, y2], [x2, y1], 8);                        // 阳平：左下起笔向上提
  else if (tone === 4) pts = line([x1, y1], [x2, y2], 8);                        // 去声：左上起笔向下
  else pts = join(line([x1, y1], [(x1 + x2) / 2, y2], 6),                         // 上声：下坡又上坡
                  line([(x1 + x2) / 2, y2], [x2, y1], 6));
  return { w: Math.min(8.2, Math.max(6, (top.y2 - top.y1) * 0.9)), p: pts };
}

const r2 = (v) => +v.toFixed(2);
const out = {};

// 参照包围盒（Andika，固化数据，构建时不再需要该字体文件）
const refBBox = (ch) => {
  const b = REF_BBOX[ch];
  return { x1: b[0], x2: b[1], y1: b[2], y2: b[3] };
};

// 目标字体包围盒（100 号字、y 向下）
function bboxOf(f, ch) {
  const b = f.charToGlyph(ch).getBoundingBox();
  const k = SIZE / f.unitsPerEm;
  return { x1: b.x1 * k, x2: b.x2 * k, y1: -b.y2 * k, y2: -b.y1 * k };
}
const BASE_OF = (ch) => (TONED[ch] ? TONED[ch][0] : ch);
// 快雪 W500 覆盖全部拼音字符；仍留一个兜底判断，缺字形时按基础字形处理
const hasGlyph = (f, ch) => f.charToGlyph(ch).index !== 0;
const geoFont = (ch) => (hasGlyph(font, ch) ? font : font);

// y 按度量分段映射：中格顶、上格、下格各自按比例
function mapY(y) {
  if (y < -REF.xh) return -CUR.xh + (y + REF.xh) * ((CUR.asc - CUR.xh) / (REF.asc - REF.xh));
  if (y > 0) return y * (CUR.desc / REF.desc);
  return y * (CUR.xh / REF.xh);
}

function build(ch, def) {
  const base = BASE_OF(ch);
  const gf = geoFont(ch);
  const rb = refBBox(base), nb = bboxOf(gf, base);
  const sx = (nb.x2 - nb.x1) / Math.max(1e-6, rb.x2 - rb.x1);
  const map = ([x, y]) => [nb.x1 + (x - rb.x1) * sx, mapY(y)];
  const body = def.body.map(pts => ({
    w: STROKE_W,
    p: pts.map(map).map(([x, y]) => [r2(x), r2(y)])
  }));
  if (def.dots) for (const [x0, y0] of def.dots) {
    const [x, y] = map([x0, y0]);
    body.push({ w: DOT_W, p: [[r2(x), r2(y)], [r2(x + 0.01), r2(y)]] });
  }
  const adv = +(gf.charToGlyph(ch).advanceWidth / gf.unitsPerEm * SIZE).toFixed(2);
  return { adv, body };
}

for (const [ch, def] of Object.entries(LETTERS)) {
  const rec = build(ch, def);
  out[ch] = { adv: rec.adv, body: rec.body, tones: [] };
}
for (const [ch, [base, tone]] of Object.entries(TONED)) {
  const rec = build(ch, LETTERS[base]);
  const ras = raster(glyphContoursOf(geoFont(ch), ch), 4, 4);
  const t = toneStroke(ch, tone, ras);
  out[ch] = { adv: rec.adv, body: rec.body, tones: t ? [{ w: +t.w.toFixed(2), p: t.p.map(([x, y]) => [r2(x), r2(y)]) }] : [] };
}

fs.writeFileSync(path.join(HERE, 'strokes.json'), JSON.stringify(out));
const n = Object.keys(out).length;
console.log('chars:', n, 'bytes:', fs.statSync(path.join(HERE, 'strokes.json')).size);
console.log('ü', 'body', out['ü'].body.length, '| ǎ tones', JSON.stringify(out['ǎ'].tones[0].p[0]));

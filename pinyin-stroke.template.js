/*
 * <pinyin-stroke> —— 一笔一画写拼音
 *
 * 字形 = ToneOZ 快雪拼音体 Medium / W500（英数版，蒙版裁出，单层 ɑ、圆体）。
 * 笔顺 = 按小学教材编排（tools/gen.mjs）：笔数、顺序、方向都与教材一致，
 *        声调符号在写完整个音节的所有字母之后才标（mā → m → a → ˉ）。
 * 动效 = 笔尖沿编排好的笔画逐笔推进，蒙版随之露出字形；不是整字横向擦除。
 *
 *   <script src="pinyin-stroke.js"></script>
 *   <pinyin-stroke text="mā hǎo" autoplay loop></pinyin-stroke>
 *
 * 属性：text / speed / gap / grid / loop / color / autoplay / pen / taper / easing
 *   pen="flat"      圆头笔尖，笔迹等宽（默认）
 *   pen="brush"     笔锋：起笔渐粗、收笔提细（带子裁剪字形，思路同 strokesvg）
 *   taper           笔锋强度 0~1，默认 0.5（仅 brush 生效）
 *   easing="linear|natural"  行笔节奏，natural = 起笔快、收笔缓
 * 方法：play() pause() reset() replay() seek(0~1)
 */
(function () {
  'use strict';

  const FONT_SRC = '__FONT_SRC__';
  const FONT_FAMILY = "'PSToneOZ','ToneOZ-Quicksnow','Quicksand','Andika',sans-serif";

  // 字形 → 笔画中心线。坐标：100 号字、y 向下、基线 y=0
  const DATA = __STROKES__;

  function ensureFont() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('ps-andika-font')) return;
    const st = document.createElement('style');
    st.id = 'ps-andika-font';
    st.textContent =
      "@font-face{font-family:'PSToneOZ';src:url(" + FONT_SRC + ") format('woff2');" +
      "font-weight:400;font-style:normal;font-display:swap;}" +
      "font-weight:400;font-style:normal;font-display:swap;}";
    (document.head || document.documentElement).appendChild(st);
  }
  ensureFont();

  const FS = 74;      // 字号（用户单位）
  const BASE = 118;   // 基线
  const TRACK = 9;    // 字距（100 号字单位）
  const SCALE = FS / 100;
  const PEN_PAD = 3;    // 蒙版笔宽 = 笔画宽 + 5：宽一点才不会漏出字形的边

  // 四线三格（快雪 W500 度量：asc 74.0 / x-height 52.3 / desc 20.0）
  const L1 = BASE - 74.0 * SCALE;
  const L2 = BASE - 52.3 * SCALE;
  const L3 = BASE;
  const L4 = BASE + 20.0 * SCALE;

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 折线 → 圆滑路径（二次贝塞尔穿过中点）
  function penD(pts) {
    if (pts.length === 1) return `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)} l0.01,0`;
    if (pts.length === 2) return `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)} L${pts[1][0].toFixed(2)},${pts[1][1].toFixed(2)}`;
    let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0].toFixed(2)},${pts[i][1].toFixed(2)} ${mx.toFixed(2)},${my.toFixed(2)}`;
    }
    const e = pts[pts.length - 1];
    d += ` L${e[0].toFixed(2)},${e[1].toFixed(2)}`;
    return d;
  }

  // ---- 笔锋：把折线扩成「宽度随压力变化」的带子 ----
  const R2 = (v) => (Math.round(v * 100) / 100).toString();
  const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  function polyLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  function cumLen(pts) {
    const c = [0];
    for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return c;
  }

  // 按弧长把折线截到比例 k（行笔到哪儿就露出到哪儿）
  function clipPoly(pts, cum, total, k) {
    if (pts.length < 2) return pts.slice();
    const target = total * k;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= target) { out.push(pts[i]); continue; }
      const seg = cum[i] - cum[i - 1] || 1e-6;
      const f = Math.max(0, Math.min(1, (target - cum[i - 1]) / seg));
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
                pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
      break;
    }
    if (out.length < 2) out.push([out[0][0] + 0.01, out[0][1]]);
    return out;
  }

  // 压力曲线：u 为该点在全笔弧长上的比例；起笔 18% 内渐入，收笔 32% 内提细
  const MAX_THIN = 0.4;
  function penR(rBase, u, taper) {
    if (taper <= 0) return rBase;
    const k = Math.min(smoothstep(u / 0.18), smoothstep((1 - u) / 0.32));
    return rBase * (1 - MAX_THIN * taper * (1 - k));
  }

  function unitFrom(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-6;
    return [dx / l, dy / l];
  }

  function capArc(nv, tv, r, c, dir) {
    let s = '';
    for (let i = 1; i <= 6; i++) {
      const a = (Math.PI * i) / 6;
      const ca = Math.cos(a) * dir, sa = Math.sin(a) * dir;
      s += `L${R2(c[0] + r * (ca * nv[0] + sa * tv[0]))},${R2(c[1] + r * (ca * nv[1] + sa * tv[1]))}`;
    }
    return s;
  }

  // 行笔前端：横过笔迹的「笔锋边缘」（略微前凸），比半圆更像笔尖在走
  function frontCap(nv, tv, r, c, bulge) {
    let s = '';
    for (let i = 1; i <= 4; i++) {
      const a = (Math.PI * i) / 4;
      const ca = Math.cos(a), sa = Math.sin(a) * bulge;
      s += `L${R2(c[0] + r * (ca * nv[0] + sa * tv[0]))},${R2(c[1] + r * (ca * nv[1] + sa * tv[1]))}`;
    }
    return s;
  }

  function ribbonD(pts, total, rBase, taper, closed) {
    if (!pts.length) return '';
    const len = polyLen(pts);
    if (len < 0.8) {                                   // 点：笔尖一按
      const r = Math.max(0.5, penR(rBase, 0, taper));
      const [x, y] = pts[0];
      return `M${R2(x - r)},${R2(y)}a${R2(r)},${R2(r)} 0 1,0 ${R2(2 * r)},0` +
             `a${R2(r)},${R2(r)} 0 1,0 ${R2(-2 * r)},0Z`;
    }
    const n = pts.length;
    const cum = cumLen(pts);
    const T = total || len;
    const nv = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-6;
      nv.push([-dy / l, dx / l]);
    }
    const left = [], right = [];
    let rEnd = rBase, rStart = rBase;
    for (let i = 0; i < n; i++) {
      const r = penR(rBase, Math.min(1, cum[i] / T), taper);
      if (i === 0) rStart = r;
      if (i === n - 1) rEnd = r;
      left.push([pts[i][0] + nv[i][0] * r, pts[i][1] + nv[i][1] * r]);
      right.push([pts[i][0] - nv[i][0] * r, pts[i][1] - nv[i][1] * r]);
    }
    let d = `M${R2(left[0][0])},${R2(left[0][1])}`;
    for (let i = 1; i < n; i++) d += `L${R2(left[i][0])},${R2(left[i][1])}`;
    d += closed
      ? capArc(nv[n - 1], unitFrom(pts[n - 2], pts[n - 1]), rEnd, pts[n - 1], 1)
      : frontCap(nv[n - 1], unitFrom(pts[n - 2], pts[n - 1]), rEnd, pts[n - 1], 0.18);
    for (let i = n - 1; i >= 0; i--) d += `L${R2(right[i][0])},${R2(right[i][1])}`;
    d += capArc(nv[0], unitFrom(pts[0], pts[1]), rStart, pts[0], -1);
    return d + 'Z';
  }

  class PinyinStroke extends HTMLElement {
    static get observedAttributes() {
      return ['text', 'speed', 'gap', 'grid', 'loop', 'color', 'autoplay', 'pen', 'taper', 'easing'];
    }

    constructor() {
      super();
      this._raf = null;
      this._idx = 0;
      this._playing = false;
      this._steps = [];
      this._fontRequested = false;
      this.attachShadow({ mode: 'open' });
    }

    connectedCallback() { ensureFont(); this._render(); }
    attributeChangedCallback() { if (this.isConnected) this._render(); }

    get _text() { return (this.getAttribute('text') || '').trim(); }
    get _speed() { return Math.max(80, parseInt(this.getAttribute('speed'), 10) || 800); }
    get _gap() { return Math.max(0, parseInt(this.getAttribute('gap'), 10) || 160); }
    get _grid() { const v = this.getAttribute('grid'); return v === null || v === 'true' || v === ''; }
    get _loop() { return this.hasAttribute('loop'); }
    get _color() { return this.getAttribute('color') || '#c0392b'; }
    get _autoplay() { const v = this.getAttribute('autoplay'); return v === null || v === 'true' || v === ''; }
    get _pen() { return this.getAttribute('pen') === 'brush' ? 'brush' : 'flat'; }
    get _taper() {
      const v = parseFloat(this.getAttribute('taper'));
      return isNaN(v) ? 0.5 : Math.min(1, Math.max(0, v));
    }
    get _easing() { return this.getAttribute('easing') === 'natural' ? 'natural' : 'linear'; }

    _render() {
      this._stop();
      this._idx = 0;
      this._steps = [];

      const chars = [];
      for (const ch of this._text) {
        if (ch === ' ' || ch === '\t' || ch === '\n') { chars.push({ space: true }); continue; }
        chars.push({ ch, d: DATA[ch] || DATA[ch.toLowerCase()] || null });
      }

      this.shadowRoot.innerHTML = `<style>${this._css()}</style><div class="ps-wrap"></div>`;
      const wrap = this.shadowRoot.querySelector('.ps-wrap');
      if (!chars.length) { wrap.innerHTML = `<svg viewBox="0 0 84 140"></svg>`; return; }

      // 字体加载完成后重排一次（量出来的格子才准）
      if (document.fonts && document.fonts.load && !this._fontRequested) {
        this._fontRequested = true;
        document.fonts.load(FS + 'px PSToneOZ').then(() => {
          if (this.isConnected) this._render();
        }).catch(() => {});
      }

      // 排版
      const cells = [];
      const syllables = [];        // 音节 = 一串相邻字母，调号写在这个音节末尾
      let cursor = 0, cur = null;
      for (const t of chars) {
        if (t.space) { cursor += FS * 0.30; cur = null; continue; }
        const adv = t.d ? t.d.adv : 55;
        const w = adv * SCALE;
        const idx = cells.length;
        cells.push({ t, x: cursor, w, adv });
        if (!cur) { cur = []; syllables.push(cur); }
        cur.push(idx);
        cursor += w + TRACK;
      }
      const W = Math.max(1, cursor - TRACK);

      // 顶部留白：按数据里最高的调号（ǚ/ǜ 的 caron 会顶到上格线以上）动态算，避免被裁
      let toneTop = -60;
      for (const dd of Object.values(DATA)) {
        for (const st of dd.tones || []) for (const q of st.p) if (q[1] < toneTop) toneTop = q[1];
      }
      const vbTop = Math.min(L1 - FS * 0.22, BASE + toneTop * SCALE - 10);
      const vbBottom = L4 + FS * 0.10;
      const vbH = vbBottom - vbTop;

      const brush = this._pen === 'brush';
      const taper = this._taper;
      const color = this._color;

      let defs = '', body = '';
      cells.forEach((c, i) => {
        const ch = c.t.ch, d = c.t.d;
        const ox = c.x + c.w / 2;              // text-anchor=middle 的锚点
        body += `<text class="ps-guide" x="${ox.toFixed(2)}" y="${BASE}" text-anchor="middle">${esc(ch)}</text>`;

        const strokes = [];
        if (d) {
          for (const s of d.body || []) strokes.push({ s, tone: false });
          for (const s of d.tones || []) strokes.push({ s, tone: true });
        }
        c.strokes = strokes;

        if (!strokes.length) {
          body += `<text class="ps-ink" x="${ox.toFixed(2)}" y="${BASE}" text-anchor="middle" fill="${color}">${esc(ch)}</text>`;
          return;
        }

        let pens = '';
        strokes.forEach((st, j) => {
          const pts = st.s.p.map(([px, py]) => [c.x + px * SCALE, BASE + py * SCALE]);
          st.pts = pts;
          st.w = (st.s.w + PEN_PAD) * SCALE;
          st.closed = pts.length > 2 &&
            Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < st.w;
          pens += brush
            ? `<path class="pen" data-c="${i}" data-j="${j}" fill="#fff" stroke="none" d=""/>`
            : `<path class="pen" data-c="${i}" data-j="${j}" d="${penD(pts)}" stroke="#fff" fill="none" ` +
              `stroke-width="${st.w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        });

        // 补齐用的矩形：字母身体写完补一次，调号写完再补调号那一块
        // （编排笔迹和字形有细微偏差，笔尖会留下没露出的边，这里兜住）
        const toneYs = [];
        for (const st of strokes) if (st.tone) for (const q of st.s.p) toneYs.push(q[1]);
        const bodyTop = toneYs.length ? BASE + Math.max(...toneYs) * SCALE + 2 : vbTop - 20;
        let flush = `<rect class="ps-flush-body" x="${(c.x - 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${(c.w + 6).toFixed(1)}" height="${(vbBottom + 20 - bodyTop).toFixed(1)}" fill="#fff" opacity="0"/>`;
        if (toneYs.length) {
          const t0 = BASE + Math.min(...toneYs) * SCALE - 7;
          const t1 = BASE + Math.max(...toneYs) * SCALE + 3;
          flush += `<rect class="ps-flush-tone" x="${(c.x - 2).toFixed(1)}" y="${t0.toFixed(1)}" width="${(c.w + 6).toFixed(1)}" height="${(t1 - t0).toFixed(1)}" fill="#fff" opacity="0"/>`;
        }

        defs += `<mask id="psm${i}" maskUnits="userSpaceOnUse" x="-20" y="${(vbTop - 20).toFixed(1)}" width="${(W + 40).toFixed(1)}" height="${(vbH + 40).toFixed(1)}">` +
                `${pens}${flush}` +
                `</mask>`;
        body += `<g mask="url(#psm${i})"><text class="ps-ink" x="${ox.toFixed(2)}" y="${BASE}" text-anchor="middle" fill="${color}">${esc(ch)}</text></g>`;
      });

      let grid = '';
      if (this._grid) {
        const line = (y, dash) => `<line x1="0" y1="${y.toFixed(2)}" x2="${W.toFixed(2)}" y2="${y.toFixed(2)}" class="ps-line${dash ? ' dashed' : ''}"/>`;
        grid = `<g class="ps-grid">${line(L1)}${line(L2, true)}${line(L3)}${line(L4)}</g>`;
      }

      const PAD_X = 8;   // 左右留白：首字母可能左出锋（j），末字母可能右出锋（l）
      wrap.innerHTML = `
        <svg viewBox="${-PAD_X} ${vbTop.toFixed(2)} ${(W + PAD_X * 2).toFixed(2)} ${vbH.toFixed(2)}" preserveAspectRatio="xMidYMid meet">
          <defs>${defs}</defs>
          ${grid}${body}
        </svg>`;

      // 行笔：flat = 圆头笔尖 + dashoffset；brush = 每帧重建一条带压力的带子
      const easing = this._easing;
      const ease = easing === 'natural' ? (k) => k * k * (3 - 2 * k) : (k) => k;
      const pens = Array.from(wrap.querySelectorAll('.pen'));
      pens.forEach((p) => {
        const st = cells[+p.dataset.c].strokes[+p.dataset.j];
        p.__st = st;
        if (brush) {
          p.__pts = st.pts;
          p.__cum = cumLen(st.pts);
          p.__len = polyLen(st.pts);
          p.__r = st.w / 2;
          p.__taper = st.closed ? taper * 0.15 : taper;
          p.__closed = st.closed;
        } else {
          const len = p.getTotalLength();
          p.style.strokeDasharray = len;
          p.style.strokeDashoffset = len;
          p.__len = len;
        }
      });

      const makeStep = (p, gap, dur) => {
        if (brush) {
          const pts = p.__pts, cum = p.__cum, L = p.__len, r = p.__r, tp = p.__taper, cl = p.__closed;
          return {
            dur, gap,
            apply(kk) {
              const q = ease(kk);
              p.setAttribute('d', q <= 0 ? '' : ribbonD(clipPoly(pts, cum, L, q), L, r, tp, cl));
            }
          };
        }
        return { dur, gap, apply(kk) { p.style.strokeDashoffset = p.__len * (1 - ease(kk)); } };
      };

      const speed = this._speed;
      const strokeGap = Math.min(60, Math.round(this._gap * 0.4));
      const toneDur = Math.max(110, Math.min(260, Math.round(speed * 0.18)));

      // 每个音节：先写完所有字母的身体笔画，再标调
      for (const syl of syllables) {
        for (const ci of syl) {
          const arr = pens.filter((p) => +p.dataset.c === ci && !p.__st.tone);
          const total = arr.reduce((a, p) => a + p.__len, 0) || 1;
          arr.forEach((p, k) => {
            this._steps.push(makeStep(p, k === arr.length - 1 ? 0 : strokeGap,
              Math.max(70, speed * p.__len / total)));
          });
          // 字母写完立刻补齐：笔迹和字形有细微偏差，不补会看到缺笔
          const fb = wrap.querySelector(`#psm${ci} .ps-flush-body`);
          if (fb) this._steps.push({ dur: 120, gap: this._gap, apply(kk) { fb.setAttribute('opacity', kk); } });
        }
        for (const ci of syl) {
          const arr = pens.filter((p) => +p.dataset.c === ci && p.__st.tone);
          arr.forEach((p, k) => {
            this._steps.push(makeStep(p, k === arr.length - 1 ? 0 : strokeGap, toneDur));
          });
          const ft = wrap.querySelector(`#psm${ci} .ps-flush-tone`);
          if (ft) this._steps.push({ dur: 70, gap: this._gap, apply(kk) { ft.setAttribute('opacity', kk); } });
        }
      }

      if (this._autoplay) this.play();
    }

    _css() {
      return `
        :host { display:inline-block; width:100%; }
        .ps-wrap { width:100%; }
        svg { width:100%; height:auto; display:block; overflow:visible; }
        .ps-line { stroke:#d9cbb8; stroke-width:1.1; }
        .ps-line.dashed { stroke-dasharray:5 5; stroke:#e2d6c6; }
        .ps-guide, .ps-ink {
          font-family:${FONT_FAMILY};
          font-size:${FS}px;
        }
        .ps-guide { fill:#e8e1d3; }
      `;
    }

    // ---- 播放控制 ----
    play() {
      if (this._playing) return;
      if (!this._steps.length) return;
      if (this._idx >= this._steps.length) this.reset();
      this._playing = true;
      this._step();
    }

    _step() {
      if (!this._playing) return;
      if (this._idx >= this._steps.length) {
        this._playing = false;
        if (this._loop) {
          setTimeout(() => {
            if (!this._loop || !this.isConnected) return;
            this.reset();
            this.play();
          }, this._gap + 320);
        }
        return;
      }
      const st = this._steps[this._idx];
      const t0 = performance.now();
      const frame = (now) => {
        if (!this._playing) return;
        const k = Math.min(1, (now - t0) / st.dur);
        st.apply(k);
        if (k < 1) {
          this._raf = requestAnimationFrame(frame);
        } else {
          this._idx++;
          const g = (st.gap !== undefined) ? st.gap : this._gap;
          this._raf = setTimeout(() => this._step(), g);
        }
      };
      this._raf = requestAnimationFrame(frame);
    }

    pause() { this._stop(); }

    // 拖到整段动画的某个进度（0~1），便于逐帧看行笔
    seek(p) {
      this._stop();
      if (!this._steps.length) return;
      const total = this._steps.reduce((a, s) => a + s.dur + (s.gap || 0), 0) || 1;
      const target = Math.max(0, Math.min(1, p)) * total;
      let t = 0, next = this._steps.length;
      this._steps.forEach((s, i) => {
        const local = Math.max(0, Math.min(1, (target - t) / (s.dur || 1)));
        s.apply(local);
        if (local < 1 && next === this._steps.length) next = i;
        t += s.dur + (s.gap || 0);
      });
      this._idx = next;
    }

    reset() {
      this._stop();
      this._idx = 0;
      this._steps.forEach((s) => s.apply(0));
    }

    replay() { this.reset(); this.play(); }

    _stop() {
      this._playing = false;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        clearTimeout(this._raf);
        this._raf = null;
      }
    }
  }

  if (!customElements.get('pinyin-stroke')) {
    customElements.define('pinyin-stroke', PinyinStroke);
  }
})();

/* Uxearly Inspect — content script (isolated world). Built from src/engine.js + src/ui.js by build.sh.
 * Security notes:
 *  - All page-derived text is rendered with textContent / text nodes. No innerHTML anywhere.
 *  - UI lives in a closed shadow root so page CSS/JS cannot style or read it.
 *  - No analytics, no remote code. Network is only used to fetch an image the user chose to download,
 *    and nothing leaves the browser. Preferences are kept in chrome.storage.local on this device.
 */
(() => {
  'use strict';
  // Each build gets a unique id (set by build.sh). A panel from an older build, or one whose
  // extension context died after an update, is replaced instead of toggled.
  const BUILD = '__UXI_BUILD__';
  const auto = window.__uxiAuto === true; // set by the service worker when restoring after a reload
  window.__uxiAuto = false;
  const action = window.__uxiAction === 'selection' ? 'selection' : null; // opened from the right-click menu
  window.__uxiAction = null;
  const prev = window.__uxiInstance;
  if (prev) {
    let alive = false;
    try { alive = prev.build === BUILD && prev.alive(); } catch (_) { alive = false; }
    if (alive) { if (!auto) prev.toggle(); return; }
    try { prev.destroy(); } catch (_) { /* old context */ }
    delete window.__uxiInstance;
  }
  for (const orphan of Array.from(document.querySelectorAll('uxi-inspect'))) orphan.remove();

  const MAX_SCAN = 6000;
  const MAX_CODE_NODES = 150;
  const Z = '2147483647';

  // ───────────────────────── DOM helper (safe) ─────────────────────────
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = String(v);
        else if (k === 'style') e.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      e.append(k instanceof Node ? k : String(k));
    }
    return e;
  }

  // ───────────────────────── Color utils ─────────────────────────
  const cctx = (() => {
    try { return new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }); }
    catch (_) { const c = document.createElement('canvas'); c.width = c.height = 1; return c.getContext('2d', { willReadFrequently: true }); }
  })();
  const colorCache = new Map();
  const RGB_RE = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

  function parseColor(str) {
    if (!str || typeof str !== 'string') return null;
    str = str.trim();
    if (colorCache.has(str)) return colorCache.get(str);
    let res = null;
    const m = RGB_RE.exec(str);
    if (m) {
      let a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      res = { r: clamp255(+m[1]), g: clamp255(+m[2]), b: clamp255(+m[3]), a: Math.round(a * 100) / 100 };
    } else if (str !== 'none' && str !== 'currentcolor' && str !== 'transparent') {
      // oklch(), color(), lab(), named colors... let the browser resolve to pixels
      const SENT = 'rgba(1, 2, 3, 0.5)';
      cctx.fillStyle = SENT;
      cctx.fillStyle = str;
      if (cctx.fillStyle !== SENT || str === SENT) {
        cctx.clearRect(0, 0, 1, 1);
        cctx.fillRect(0, 0, 1, 1);
        const d = cctx.getImageData(0, 0, 1, 1).data;
        res = { r: d[0], g: d[1], b: d[2], a: Math.round((d[3] / 255) * 100) / 100 };
      }
    } else if (str === 'transparent') res = { r: 0, g: 0, b: 0, a: 0 };
    if (colorCache.size > 8000) colorCache.clear();
    colorCache.set(str, res);
    return res;
  }
  function clamp255(n) { return Math.max(0, Math.min(255, Math.round(n))); }
  const hx = (n) => n.toString(16).padStart(2, '0');
  function toHex(c) { return '#' + hx(c.r) + hx(c.g) + hx(c.b) + (c.a < 1 ? hx(Math.round(c.a * 255)) : ''); }
  function toRgb(c) { return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})` : `rgb(${c.r}, ${c.g}, ${c.b})`; }
  function toHslObj(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let hh = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hh = (g - b) / d + (g < b ? 6 : 0); else if (max === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
      hh *= 60;
    }
    return { h: Math.round(hh), s: Math.round(s * 100), l: Math.round(l * 100) };
  }
  function toHsl(c) { const o = toHslObj(c); return c.a < 1 ? `hsla(${o.h}, ${o.s}%, ${o.l}%, ${c.a})` : `hsl(${o.h}, ${o.s}%, ${o.l}%)`; }
  function fmtColor(c, f) { return f === 'rgb' ? toRgb(c) : f === 'hsl' ? toHsl(c) : toHex(c); }
  function relLum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) { const l1 = relLum(a), l2 = relLum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  function blend(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 255, g: 255, b: 255, a: 1 };
    const ch = (t, b2) => Math.round((t * top.a + b2 * bottom.a * (1 - top.a)) / a);
    return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a: 1 };
  }
  function effectiveBg(el) {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  }
  // Replace every rgb()/rgba() inside a CSS value with hex
  function hexify(v) { return v.replace(/rgba?\([^)]*\)/gi, (m) => { const c = parseColor(m); return c ? toHex(c) : m; }); }

  // ───────────────────────── Font utils ─────────────────────────
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
  const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
  function splitFamilies(stack) {
    return String(stack).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  const availCache = new Map();
  const mctx = (() => { const c = document.createElement('canvas'); return c.getContext('2d'); })();
  function fontAvailable(fam) {
    const key = fam.toLowerCase();
    if (GENERIC.has(key)) return true;
    if (availCache.has(key)) return availCache.get(key);
    let ok = false;
    try {
      for (const f of document.fonts) {
        if (f.family.replace(/^["']|["']$/g, '').toLowerCase() === key && f.status === 'loaded') { ok = true; break; }
      }
    } catch (_) { /* ignore */ }
    if (!ok) {
      const txt = 'mmmmmmmmmmlli1WQ@#';
      for (const base of ['monospace', 'serif', 'sans-serif']) {
        mctx.font = `72px ${base}`;
        const w0 = mctx.measureText(txt).width;
        mctx.font = `72px "${fam.replace(/"/g, '')}", ${base}`;
        if (Math.abs(mctx.measureText(txt).width - w0) > 0.5) { ok = true; break; }
      }
    }
    availCache.set(key, ok);
    return ok;
  }
  function renderedFont(stack) {
    for (const f of splitFamilies(stack)) if (fontAvailable(f)) return f;
    return splitFamilies(stack)[0] || '';
  }
  function primaryFamily(stack) { return splitFamilies(stack)[0] || ''; }
  function px(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  function round(n, d = 2) { const p = Math.pow(10, d); return Math.round(n * p) / p; }
  function rootFontPx() { return px(getComputedStyle(document.documentElement).fontSize) || 16; }

  function fontInfo(el) {
    const cs = getComputedStyle(el);
    const size = px(cs.fontSize);
    const lhPx = cs.lineHeight === 'normal' ? null : px(cs.lineHeight);
    const color = parseColor(cs.color);
    const bg = effectiveBg(el);
    const w = parseInt(cs.fontWeight, 10);
    return {
      stack: cs.fontFamily,
      family: primaryFamily(cs.fontFamily),
      rendered: renderedFont(cs.fontFamily),
      size, sizeRem: size ? round(size / rootFontPx(), 3) : null,
      weight: w, weightName: WEIGHT_NAMES[Math.round(w / 100) * 100] || '',
      lineHeight: cs.lineHeight, lhPx, lhRatio: lhPx && size ? round(lhPx / size, 2) : null,
      letterSpacing: cs.letterSpacing,
      style: cs.fontStyle, transform: cs.textTransform, align: cs.textAlign,
      decoration: cs.textDecorationLine,
      color, bg, contrast: color ? round(contrast(blend(color, bg), bg), 2) : null
    };
  }

  // ───────────────────────── Element utils ─────────────────────────
  function isVisible(el) {
    try { if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true }); } catch (_) { /* old chrome */ }
    return el.getClientRects().length > 0;
  }
  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }
  function label(el) {
    let s = el.tagName.toLowerCase();
    if (el.id && el.id.length < 40) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    if (cls.length) s += '.' + cls.slice(0, 2).join('.');
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }
  function cssIdent(s) { try { return CSS.escape(s); } catch (_) { return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'); } }
  function rootSelector(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && /^[a-zA-Z][\w-]{0,40}$/.test(el.id) && document.querySelectorAll('#' + cssIdent(el.id)).length === 1) return '#' + cssIdent(el.id);
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => c && c.length < 60).slice(0, 3) : [];
    return tag + cls.map((c) => '.' + cssIdent(c)).join('');
  }

  // ───────────────────────── CSS extraction ─────────────────────────
  const INLINE = new Set(['a', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'label', 'code', 'abbr', 'sub', 'sup', 'mark', 'q', 'cite', 'time', 'img', 'svg', 'br', 'kbd', 'var', 'picture', 'video', 'canvas', 'iframe', 'audio']);
  const INLINE_BLOCK = new Set(['button', 'input', 'select', 'textarea', 'meter', 'progress']);
  const TABLE_DISPLAY = { table: 'table', tr: 'table-row', td: 'table-cell', th: 'table-cell', thead: 'table-header-group', tbody: 'table-row-group', tfoot: 'table-footer-group', caption: 'table-caption', col: 'table-column', colgroup: 'table-column-group' };
  function defaultDisplay(tag) {
    if (INLINE.has(tag)) return 'inline';
    if (INLINE_BLOCK.has(tag)) return 'inline-block';
    if (tag === 'li') return 'list-item';
    if (TABLE_DISPLAY[tag]) return TABLE_DISPLAY[tag];
    return 'block';
  }
  const REPLACED = /^(img|svg|video|canvas|iframe|input|textarea|select|picture|object|embed)$/;
  const z0 = (v) => (v === '0px' ? '0' : v);
  const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'link', 'meta', 'head', 'title', 'base']);

  function extractDecls(el, isRoot) {
    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    const tag = el.tagName.toLowerCase();
    const d = [];
    const push = (p, v) => d.push([p, hexify(String(v))]);
    const display = cs.display;
    // Children of flex/grid containers are "blockified" by the browser; that isn't authored CSS.
    const blockified = pcs && /flex|grid/.test(pcs.display) && display === 'block';
    if (display !== defaultDisplay(tag) && !blockified) push('display', display);
    if (display === 'none') return d;

    // Position
    if (cs.position !== 'static') {
      push('position', cs.position);
      for (const s of ['top', 'right', 'bottom', 'left']) if (cs[s] !== 'auto') push(s, z0(cs[s]));
    }
    if (cs.zIndex !== 'auto') push('z-index', cs.zIndex);

    // Size
    const abs = cs.position === 'absolute' || cs.position === 'fixed';
    const pIsFlexGrid = pcs && /flex|grid/.test(pcs.display);
    if (REPLACED.test(tag) || abs) {
      push('width', cs.width); push('height', cs.height);
    } else {
      if (el.style.width) push('width', el.style.width);
      else if (display === 'block' && parent && !pIsFlexGrid && cs.maxWidth === 'none') {
        const pr = parent.getBoundingClientRect();
        const pw = pr.width - (px(pcs.paddingLeft) || 0) - (px(pcs.paddingRight) || 0) - (px(pcs.borderLeftWidth) || 0) - (px(pcs.borderRightWidth) || 0);
        const ew = el.getBoundingClientRect().width + (px(cs.marginLeft) || 0) + (px(cs.marginRight) || 0);
        if (pw > 0 && Math.abs(ew - pw) > 1.5) push('width', cs.width);
      }
      if (el.style.height) push('height', el.style.height);
    }
    if (cs.maxWidth !== 'none') push('max-width', cs.maxWidth);
    if (cs.minWidth !== 'auto' && cs.minWidth !== '0px') push('min-width', cs.minWidth);
    if (cs.maxHeight !== 'none') push('max-height', cs.maxHeight);
    if (cs.minHeight !== 'auto' && cs.minHeight !== '0px') push('min-height', cs.minHeight);
    if (cs.aspectRatio && cs.aspectRatio !== 'auto') push('aspect-ratio', cs.aspectRatio);

    // margin: detect `auto` centering (computed style resolves it to px)
    const mv = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].map((k) => z0(cs[k]));
    if (parent && !abs && !pIsFlexGrid && mv[1] === mv[3] && mv[1] !== '0' && /^(block|flex|grid|table)$/.test(display)) {
      const pr = parent.getBoundingClientRect();
      const pcw = pr.width - (px(pcs.paddingLeft) || 0) - (px(pcs.paddingRight) || 0) - (px(pcs.borderLeftWidth) || 0) - (px(pcs.borderRightWidth) || 0);
      const w = el.getBoundingClientRect().width;
      if (Math.abs((pcw - w) / 2 - (px(mv[1]) || 0)) < 1.5) { mv[1] = 'auto'; mv[3] = 'auto'; }
    }
    if (!mv.every((x) => x === '0')) d.push(['margin', compact4(mv)]);
    box4(d, cs, 'padding', ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);

    // Flex / grid container
    if (/flex/.test(display)) {
      if (cs.flexDirection !== 'row') push('flex-direction', cs.flexDirection);
      if (cs.flexWrap !== 'nowrap') push('flex-wrap', cs.flexWrap);
      if (cs.justifyContent !== 'normal') push('justify-content', cs.justifyContent);
      if (cs.alignItems !== 'normal') push('align-items', cs.alignItems);
      if (cs.alignContent !== 'normal') push('align-content', cs.alignContent);
      gap(d, cs);
    } else if (/grid/.test(display)) {
      if (cs.gridTemplateColumns !== 'none') push('grid-template-columns', cs.gridTemplateColumns);
      if (cs.gridTemplateRows !== 'none') push('grid-template-rows', cs.gridTemplateRows);
      if (cs.gridAutoFlow !== 'row') push('grid-auto-flow', cs.gridAutoFlow);
      if (cs.justifyItems !== 'normal' && cs.justifyItems !== 'legacy') push('justify-items', cs.justifyItems);
      if (cs.alignItems !== 'normal') push('align-items', cs.alignItems);
      if (cs.justifyContent !== 'normal') push('justify-content', cs.justifyContent);
      gap(d, cs);
    }
    // Flex / grid item
    if (pIsFlexGrid) {
      if (cs.flexGrow !== '0') push('flex-grow', cs.flexGrow);
      if (cs.flexShrink !== '1') push('flex-shrink', cs.flexShrink);
      if (cs.flexBasis !== 'auto') push('flex-basis', cs.flexBasis);
      if (cs.alignSelf !== 'auto') push('align-self', cs.alignSelf);
      if (cs.order !== '0') push('order', cs.order);
      if (/grid/.test(pcs.display)) {
        if (cs.gridColumn && cs.gridColumn !== 'auto' && cs.gridColumn !== 'auto / auto') push('grid-column', cs.gridColumn);
        if (cs.gridRow && cs.gridRow !== 'auto' && cs.gridRow !== 'auto / auto') push('grid-row', cs.gridRow);
      }
    }

    // Typography (inherited props: only when different from parent, always on root)
    const inh = [['font-family', 'fontFamily'], ['font-size', 'fontSize'], ['font-weight', 'fontWeight'], ['font-style', 'fontStyle'], ['line-height', 'lineHeight'], ['letter-spacing', 'letterSpacing'], ['color', 'color'], ['text-align', 'textAlign'], ['text-transform', 'textTransform'], ['white-space', 'whiteSpace'], ['cursor', 'cursor']];
    const rootAlways = new Set(['font-family', 'font-size', 'font-weight', 'line-height', 'color']);
    for (const [p, k] of inh) {
      const v = cs[k];
      if (tag === 'a' && p === 'cursor' && v === 'pointer') continue; // UA default for links
      if (isRoot ? (rootAlways.has(p) || !pcs || v !== pcs[k]) : (pcs && v !== pcs[k])) {
        if (isRoot && !rootAlways.has(p) && ((p === 'font-style' && v === 'normal') || (p === 'letter-spacing' && v === 'normal') || (p === 'text-align' && v === 'start') || (p === 'text-transform' && v === 'none') || (p === 'white-space' && v === 'normal') || (p === 'cursor' && v === 'auto'))) continue;
        push(p, v);
      }
    }
    const uaUnderline = tag === 'a' && cs.textDecorationLine === 'underline';
    if (tag === 'a' && cs.textDecorationLine === 'none' && (!pcs || pcs.textDecorationLine === 'none')) push('text-decoration', 'none');
    else if (cs.textDecorationLine !== 'none' && !uaUnderline) push('text-decoration', cs.textDecorationLine + (cs.textDecorationStyle !== 'solid' ? ' ' + cs.textDecorationStyle : ''));

    // Visual
    const bgc = parseColor(cs.backgroundColor);
    if (bgc && bgc.a > 0) push('background-color', toHex(bgc));
    if (cs.backgroundImage !== 'none') {
      push('background-image', cs.backgroundImage.replace(/url\((["']?)(data:[^)]{80})[^)]*\)/g, 'url($1$2…)'));
      if (cs.backgroundSize !== 'auto') push('background-size', cs.backgroundSize);
      if (cs.backgroundPosition !== '0% 0%') push('background-position', cs.backgroundPosition);
      if (cs.backgroundRepeat !== 'repeat') push('background-repeat', cs.backgroundRepeat);
    }
    borders(d, cs);
    const rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    if (rad.some((r) => r !== '0px')) push('border-radius', compact4(rad.map(z0)));
    if (cs.boxShadow !== 'none') push('box-shadow', cs.boxShadow);
    if (cs.opacity !== '1') push('opacity', cs.opacity);
    if (cs.transform !== 'none') push('transform', cs.transform);
    if (cs.filter !== 'none') push('filter', cs.filter);
    if (cs.backdropFilter && cs.backdropFilter !== 'none') push('backdrop-filter', cs.backdropFilter);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') push('overflow', cs.overflowX === cs.overflowY ? cs.overflowX : `${cs.overflowX} ${cs.overflowY}`);
    if (/^(img|video)$/.test(tag) && cs.objectFit !== 'fill') push('object-fit', cs.objectFit);
    if (/^(ul|ol)$/.test(tag) && cs.listStyleType === 'none') push('list-style', 'none');
    const durs = String(cs.transitionDuration || '0s').split(',');
    if (durs.some((x) => x.trim() !== '0s')) push('transition', cs.transition);
    return d;
  }
  function compact4(v) {
    const [a, b, c, e] = v;
    if (a === b && b === c && c === e) return a;
    if (a === c && b === e) return `${a} ${b}`;
    if (b === e) return `${a} ${b} ${c}`;
    return `${a} ${b} ${c} ${e}`;
  }
  function box4(d, cs, name, keys) {
    const v = keys.map((k) => z0(cs[k]));
    if (v.every((x) => x === '0')) return;
    d.push([name, compact4(v)]);
  }
  function gap(d, cs) {
    const r = cs.rowGap, c = cs.columnGap;
    if (r === 'normal' && c === 'normal') return;
    const rr = r === 'normal' ? '0' : z0(r), cc = c === 'normal' ? '0' : z0(c);
    if (rr === '0' && cc === '0') return;
    d.push(['gap', rr === cc ? rr : `${rr} ${cc}`]);
  }
  function borders(d, cs) {
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const s = sides.map((S) => ({ w: cs[`border${S}Width`], st: cs[`border${S}Style`], c: cs[`border${S}Color`], n: S.toLowerCase() }))
      .map((x) => ({ ...x, on: x.w !== '0px' && x.st !== 'none' && x.st !== 'hidden' }));
    if (!s.some((x) => x.on)) return;
    const col = (c) => { const p = parseColor(c); return p ? toHex(p) : c; };
    const same = s.every((x) => x.on && x.w === s[0].w && x.st === s[0].st && x.c === s[0].c);
    if (same) { d.push(['border', `${s[0].w} ${s[0].st} ${col(s[0].c)}`]); return; }
    for (const x of s) if (x.on) d.push([`border-${x.n}`, `${x.w} ${x.st} ${col(x.c)}`]);
  }
  function cssBlock(sel, decls) {
    if (!decls.length) return `${sel} {}\n`;
    return `${sel} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}\n`;
  }

  // Plain CSS for any element (non-React path): live selectors that match the current markup
  function plainCss(root, withChildren) {
    const rootSel = rootSelector(root);
    let out = cssBlock(rootSel, extractDecls(root, true));
    if (!withChildren) return { css: out, count: 1 };
    let count = 1;
    const walk = (el, sel, depth) => {
      if (depth > 12) return;
      const kids = Array.from(el.children);
      kids.forEach((k, i) => {
        if (count >= MAX_CODE_NODES) return;
        const tag = k.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag) || !isVisible(k)) return;
        const s = `${sel} > ${tag}:nth-child(${i + 1})`;
        count++;
        const decls = extractDecls(k, false);
        if (decls.length) out += '\n' + cssBlock(s, decls);
        if (tag !== 'svg') walk(k, s, depth + 1);
      });
    };
    walk(root, rootSel, 0);
    return { css: out, count };
  }

  // ───────────────────────── JSX generation (React / Next.js) ─────────────────────────
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const HTML_ATTRS = new Set(['href', 'src', 'alt', 'type', 'placeholder', 'name', 'role', 'title', 'target', 'rel', 'width', 'height', 'htmlFor', 'disabled', 'tabIndex', 'loading', 'id', 'action', 'method', 'autoComplete', 'required', 'maxLength', 'min', 'max', 'step', 'pattern', 'srcSet', 'sizes', 'download', 'colSpan', 'rowSpan', 'value', 'checked', 'defaultValue', 'defaultChecked', 'readOnly', 'multiple', 'rows', 'cols', 'poster', 'controls', 'autoPlay', 'muted', 'loop', 'playsInline']);
  const SKIP_PROPS = new Set(['className', 'style', 'children', 'key', 'ref', 'dangerouslySetInnerHTML', 'suppressHydrationWarning', 'suppressContentEditableWarning']);
  const DOM_ATTR_MAP = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', autocomplete: 'autoComplete', colspan: 'colSpan', rowspan: 'rowSpan', srcset: 'srcSet', autoplay: 'autoPlay', playsinline: 'playsInline', crossorigin: 'crossOrigin', 'xlink:href': 'xlinkHref' };
  const camel = (s) => s.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase());
  const isMinified = (n) => !n || n.length <= 2 || /^[a-z]$/.test(n) || /^_/.test(n);
  const jsxText = (t) => t.replace(/[{}<>]/g, (c) => `{'${c}'}`);
  const pascal = (s) => (s || '').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/^[^A-Za-z]+/, '');

  function resolvePath(root, path) {
    if (!Array.isArray(path)) return null;
    let n = root;
    for (const i of path) { if (!n || !n.children || typeof i !== 'number') return null; n = n.children[i]; }
    return n || null;
  }

  // Normalize a fiber tree (from MAIN world, untrusted JSON) or a DOM subtree into one model.
  function modelFromFiber(root, f, inSvg) {
    if (!f || typeof f !== 'object') return null;
    if (f.k === 't') return { t: 'text', text: String(f.text || '') };
    if (f.k === 'c') {
      const kids = Array.isArray(f.c) ? f.c.map((x) => modelFromFiber(root, x, inSvg)).filter(Boolean) : [];
      return { t: 'comp', name: typeof f.name === 'string' ? f.name.slice(0, 80) : null, props: f.props && typeof f.props === 'object' ? f.props : {}, children: kids };
    }
    if (f.k === 'h') {
      const tag = String(f.tag || 'div').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'div';
      const svg = inSvg || tag === 'svg';
      const dom = resolvePath(root, f.path);
      const attrs = []; const handlers = [];
      const props = f.props && typeof f.props === 'object' ? f.props : {};
      for (const k of Object.keys(props)) {
        if (SKIP_PROPS.has(k) || !/^[a-zA-Z][\w:-]*$/.test(k)) continue;
        const v = props[k];
        if (v && typeof v === 'object' && typeof v.__fn === 'string') {
          if (/^on[A-Z]/.test(k)) handlers.push({ event: k, fn: v.__fn });
          continue;
        }
        if (v && typeof v === 'object') continue;
        if (svg && tag !== 'svg') { if (v !== null) attrs.push([k, v]); continue; }
        if (HTML_ATTRS.has(k) || k.startsWith('aria-') || (svg && /^(viewBox|fill|stroke|xmlns|strokeWidth|width|height)$/.test(k))) {
          if (v !== null) attrs.push([k === 'value' ? 'defaultValue' : k === 'checked' ? 'defaultChecked' : k, v]);
        }
      }
      // Child paths are relative to the selected root. If React has no children recorded
      // (dangerouslySetInnerHTML, third-party DOM), fall back to the live DOM.
      const fiberKids = Array.isArray(f.c) ? f.c : [];
      const useDom = !!props.dangerouslySetInnerHTML || (!fiberKids.length && dom && dom.childNodes.length > 0);
      const kids = useDom
        ? Array.from(dom ? dom.childNodes : []).map((n) => modelFromDom(n, svg)).filter(Boolean)
        : fiberKids.map((x) => modelFromFiber(root, x, svg)).filter(Boolean);
      return { t: 'el', tag, attrs, handlers, dom, svg, children: mergeText(kids) };
    }
    return null;
  }
  function modelFromDom(n, inSvg) {
    if (n.nodeType === 3) return n.nodeValue.trim() ? { t: 'text', text: n.nodeValue } : null;
    if (n.nodeType !== 1) return null;
    const tag = n.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    const svg = inSvg || tag === 'svg';
    const attrs = [];
    for (const a of Array.from(n.attributes)) {
      let name = a.name;
      if (name === 'class' || name === 'style' || name.startsWith('data-') || name.startsWith('on')) continue;
      name = DOM_ATTR_MAP[name] || (name.startsWith('aria-') ? name : camel(name));
      if (svg && tag !== 'svg') { attrs.push([name, a.value]); continue; }
      if (HTML_ATTRS.has(name) || name.startsWith('aria-') || (svg && /^(viewBox|fill|stroke|xmlns|width|height)$/.test(name))) attrs.push([name === 'value' ? 'defaultValue' : name, a.value]);
    }
    const children = mergeText(Array.from(n.childNodes).map((c) => modelFromDom(c, svg)).filter(Boolean));
    return { t: 'el', tag: svg ? n.tagName : tag, attrs, handlers: [], dom: n, svg, children };
  }
  // React splits "From ${price}" into several text fibers; join them so spacing survives.
  function mergeText(list) {
    const out = [];
    for (const n of list) {
      const last = out[out.length - 1];
      if (n.t === 'text' && last && last.t === 'text') last.text += n.text;
      else out.push(n.t === 'text' ? { t: 'text', text: n.text } : n);
    }
    return out;
  }

  function nextImageSrc(src) {
    try {
      const u = new URL(src, location.href);
      if (/\/_next\/image/.test(u.pathname) && u.searchParams.get('url')) return u.searchParams.get('url');
    } catch (_) { /* ignore */ }
    return null;
  }

  function generateReact(rootEl, data) {
    let model = null;
    if (data && data.rootManaged && data.tree) model = modelFromFiber(rootEl, data.tree, false);
    if (!model) model = modelFromDom(rootEl, false);
    if (!model) return null;

    const isNext = !!(data && data.isNext);
    const owners = data && Array.isArray(data.owners) ? data.owners.filter((n) => typeof n === 'string') : [];
    const ownerName = owners.find((n) => !isMinified(n) && !/^(Link|LinkComponent|Image|Layout|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|RedirectBoundary|NotFoundBoundary|ErrorBoundary|LoadingBoundary|HTTPAccessFallbackBoundary|Router|AppRouter|HotReload|ServerRoot|Root)$/.test(n));
    // Minified owner names → derive a readable name from the root element's own class (e.g. "hero" → Hero)
    const firstClass = typeof rootEl.className === 'string' ? rootEl.className.trim().split(/\s+/).find((c) => /^[a-zA-Z][a-zA-Z-_]{2,30}$/.test(c) && !/^(css|sc|jsx|tw|svelte)-/.test(c)) : null;
    let compName = pascal(ownerName || firstClass || '') || 'ExtractedComponent';
    if (!/^[A-Z]/.test(compName)) compName = 'ExtractedComponent';

    const imports = new Set();
    const handlerDefs = [];
    const usedHandlerNames = new Set();
    const cssRules = [];
    const usedClass = new Set();
    let elCount = 0;

    const className = (node) => {
      if (node.svg && node.tag !== 'svg') return null;
      if (!node.dom || elCount >= MAX_CODE_NODES) return null;
      elCount++;
      let base = elCount === 1 ? 'root' : String(node.tag).toLowerCase().replace(/[^a-z0-9]/g, '') || 'el';
      let nm = base; let i = 2;
      while (usedClass.has(nm)) nm = base + i++;
      usedClass.add(nm);
      const decls = extractDecls(node.dom, elCount === 1);
      cssRules.push(cssBlock('.' + nm, decls));
      return nm;
    };

    const attrStr = (k, v) => {
      if (typeof v === 'string') return `${k}=${JSON.stringify(v)}`;
      if (v === true) return k;
      return `${k}={${JSON.stringify(v)}}`;
    };

    const emit = (node, ind, first = true, last = true) => {
      const pad = '  '.repeat(ind);
      if (node.t === 'text') {
        const raw = node.text.replace(/\s+/g, ' ');
        const core = raw.trim();
        if (!core) return !first && !last && raw === ' ' ? [pad + "{' '}"] : [];
        const lead = !first && raw.startsWith(' ') ? "{' '}" : '';
        const trail = !last && raw.endsWith(' ') ? "{' '}" : '';
        return [pad + lead + jsxText(core) + trail];
      }
      if (node.t === 'comp') {
        // next/link → <Link>
        const nm = node.name || '';
        if (isNext && /^(Link|LinkComponent)$/.test(nm) && node.children.length === 1 && node.children[0].t === 'el' && node.children[0].tag === 'a') {
          const a = node.children[0];
          imports.add("import Link from 'next/link';");
          const href = typeof node.props.href === 'string' ? node.props.href : (a.attrs.find(([k]) => k === 'href') || [])[1];
          a.tag = 'Link';
          a.attrs = a.attrs.filter(([k]) => k !== 'href');
          if (href) a.attrs.unshift(['href', href]);
          return emit(a, ind, first, last);
        }
        const inner = node.children.flatMap((c, i, arr) => emit(c, ind, first && i === 0, last && i === arr.length - 1));
        if (nm && !isMinified(nm) && inner.length) return [`${pad}{/* <${nm}> */}`, ...inner];
        return inner;
      }
      // element
      let tag = node.tag;
      let attrs = node.attrs.slice();
      // next/link in production builds: name is minified, but its <a> always carries this handler trio
      if (tag === 'a' && isNext && node.handlers) {
        const ev = new Set(node.handlers.map((x) => x.event));
        const href = (attrs.find(([k]) => k === 'href') || [])[1];
        if (ev.has('onClick') && ev.has('onMouseEnter') && ev.has('onTouchStart') && typeof href === 'string' && !/^(https?:)?\/\//.test(href)) {
          tag = 'Link';
          imports.add("import Link from 'next/link';");
          node = { ...node, handlers: node.handlers.filter((x) => !/^on(Click|MouseEnter|TouchStart)$/.test(x.event)) };
          attrs = [['href', href], ...attrs.filter(([k]) => k !== 'href')];
        }
      }
      if (tag === 'img' && isNext) {
        const srcAttr = attrs.find(([k]) => k === 'src');
        const real = srcAttr && nextImageSrc(srcAttr[1]);
        if (real) {
          imports.add("import Image from 'next/image';");
          tag = 'Image';
          const w = node.dom ? (node.dom.getAttribute('width') || node.dom.naturalWidth || node.dom.width) : null;
          const hgt = node.dom ? (node.dom.getAttribute('height') || node.dom.naturalHeight || node.dom.height) : null;
          attrs = attrs.filter(([k]) => !/^(src|srcSet|sizes|width|height|loading|decoding)$/.test(k));
          attrs.unshift(['src', real]);
          if (w) attrs.push(['width', Number(w)]);
          if (hgt) attrs.push(['height', Number(hgt)]);
        }
      }
      const cls = className(node);
      const parts = [];
      if (cls) parts.push(`className={styles.${cls}}`);
      for (const [k, v] of attrs) parts.push(attrStr(k, v));
      for (const hd of node.handlers || []) {
        let hn = 'handle' + hd.event.slice(2);
        let i = 2; while (usedHandlerNames.has(hn)) hn = 'handle' + hd.event.slice(2) + i++;
        usedHandlerNames.add(hn);
        handlerDefs.push({ name: hn, event: hd.event, fn: hd.fn, on: tag });
        parts.push(`${hd.event}={${hn}}`);
      }
      const open = `${pad}<${tag}${parts.length ? ' ' + parts.join(' ') : ''}`;
      const kids = node.children.flatMap((c, i, arr) => emit(c, ind + 1, i === 0, i === arr.length - 1));
      if (!kids.length || VOID.has(tag)) return [open + ' />'];
      if (kids.length === 1 && kids[0].trim().length < 60 && !kids[0].trim().startsWith('<') && !kids[0].trim().startsWith('{/*')) return [`${open}>${kids[0].trim()}</${tag}>`];
      return [open + '>', ...kids, `${pad}</${tag}>`];
    };

    const body = emit(model, 2);
    const head = [];
    const needsClient = handlerDefs.length > 0 && isNext && data && data.nextRouter !== 'pages';
    if (needsClient) head.push("'use client';", '');
    head.push(...imports);
    head.push(`import styles from './${compName}.module.css';`, '');
    const handlerLines = handlerDefs.map((hd) => `  const ${hd.name} = (event) => {\n    // original handler: ${hd.fn.replace(/[^\w$]/g, '') || 'anonymous'} (${hd.event} on <${hd.on}>)\n  };`);
    const jsx = [
      `/**`,
      ` * ${compName} — reconstructed from the live ${isNext ? 'Next.js' : 'React'} tree by Uxearly Inspect.`,
      ` * Structure, props and styles are real; handler bodies are stubs (minified source can't be recovered).`,
      owners.length ? ` * Component path: ${owners.slice(0, 6).reverse().join(' › ')}` : null,
      ` */`,
      ...head,
      `export default function ${compName}() {`,
      ...handlerLines,
      handlerLines.length ? '' : null,
      `  return (`,
      ...body,
      `  );`,
      `}`,
      ''
    ].filter((l) => l !== null).join('\n');

    const css = cssRules.join('\n');
    const info = {
      component: compName,
      owners,
      ownerProps: data && data.ownerProps ? data.ownerProps : null,
      handlers: handlerDefs.map((x) => ({ event: x.event, element: x.on, original: x.fn }))
    };
    return { jsx, css, info, compName, count: elCount };
  }

  // ───────────────────────── Page scanner (design system) ─────────────────────────
  async function scanPage(onProgress) {
    const colors = new Map(); // hex -> {c, count, uses:Set}
    const typo = new Map(); // key -> {...}
    const families = new Map();
    const spacing = new Map(); const radii = new Map(); const shadows = new Map();
    const addColor = (str, use) => {
      const c = parseColor(str);
      if (!c || c.a === 0) return;
      const k = toHex(c);
      let e = colors.get(k);
      if (!e) { e = { c, hex: k, count: 0, uses: new Set() }; colors.set(k, e); }
      e.count++; e.uses.add(use);
    };
    const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);

    const all = document.body ? document.body.getElementsByTagName('*') : [];
    const n = Math.min(all.length, MAX_SCAN);
    for (let i = 0; i < n; i++) {
      if (i % 600 === 0) { onProgress && onProgress(i, n); await new Promise((r) => setTimeout(r, 0)); }
      const el = all[i];
      if (!el || el === host || SKIP_TAGS.has(el.tagName.toLowerCase())) continue;
      if (!isVisible(el)) continue;
      const cs = getComputedStyle(el);
      const isSvgChild = el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg';
      if (!isSvgChild) {
        addColor(cs.backgroundColor, 'background');
        if (cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage)) {
          for (const m of cs.backgroundImage.match(/(rgba?|color|oklch|oklab|lab|lch|hsla?)\([^()]*\)/gi) || []) addColor(m, 'gradient');
        }
        for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
          if (cs[`border${s}Width`] !== '0px' && cs[`border${s}Style`] !== 'none') addColor(cs[`border${s}Color`], 'border');
        }
        for (const p of [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft]) {
          const v = px(p); if (v && v > 0 && v <= 400) inc(spacing, Math.round(v));
        }
        for (const g of [cs.rowGap, cs.columnGap]) { const v = px(g); if (v && v > 0 && v <= 400) inc(spacing, Math.round(v)); }
        const r = px(cs.borderTopLeftRadius); if (r && r > 0) inc(radii, r >= 999 ? 9999 : Math.round(r));
        if (cs.boxShadow !== 'none') inc(shadows, hexify(cs.boxShadow));
      } else {
        if (cs.fill && cs.fill !== 'none' && !/^url/.test(cs.fill)) addColor(cs.fill, 'svg');
        if (cs.stroke && cs.stroke !== 'none' && !/^url/.test(cs.stroke)) addColor(cs.stroke, 'svg');
      }
      if (hasOwnText(el)) {
        addColor(cs.color, 'text');
        const fam = primaryFamily(cs.fontFamily);
        const fe = families.get(fam) || { family: fam, stack: cs.fontFamily, count: 0, weights: new Set() };
        fe.count++; fe.weights.add(cs.fontWeight); families.set(fam, fe);
        const key = [fam, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing].join('|');
        let t = typo.get(key);
        if (!t) {
          t = { family: fam, stack: cs.fontFamily, size: px(cs.fontSize), weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, count: 0, tags: new Map(), sample: '' };
          typo.set(key, t);
        }
        t.count++; inc(t.tags, el.tagName.toLowerCase());
        if (!t.sample) { for (const c of el.childNodes) if (c.nodeType === 3 && c.nodeValue.trim()) { t.sample = c.nodeValue.trim().slice(0, 40); break; } }
      }
    }
    onProgress && onProgress(n, n);

    const sheets = readStylesheets();
    const webfonts = [];
    try { for (const f of document.fonts) { const fam = f.family.replace(/^["']|["']$/g, ''); if (!/^Uxi /.test(fam)) webfonts.push({ family: fam, weight: f.weight, style: f.style, status: f.status }); } } catch (_) { /* ignore */ }

    return { colors, typo, families, spacing, radii, shadows, vars: sheets.vars, breakpoints: sheets.breakpoints, blockedSheets: sheets.blocked, webfonts, scanned: n, total: all.length };
  }

  function readStylesheets() {
    const vars = new Map(); const bps = new Map(); let blocked = 0;
    const rootSel = /(^|,)\s*(:root|html|body|:host)(\s*,|\s*$|\[|\.)/;
    const visit = (rules, depth) => {
      if (!rules || depth > 6) return;
      for (const r of rules) {
        if (vars.size > 600) return;
        if (r.conditionText && r.constructor && /Media/.test(r.constructor.name)) {
          for (const m of r.conditionText.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) {
            const v = m[3] === 'px' ? +m[2] : +m[2] * 16;
            bps.set(Math.round(v), (bps.get(Math.round(v)) || 0) + 1);
          }
        }
        if (r.selectorText && rootSel.test(r.selectorText) && r.style) {
          for (let i = 0; i < r.style.length; i++) {
            const name = r.style[i];
            if (name.startsWith('--') && !vars.has(name)) vars.set(name, { name, value: r.style.getPropertyValue(name).trim().slice(0, 200), selector: r.selectorText.slice(0, 60) });
          }
        }
        if (r.cssRules) visit(r.cssRules, depth + 1);
      }
    };
    const list = [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets || [])];
    for (const s of list) {
      let rules = null;
      try { rules = s.cssRules; } catch (_) { blocked++; continue; }
      visit(rules, 0);
    }
    // resolve the actual computed value on :root
    const rcs = getComputedStyle(document.documentElement);
    for (const v of vars.values()) { const val = rcs.getPropertyValue(v.name).trim(); if (val) v.resolved = val.slice(0, 200); }
    return { vars: [...vars.values()], breakpoints: [...bps.entries()].filter(([v]) => v >= 240 && v <= 2600).sort((a, b) => a[0] - b[0]), blocked };
  }

  // Turn raw scan into tokens
  function buildTokens(scan) {
    const colorList = [...scan.colors.values()].sort((a, b) => b.count - a.count).slice(0, 48);
    const neutrals = [], brand = [];
    // Chroma, not HSL saturation: near-white greys have high HSL saturation but no visible hue.
    const chroma = (c) => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
    for (const e of colorList) (chroma(e.c) < 0.1 ? neutrals : brand).push(e);
    neutrals.sort((a, b) => relLum(b.c) - relLum(a.c));
    // Primary = the saturated color used most as a background (buttons, badges), then by overall use
    const bgUse = (e) => (e.uses.has('background') ? 1 : 0);
    brand.sort((a, b) => bgUse(b) - bgUse(a) || b.count - a.count);
    const colors = [];
    neutrals.forEach((e, i) => colors.push({ name: `neutral-${(i + 1) * 100}`, hex: e.hex, count: e.count, uses: [...e.uses] }));
    brand.forEach((e, i) => colors.push({ name: i === 0 ? 'primary' : i === 1 ? 'secondary' : i === 2 ? 'accent' : `brand-${i - 2}`, hex: e.hex, count: e.count, uses: [...e.uses] }));

    const typoList = [...scan.typo.values()].filter((t) => t.size).sort((a, b) => b.size - a.size || b.count - a.count);
    const usedNames = new Map();
    const textStyles = typoList.slice(0, 24).map((t) => {
      const top = [...t.tags.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const base = /^h[1-6]$/.test(top) ? top : top === 'p' ? 'body' : (t.size >= 28 ? 'display' : t.size <= 13 ? 'caption' : top === 'a' ? 'link' : top === 'button' ? 'button' : 'text');
      const c = (usedNames.get(base) || 0) + 1; usedNames.set(base, c);
      return { name: c === 1 ? base : `${base}-${c}`, ...t, topTag: top };
    });

    const sizes = [...new Set(typoList.map((t) => t.size))].sort((a, b) => a - b);
    const sp = [...scan.spacing.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([v]) => v).sort((a, b) => a - b);
    const div = (b) => sp.length ? sp.filter((v) => v % b === 0).length / sp.length : 0;
    const base = div(8) >= 0.7 ? 8 : div(4) >= 0.7 ? 4 : null;
    const radii = [...scan.radii.entries()].sort((a, b) => a[0] - b[0]).slice(0, 10).map(([v, c]) => ({ v, c }));
    const shadows = [...scan.shadows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, c]) => ({ v, c }));
    const families = [...scan.families.values()].sort((a, b) => b.count - a.count);
    return { colors, textStyles, sizes, spacing: sp, spacingBase: base, radii, shadows, families, vars: scan.vars, breakpoints: scan.breakpoints };
  }

  function exportCss(t) {
    const L = [':root {', '  /* Colors */'];
    t.colors.forEach((c) => L.push(`  --color-${c.name}: ${c.hex};`));
    L.push('', '  /* Font families */');
    t.families.slice(0, 4).forEach((f, i) => L.push(`  --font-${i === 0 ? 'primary' : i === 1 ? 'secondary' : 'family-' + (i + 1)}: ${f.stack};`));
    L.push('', '  /* Font sizes */');
    t.sizes.forEach((s, i) => L.push(`  --font-size-${i + 1}: ${round(s / 16, 4)}rem; /* ${s}px */`));
    L.push('', `  /* Spacing${t.spacingBase ? ` (base ${t.spacingBase}px)` : ''} */`);
    t.spacing.forEach((s, i) => L.push(`  --space-${i + 1}: ${s}px;`));
    if (t.radii.length) { L.push('', '  /* Radius */'); t.radii.forEach((r, i) => L.push(`  --radius-${r.v >= 9999 ? 'full' : i + 1}: ${r.v}px;`)); }
    if (t.shadows.length) { L.push('', '  /* Shadows */'); t.shadows.forEach((s, i) => L.push(`  --shadow-${i + 1}: ${s.v};`)); }
    L.push('}', '', '/* Text styles */');
    t.textStyles.forEach((s) => L.push(`.text-${s.name} {\n  font-family: ${s.stack};\n  font-size: ${s.size}px;\n  font-weight: ${s.weight};\n  line-height: ${s.lineHeight};${s.letterSpacing !== 'normal' ? `\n  letter-spacing: ${s.letterSpacing};` : ''}\n}`));
    if (t.breakpoints.length) { L.push('', '/* Breakpoints found in stylesheets: ' + t.breakpoints.map(([v]) => v + 'px').join(', ') + ' */'); }
    return L.join('\n') + '\n';
  }
  function exportJson(t) {
    const o = { $schema: 'https://www.designtokens.org/tr/drafts/format/', source: location.origin + location.pathname, color: {}, fontFamily: {}, fontSize: {}, spacing: {}, borderRadius: {}, shadow: {}, typography: {} };
    t.colors.forEach((c) => { o.color[c.name] = { $type: 'color', $value: c.hex, $description: `used ${c.count}× (${c.uses.join(', ')})` }; });
    t.families.slice(0, 4).forEach((f, i) => { o.fontFamily[i === 0 ? 'primary' : i === 1 ? 'secondary' : 'family-' + (i + 1)] = { $type: 'fontFamily', $value: splitFamilies(f.stack) }; });
    t.sizes.forEach((s, i) => { o.fontSize[String(i + 1)] = { $type: 'dimension', $value: `${s}px` }; });
    t.spacing.forEach((s, i) => { o.spacing[String(i + 1)] = { $type: 'dimension', $value: `${s}px` }; });
    t.radii.forEach((r, i) => { o.borderRadius[r.v >= 9999 ? 'full' : String(i + 1)] = { $type: 'dimension', $value: `${r.v}px` }; });
    t.shadows.forEach((s, i) => { o.shadow[String(i + 1)] = { $type: 'shadow', $value: s.v }; });
    t.textStyles.forEach((s) => { o.typography[s.name] = { $type: 'typography', $value: { fontFamily: splitFamilies(s.stack), fontSize: `${s.size}px`, fontWeight: Number(s.weight), lineHeight: s.lineHeight, letterSpacing: s.letterSpacing } }; });
    if (t.vars.length) { o.cssVariables = {}; t.vars.slice(0, 300).forEach((v) => { o.cssVariables[v.name] = v.resolved || v.value; }); }
    return JSON.stringify(o, null, 2) + '\n';
  }
  function exportTailwind(t) {
    const q = (s) => JSON.stringify(s);
    const colors = t.colors.map((c) => `        ${q(c.name)}: ${q(c.hex)},`).join('\n');
    const fams = t.families.slice(0, 3).map((f, i) => `        ${q(i === 0 ? 'primary' : i === 1 ? 'secondary' : 'tertiary')}: ${JSON.stringify(splitFamilies(f.stack))},`).join('\n');
    const sizes = t.textStyles.map((s) => `        ${q(s.name)}: [${q(s.size + 'px')}, { lineHeight: ${q(s.lineHeight)}, fontWeight: ${q(String(s.weight))}${s.letterSpacing !== 'normal' ? `, letterSpacing: ${q(s.letterSpacing)}` : ''} }],`).join('\n');
    const space = t.spacing.map((s, i) => `        ${q('ds-' + (i + 1))}: ${q(s + 'px')},`).join('\n');
    const rad = t.radii.map((r, i) => `        ${q(r.v >= 9999 ? 'ds-full' : 'ds-' + (i + 1))}: ${q(r.v + 'px')},`).join('\n');
    const sh = t.shadows.map((s, i) => `        ${q('ds-' + (i + 1))}: ${q(s.v)},`).join('\n');
    const bps = t.breakpoints.slice(0, 6).map(([v], i) => `        ${q('bp' + (i + 1))}: ${q(v + 'px')},`).join('\n');
    return `/** Tailwind theme extracted from ${location.host} by Uxearly Inspect */\n/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${colors}\n      },\n      fontFamily: {\n${fams}\n      },\n      fontSize: {\n${sizes}\n      },\n      spacing: {\n${space}\n      },\n      borderRadius: {\n${rad}\n      },\n      boxShadow: {\n${sh}\n      },${bps ? `\n      screens: {\n${bps}\n      },` : ''}\n    },\n  },\n};\n`;
  }


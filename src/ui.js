  // Null-safe append: native Element.append(null) would insert the text "null".
  function put(parent, ...kids) {
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) parent.append(k);
    return parent;
  }

  // ═════════════════════════ IMAGES ═════════════════════════
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RASTER_EXT = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', avif: 'avif', gif: 'gif', bmp: 'bmp', ico: 'ico', svg: 'svg', apng: 'png', jfif: 'jpeg', tif: 'tiff', tiff: 'tiff' };
  const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/bmp': 'bmp', 'image/tiff': 'tiff' };
  const FORMAT_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' };
  const FORMAT_EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif', svg: 'svg' };

  function absUrl(u) { try { return new URL(u, location.href).href; } catch (_) { return null; } }
  function typeFromUrl(u) {
    if (!u) return null;
    if (u.startsWith('data:')) { const m = /^data:([^;,]+)/.exec(u); return m ? (MIME_EXT[m[1].toLowerCase()] || null) : null; }
    try {
      const url = new URL(u);
      const m = /\.([a-z0-9]{2,5})$/i.exec(url.pathname);
      if (m && RASTER_EXT[m[1].toLowerCase()]) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
      const fmt = url.searchParams.get('fm') || url.searchParams.get('format') || url.searchParams.get('f');
      if (fmt && RASTER_EXT[fmt.toLowerCase()]) return fmt.toLowerCase();
      const inner = url.searchParams.get('url');
      if (inner && inner !== u) return typeFromUrl(absUrl(inner));
    } catch (_) { /* ignore */ }
    return null;
  }
  function bestFromSrcset(srcset, withWidth) {
    if (!srcset) return null;
    let best = null; let bestScore = -1; let bestW = 0;
    for (const part of srcset.split(/,(?=\s*\S+\s+\d|\s*\S+\s*$)|,\s+/)) {
      const m = /^\s*(\S+)(?:\s+([\d.]+)([wx]))?\s*$/.exec(part);
      if (!m) continue;
      const score = m[2] ? parseFloat(m[2]) * (m[3] === 'x' ? 1000 : 1) : 1;
      if (score > bestScore) { bestScore = score; best = m[1]; bestW = m[3] === 'w' ? parseFloat(m[2]) : 0; }
    }
    if (!best) return null;
    return withWidth ? { url: absUrl(best), w: bestW } : absUrl(best);
  }
  function hashStr(s) { let h1 = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 0x01000193); } return (h1 >>> 0).toString(36); }

  // Serialize an inline <svg> into a standalone file: computed paint inlined, <use> sprites resolved, scripts removed.
  function serializeSvg(svg) {
    const clone = svg.cloneNode(true);
    const orig = [svg, ...svg.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    // Inline computed paint only where it differs from what the element would inherit anyway,
    // so CSS-styled icons keep their look as a standalone file without attribute noise.
    const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity', 'fill-rule'];
    const INITIAL = { fill: '#000000', stroke: 'none', 'stroke-width': '1px', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'fill-opacity': '1', 'stroke-opacity': '1', opacity: '1', 'fill-rule': 'nonzero' };
    const norm = (v) => { if (/^rgba?\(/.test(v)) { const pc = parseColor(v); if (pc) return pc.a < 1 ? toRgb(pc) : toHex(pc); } return v; };
    const paintOf = (el) => { const cs = getComputedStyle(el); const o = {}; for (const p of PAINT) o[p] = norm(cs.getPropertyValue(p).trim()); return o; };
    const computed = new Map();
    for (let i = 0; i < orig.length && i < copies.length; i++) {
      const o = orig[i]; const c = copies[i];
      if (!(o instanceof SVGElement)) continue;
      if (!/^(svg|g|path|circle|rect|ellipse|line|polyline|polygon|text|tspan|use)$/.test(o.tagName.toLowerCase())) continue;
      const mine = paintOf(o); computed.set(o, mine);
      const parent = i === 0 ? null : computed.get(o.parentElement);
      for (const p of PAINT) {
        const v = mine[p];
        if (!v || /url\(/.test(v)) continue; // gradients keep their own references
        const inherited = p === 'opacity' ? '1' : parent ? parent[p] : INITIAL[p];
        const attr = o.getAttribute(p);
        if (v !== inherited && attr !== v) c.setAttribute(p, v);
        else if (attr !== null && norm(attr) !== v) c.setAttribute(p, v); // attribute overridden by CSS
      }
    }
    // resolve <use href="#id">
    for (const u of Array.from(clone.querySelectorAll('use'))) {
      const ref = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
      if (!ref.startsWith('#')) continue;
      let target = null; try { target = document.getElementById(ref.slice(1)); } catch (_) { target = null; }
      if (!target || !(target instanceof SVGElement)) continue;
      const isSymbol = target.tagName.toLowerCase() === 'symbol';
      const g = document.createElementNS(SVG_NS, isSymbol ? 'svg' : 'g');
      for (const a of Array.from(target.attributes)) if (a.name !== 'id') g.setAttribute(a.name, a.value);
      for (const a of ['x', 'y', 'width', 'height', 'fill', 'stroke', 'class', 'transform']) if (u.hasAttribute(a)) g.setAttribute(a, u.getAttribute(a));
      for (const ch of Array.from(target.childNodes)) g.appendChild(ch.cloneNode(true));
      u.replaceWith(g);
    }
    // strip anything executable
    for (const s of Array.from(clone.querySelectorAll('script, foreignObject'))) s.remove();
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
    }
    clone.setAttribute('xmlns', SVG_NS);
    const r = svg.getBoundingClientRect();
    if (!clone.getAttribute('width') && r.width) clone.setAttribute('width', String(Math.round(r.width)));
    if (!clone.getAttribute('height') && r.height) clone.setAttribute('height', String(Math.round(r.height)));
    clone.removeAttribute('class'); clone.removeAttribute('style');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  async function collectImages() {
    const items = new Map();
    let seq = 0;
    const add = (url, kind, el, extra) => {
      if (!url || /^(about|javascript):/i.test(url)) return;
      const key = url.length > 500 ? url.slice(0, 200) + '#' + url.length + hashStr(url) : url;
      let it = items.get(key);
      if (!it) {
        it = { id: ++seq, key, url, kind, kinds: new Set([kind]), el, count: 0, type: typeFromUrl(url), w: 0, h: 0, rw: 0, rh: 0, alt: '' };
        items.set(key, it);
      }
      it.count++; it.kinds.add(kind);
      if (extra) {
        if (extra.w && extra.w > it.w) { it.w = extra.w; it.h = extra.h; }
        if (extra.rw && extra.rw * extra.rh > it.rw * it.rh) { it.rw = extra.rw; it.rh = extra.rh; it.el = el || it.el; }
        if (extra.alt && !it.alt) it.alt = extra.alt;
        if (extra.svg) it.svg = extra.svg;
        if (extra.type) it.type = extra.type;
      }
      return it;
    };
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { rw: Math.round(r.width), rh: Math.round(r.height) }; };

    for (const img of Array.from(document.images)) {
      const best = bestFromSrcset(img.srcset, true);
      const cur = img.currentSrc || img.src;
      const url = (best && best.url) || absUrl(cur);
      let w = img.naturalWidth, hh = img.naturalHeight;
      if (url !== absUrl(cur)) {
        // largest srcset candidate: width from its descriptor, height from the loaded image's aspect ratio
        w = best && best.w ? best.w : 0;
        hh = w && img.naturalWidth ? Math.round(w * img.naturalHeight / img.naturalWidth) : 0;
      }
      add(url, 'img', img, { ...rectOf(img), w, h: hh, alt: (img.alt || '').slice(0, 120) });
    }
    for (const s of Array.from(document.querySelectorAll('picture source[srcset]'))) {
      const pic = s.parentElement && s.parentElement.querySelector('img');
      add(bestFromSrcset(s.srcset), 'img', pic || s, pic ? rectOf(pic) : null);
    }
    for (const el of Array.from(document.querySelectorAll('video[poster], input[type=image][src]'))) add(absUrl(el.getAttribute('poster') || el.getAttribute('src')), 'other', el, rectOf(el));
    for (const el of Array.from(document.querySelectorAll('svg image'))) add(absUrl(el.getAttribute('href') || el.getAttribute('xlink:href')), 'img', el, rectOf(el));
    for (const l of Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"]'))) {
      const sz = /(\d+)x(\d+)/.exec(l.getAttribute('sizes') || '');
      add(absUrl(l.getAttribute('href')), 'other', null, sz ? { w: +sz[1], h: +sz[2] } : null);
    }
    for (const m of Array.from(document.querySelectorAll('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]'))) add(absUrl(m.getAttribute('content')), 'other', null, null);

    // CSS backgrounds (elements + ::before/::after)
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    const n = Math.min(all.length, MAX_SCAN);
    const URL_RE = /url\((["']?)(.*?)\1\)/g;
    for (let i = 0; i < n; i++) {
      if (i % 500 === 499) await new Promise((r) => setTimeout(r, 0)); // stay responsive on huge pages
      const el = all[i];
      if (el === host) continue;
      for (const pseudo of [null, '::before', '::after']) {
        if (pseudo && i > 3000) break;
        const bg = getComputedStyle(el, pseudo).backgroundImage;
        if (!bg || bg === 'none' || bg.indexOf('url(') < 0) continue;
        let m; URL_RE.lastIndex = 0;
        while ((m = URL_RE.exec(bg))) add(absUrl(m[2]), 'bg', el, rectOf(el));
      }
    }
    // Inline SVG (top-level only), skipping sprite sheets / hidden defs
    const svgs = Array.from(document.querySelectorAll('svg')).filter((s) => !s.parentElement || !s.parentElement.closest('svg'));
    for (const [si, s] of svgs.slice(0, 400).entries()) {
      if (si % 50 === 49) await new Promise((r) => setTimeout(r, 0));
      const r = s.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || s === host) continue;
      let markup = '';
      try { markup = serializeSvg(s); } catch (_) { continue; }
      if (markup.length > 2_000_000) continue;
      add('inline-svg:' + hashStr(markup) + markup.length, 'svg', s, { rw: Math.round(r.width), rh: Math.round(r.height), w: Math.round(r.width), h: Math.round(r.height), svg: markup, type: 'svg', alt: (s.getAttribute('aria-label') || s.querySelector('title')?.textContent || '').slice(0, 120) });
    }

    const list = [...items.values()].filter((it) => {
      if (it.kind === 'svg') return true;
      // drop tracking pixels and spacer gifs
      const big = Math.max(it.w, it.rw), big2 = Math.max(it.h, it.rh);
      return !(big > 0 && big <= 2 && big2 <= 2);
    });
    for (const it of list) {
      if (it.type === 'svg' && it.kind !== 'svg') it.kinds.add('svgfile');
      if (it.type === 'jpeg') it.type = 'jpg';
    }
    list.sort((a, b) => (b.rw * b.rh || b.w * b.h) - (a.rw * a.rh || a.w * a.h));
    return list;
  }
  const isSvgItem = (it) => it.kind === 'svg' || it.type === 'svg';

  // ── binary helpers ──
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function utf8ToB64(str) { return bufToB64(new TextEncoder().encode(str)); }
  function dataUrlToBlob(u) {
    const m = /^data:([^;,]*)(;[^,]*)?,(.*)$/s.exec(u);
    if (!m) throw new Error('Bad data URL');
    const mime = m[1] || 'application/octet-stream';
    const isB64 = /;base64/i.test(m[2] || '');
    const bytes = isB64 ? b64ToBytes(m[3].replace(/\s/g, '')) : new TextEncoder().encode(decodeURIComponent(m[3]));
    return new Blob([bytes], { type: mime });
  }
  function fmtBytes(n) { if (!Number.isFinite(n)) return '—'; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(2) + ' MB'; }

  class ImgError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

  const blobCache = new Map();
  async function getBlob(it) {
    if (blobCache.has(it.key)) return blobCache.get(it.key);
    let blob = null;
    if (it.kind === 'svg' && it.svg) blob = new Blob([it.svg], { type: 'image/svg+xml' });
    else if (it.url.startsWith('data:')) blob = dataUrlToBlob(it.url);
    else if (it.url.startsWith('blob:')) { const r = await fetch(it.url); blob = await r.blob(); }
    else if (/^https?:/i.test(it.url)) {
      const r = await sendBg({ type: 'uxi:fetch', url: it.url });
      if (r && r.ok && typeof r.b64 === 'string') blob = new Blob([b64ToBytes(r.b64)], { type: r.mime || '' });
      else throw new ImgError(r && ['TOO_LARGE', 'NOT_IMAGE', 'HTTP'].includes(r.code) ? r.code : 'BLOCKED', r && r.error);
    } else throw new ImgError('UNSUPPORTED');
    if (blob.size > 60 * 1048576) throw new ImgError('TOO_LARGE');
    // sniff SVG served without a proper type
    if (!blob.type || blob.type === 'application/octet-stream' || blob.type === 'text/plain' || blob.type === 'text/xml') {
      const head = await blob.slice(0, 256).text();
      if (/<svg[\s>]/i.test(head) || /^\s*<\?xml/i.test(head)) blob = new Blob([blob], { type: 'image/svg+xml' });
    }
    if (blobCache.size > 60) blobCache.clear();
    blobCache.set(it.key, blob);
    return blob;
  }

  async function decodeToCanvas(blob, it) {
    const isSvg = /svg/.test(blob.type) || (it && isSvgItem(it));
    let src; let w; let hh;
    if (isSvg) {
      const text = await blob.text();
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + utf8ToB64(text);
      await img.decode();
      w = img.naturalWidth || 300; hh = img.naturalHeight || 150;
      // Rasterize crisp: 2× the larger of intrinsic or on-page size, longest side clamped to 256–4096
      const base = Math.max(w, hh, it ? Math.max(it.rw, it.rh) : 0);
      let scale = Math.max(2 * Math.max(1, base) / Math.max(w, hh), 256 / Math.max(w, hh));
      scale = Math.min(scale, 4096 / Math.max(w, hh));
      w = Math.max(1, Math.round(w * scale)); hh = Math.max(1, Math.round(hh * scale));
      src = img;
    } else {
      try { src = await createImageBitmap(blob); } catch (_) { throw new ImgError('DECODE'); }
      w = src.width; hh = src.height;
      const max = 8192;
      if (w > max || hh > max) { const s = max / Math.max(w, hh); w = Math.round(w * s); hh = Math.round(hh * s); }
    }
    return { src, w, h: hh };
  }

  async function convert(it, format, quality) {
    const blob = await getBlob(it);
    if (format === 'original') return blob;
    if (format === 'svg') { if (!/svg/.test(blob.type)) throw new ImgError('NOT_SVG'); return blob; }
    const { src, w, h: hh } = await decodeToCanvas(blob, it);
    const canvas = new OffscreenCanvas(w, hh);
    const ctx = canvas.getContext('2d');
    if (format === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, hh); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, hh);
    if (src.close) src.close();
    if (format === 'avif') {
      const png = await canvas.convertToBlob({ type: 'image/png' });
      const r = await sendBg({ type: 'uxi:avif', b64: bufToB64(await png.arrayBuffer()), quality: Math.round(quality * 100) });
      if (!r || !r.ok) throw new ImgError('AVIF', r && r.error);
      return new Blob([b64ToBytes(r.b64)], { type: 'image/avif' });
    }
    const out = await canvas.convertToBlob({ type: FORMAT_MIME[format], quality });
    if (out.type !== FORMAT_MIME[format]) throw new ImgError('ENCODE');
    return out;
  }

  function baseName(it) {
    if (it.kind === 'svg') return (it.alt ? it.alt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) : '') || `icon-${it.id}`;
    let name = '';
    try {
      const u = new URL(it.url);
      const inner = u.searchParams.get('url');
      const path = inner ? new URL(inner, location.href).pathname : u.pathname;
      name = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
    } catch (_) { name = ''; }
    name = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
    return name || `image-${it.id}`;
  }
  function siteFolder() { return (location.hostname || 'page').replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-').slice(0, 60) || 'page'; }

  async function downloadItem(it, format, quality, opts) {
    const folder = opts && opts.folder ? `Uxearly Inspect/${siteFolder()}/` : '';
    const base = (opts && opts.name) || baseName(it);
    // Original files from the network: let Chrome download them directly (no re-encoding, no CORS)
    if (format === 'original' && /^https?:/i.test(it.url) && it.type && it.type !== 'svg') {
      const r = await sendBg({ type: 'uxi:download', url: it.url, filename: `${folder}${base}.${it.type === 'jpeg' ? 'jpg' : it.type}` });
      if (!r || !r.ok) throw new ImgError('DOWNLOAD', r && r.error);
      return { size: null, ext: it.type };
    }
    const blob = await convert(it, format, quality);
    const ext = format === 'original' ? (MIME_EXT[blob.type] || it.type || 'bin') : FORMAT_EXT[format];
    const r = await sendBg({ type: 'uxi:download', b64: bufToB64(await blob.arrayBuffer()), mime: blob.type || 'application/octet-stream', filename: `${folder}${base}.${ext}` });
    if (!r || !r.ok) throw new ImgError('DOWNLOAD', r && r.error);
    return { size: blob.size, ext };
  }

  function errText(e) {
    const c = e && e.code;
    if (c === 'BLOCKED') return 'This image’s server blocks access from other sites.';
    if (c === 'TOO_LARGE') return 'Image is larger than 60 MB.';
    if (c === 'NOT_IMAGE') return 'The server didn’t return an image for this URL.';
    if (c === 'HTTP') return 'The server returned an error' + (e && e.message && e.message !== c ? ` (${e.message})` : '') + '.';
    if (c === 'DECODE') return 'This image format can’t be decoded for conversion.';
    if (c === 'AVIF') return 'AVIF encoding failed.';
    if (c === 'NOT_SVG') return 'This image isn’t an SVG.';
    if (c === 'DOWNLOAD') return 'Chrome couldn’t save the file.';
    return (e && e.message) || 'Something went wrong.';
  }

  // ═════════════════════════ UI ═════════════════════════
  const host = document.createElement('uxi-inspect');
  // Inline !important beats any page stylesheet rule (even `uxi-inspect { display:none !important }`).
  host.setAttribute('style', ['all: initial', 'display: block', 'position: fixed', 'top: 0', 'left: 0', 'width: 0', 'height: 0', 'overflow: visible',
    'visibility: visible', 'opacity: 1', 'transform: none', 'filter: none', 'clip-path: none', 'contain: none', 'pointer-events: auto', `z-index: ${Z}`]
    .map((d) => d + ' !important').join('; '));
  const shadow = host.attachShadow({ mode: 'closed' });

  // Icon set (24×24, stroke). Static, extension-owned path data only.
  const ICONS = {
    font: 'M4 7V5h16v2M12 5v14M9 19h6',
    color: 'M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z',
    tokens: 'M12 3 2.5 8 12 13l9.5-5L12 3zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5',
    code: 'M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4M13.5 5l-3 14',
    image: 'M4 5h16v14H4zM20 15.5l-4.5-4.5L6 19M10.5 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0',
    close: 'M6.5 6.5l11 11M17.5 6.5l-11 11', minus: 'M6 12h12', plus: 'M12 6v12M6 12h12',
    sun: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 1 1 0-7zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    copy: 'M9 9h10v10H9zM5 15V5h10', download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
    target: 'M12 3v4M12 17v4M3 12h4M17 12h4M17 12a5 5 0 1 1-10 0 5 5 0 1 1 10 0',
    pipette: 'M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5zM12 7 4.5 14.5 4 20l5.5-.5L17 12',
    up: 'M12 19V5M6 11l6-6 6 6', back: 'M15 6l-6 6 6 6', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5',
    check: 'M5 12.5 10 17 19 7', eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0',
    cursor: 'M5.5 3.5 18.5 10l-5.8 1.9L10.8 18z', alert: 'M12 8.5v4.5M12 16.5h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z',
    lock: 'M7.5 11V8a4.5 4.5 0 0 1 9 0v3M5.5 11h13v9.5h-13z', settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5M12 16.8h.01',
    type: 'M5 19 10.5 5h3L19 19M7.6 13.5h8.8',
    ruler: 'M3.6 16.4 16.4 3.6a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L7.6 20.4a1.4 1.4 0 0 1-2 0l-2-2a1.4 1.4 0 0 1 0-2zM7.5 12.5l1.8 1.8M10.5 9.5l1.8 1.8M13.5 6.5l1.8 1.8',
    camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM15.5 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0',
    folder: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
    file: 'M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5zM14 3.5V8h4.5'
  };
  function icon(name, size) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', String(size || 16)); s.setAttribute('height', String(size || 16));
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.75');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', ICONS[name] || ''); s.appendChild(p);
    return s;
  }

  const STYLE = `
  :host { all: initial; }
  .root { --r: 10px; --r-sm: 7px; --mono: "Uxi Mono", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace;
    --sans: "Uxi Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --bg: #101113; --surface: #16171a; --raised: #1c1d21; --hover: #23252a; --active: #2a2c32; --border: #26282d; --border-strong: #33353c;
    --text: #ededf0; --text-2: #a4a6af; --text-3: #6e707a; --accent: #6c7bff; --accent-hover: #7d8bff; --accent-fg: #fff; --accent-soft: rgba(108,123,255,.14);
    --ok: #3ccf8e; --warn: #f2b14c; --bad: #f2635a; --ok-soft: rgba(60,207,142,.14); --warn-soft: rgba(242,177,76,.14); --bad-soft: rgba(242,99,90,.14);
    --shadow: 0 24px 64px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.35); --check: #2a2c31; --check-2: #1f2024; --code-bg: #0c0d0f;
    --hl-key: #c792ea; --hl-str: #a5d6a7; --hl-tag: #7fb4ff; --hl-attr: #f2c27a; --hl-num: #f59f8b; --hl-com: #5f6370; --hl-sel: #8ec5ff; --hl-prop: #a3b4ff;
    color-scheme: dark; }
  .root[data-theme="light"] { --bg: #ffffff; --surface: #f8f8fa; --raised: #ffffff; --hover: #f1f1f4; --active: #e9e9ee; --border: #e7e7ec; --border-strong: #d8d8df;
    --text: #17181c; --text-2: #5c5e68; --text-3: #8d8f99; --accent: #4f5ff0; --accent-hover: #4352e0; --accent-soft: rgba(79,95,240,.10);
    --ok: #1a9e64; --warn: #b7791f; --bad: #d64545; --ok-soft: rgba(26,158,100,.10); --warn-soft: rgba(183,121,31,.12); --bad-soft: rgba(214,69,69,.10);
    --shadow: 0 24px 64px rgba(16,17,19,.16), 0 2px 8px rgba(16,17,19,.08); --check: #e9e9ee; --check-2: #f6f6f8; --code-bg: #fafafb;
    --hl-key: #8a3fd1; --hl-str: #2f7d32; --hl-tag: #1d5fd1; --hl-attr: #9a5b00; --hl-num: #c2410c; --hl-com: #9a9ca6; --hl-sel: #1d5fd1; --hl-prop: #4338ca;
    color-scheme: light; }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 6px; }
  svg { flex: none; display: block; }

  .panel { position: fixed; top: 16px; right: 16px; width: 432px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden;
    font: 400 12px/1.5 var(--sans); letter-spacing: 0; text-align: left; -webkit-font-smoothing: antialiased; z-index: 2;
    text-wrap: pretty; overflow-wrap: break-word; hyphens: manual; word-break: normal;
    font-optical-sizing: auto; font-feature-settings: "cv11", "ss03"; font-kerning: normal; text-rendering: optimizeLegibility; }
  .mono, kbd, .code pre, .count, .tip .g span:nth-child(even) { font-feature-settings: "zero" 0, "calt" 0; font-variant-numeric: tabular-nums; }
  .tile .v, .stat b, .kv .v { font-variant-numeric: tabular-nums; }
  .empty b, .empty p, .sh h3 { text-wrap: balance; }
  .nowrap { white-space: nowrap; }
  .break { overflow-wrap: anywhere; }
  .panel.min .tabs, .panel.min .body, .panel.min .foot { display: none; }
  .head, .tabs, .foot { flex: none; }

  .head { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 8px 0 14px; cursor: grab; user-select: none; }
  .head:active { cursor: grabbing; }
  .mark { width: 24px; height: 24px; flex: none; display: block; }
  .brand { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .brand b { font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
  .brand span { font-size: 11px; color: var(--text-3); }
  .ibtn { all: unset; box-sizing: border-box; width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; flex: none; }
  .ibtn:hover, .ibtn.on { background: var(--hover); color: var(--text); }
  .ibtn:focus-visible { outline: 2px solid var(--accent); }
  .ibtn.sm { width: 24px; height: 24px; }

  .tabs { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--border); }
  .tab { all: unset; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 0 8px; color: var(--text-3);
    cursor: pointer; font-size: 11px; font-weight: 500; position: relative; border-radius: 6px 6px 0 0; white-space: nowrap; }
  .tab:hover { color: var(--text); }
  .tab.on { color: var(--text); }
  .tab.on::after { content: ""; position: absolute; left: 14%; right: 14%; bottom: -1px; height: 2px; border-radius: 2px; background: var(--accent); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .body { overflow: auto; overscroll-behavior: contain; flex: 1; min-height: 160px; padding: 14px 14px 16px; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
  /* footer: an instrument-style readout */
  .foot { position: relative; display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 10px 0 12px; border-top: 1px solid var(--border);
    background: var(--surface); color: var(--text-3); font-size: 11px; }
  .foot::before { content: ""; position: absolute; left: 0; top: -1px; height: 1px; width: var(--p, 0%); background: var(--accent); transition: width .25s ease, opacity .3s ease; opacity: 0; }
  .foot.busy::before { opacity: 1; }
  .foot.indet::before { width: 28%; animation: sweep 1.1s ease-in-out infinite; }
  @keyframes sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(360%); } }
  .foot .glyph { width: 11px; height: 11px; flex: none; color: var(--text-3); transition: color .2s ease; }
  .foot.ok .glyph { color: var(--ok); } .foot.err .glyph { color: var(--bad); } .foot.busy .glyph { color: var(--accent); }
  .foot .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foot.ok .msg { color: var(--text-2); } .foot.err .msg { color: var(--bad); } .foot.busy .msg { color: var(--text-2); }
  .readout { display: flex; align-items: center; flex: none; font: 500 10.5px/1 var(--mono); color: var(--text-3); font-variant-numeric: tabular-nums; }
  .readout span { display: inline-flex; align-items: baseline; gap: 4px; padding: 0 8px; }
  .readout span + span { box-shadow: -1px 0 0 var(--border); }
  .readout span:last-child { padding-right: 0; }
  .readout i { font-style: normal; color: var(--text-3); opacity: .7; font-size: 9.5px; }
  .readout b { font-weight: 500; color: var(--text-2); min-width: 3.2ch; text-align: right; }
  kbd { font: 500 10px/1 var(--mono); padding: 3px 5px; border-radius: 4px; border: 1px solid var(--border-strong); color: var(--text-2); background: var(--raised); }
  .spin { width: 10px; height: 10px; border: 1.5px solid var(--border-strong); border-top-color: var(--accent); border-radius: 50%; animation: s .7s linear infinite; flex: none; }
  @keyframes s { to { transform: rotate(360deg); } }

  /* building blocks */
  .row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .grow { flex: 1; min-width: 0; } .ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: var(--mono); font-size: 11px; letter-spacing: 0; }
  .t2 { color: var(--text-2); } .t3 { color: var(--text-3); } .sm { font-size: 11px; }
  .section { margin-top: 18px; } .section:first-child { margin-top: 0; }
  .sh { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; margin-bottom: 8px; }
  .sh h3 { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); }
  .sh h3 em { font-style: normal; color: var(--text-2); margin-left: 4px; font-weight: 500; text-transform: none; letter-spacing: 0; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); }
  .pad { padding: 12px; }

  .btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px;
    border-radius: var(--r-sm); font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; user-select: none;
    background: var(--raised); color: var(--text); box-shadow: inset 0 0 0 1px var(--border-strong); transition: background .12s; }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--accent); color: var(--accent-fg); box-shadow: none; } .btn.primary:hover { background: var(--accent-hover); }
  .btn.ghost { background: transparent; box-shadow: none; color: var(--text-2); } .btn.ghost:hover { background: var(--hover); color: var(--text); }
  .btn.sm { height: 26px; padding: 0 9px; font-size: 11px; gap: 5px; }
  .btn.block { display: flex; width: 100%; }
  .btn[disabled], .btn.dis { opacity: .45; pointer-events: none; }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* switch */
  .switch { all: unset; box-sizing: border-box; position: relative; flex: none; width: 32px; height: 18px; border-radius: 999px; cursor: pointer;
    background: var(--active); box-shadow: inset 0 0 0 1px var(--border-strong); transition: background .15s ease, box-shadow .15s ease; }
  .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,.28); transition: transform .15s ease; }
  .switch[aria-checked="true"] { background: var(--accent); box-shadow: none; }
  .switch[aria-checked="true"]::after { transform: translateX(14px); }
  .switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .control { display: flex; align-items: center; gap: 12px; padding: 11px 12px; cursor: pointer; user-select: none; }
  .control .txt { flex: 1; min-width: 0; }
  .control .txt b { display: block; font-weight: 500; font-size: 12px; line-height: 1.4; }
  .control .txt span { display: block; font-size: 11px; color: var(--text-3); line-height: 1.45; margin-top: 1px; }
  .control + .control { border-top: 1px solid var(--border); }
  .mini { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; color: var(--text-2); cursor: pointer; user-select: none; white-space: nowrap; padding: 0 4px; }
  .mini .switch { width: 26px; height: 15px; } .mini .switch::after { width: 11px; height: 11px; }
  .mini .switch[aria-checked="true"]::after { transform: translateX(11px); }
  .field { display: grid; grid-template-columns: 76px 1fr; align-items: center; gap: 10px; }
  .field + .field { margin-top: 10px; }
  .field > span { font-size: 11.5px; color: var(--text-2); }
  .progress { height: 4px; border-radius: 2px; background: var(--hover); overflow: hidden; }
  .progress > i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 2px; transition: width .25s ease; }
  .shot { border-radius: 8px; border: 1px solid var(--border); overflow: hidden; background: var(--surface); max-height: 220px; }
  .shot img { display: block; width: 100%; height: auto; }
  .file-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; min-width: 0; }
  .file-row + .file-row { border-top: 1px solid var(--border); }

  .seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: var(--r-sm); background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); }
  .seg button { all: unset; box-sizing: border-box; height: 22px; padding: 0 8px; border-radius: 5px; font-size: 11px; font-weight: 500; color: var(--text-3); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; min-width: 0; }
  .seg button:hover { color: var(--text); }
  .seg button.on { background: var(--raised); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.18), inset 0 0 0 1px var(--border-strong); }
  .seg button:focus-visible { outline: 2px solid var(--accent); }
  .seg.full { display: flex; } .seg.full button { flex: 1; justify-content: center; }
  .seg button .n { color: var(--text-3); font-weight: 400; }

  .pill { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; white-space: nowrap;
    background: var(--hover); color: var(--text-2); }
  .pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.warn { background: var(--warn-soft); color: var(--warn); } .pill.bad { background: var(--bad-soft); color: var(--bad); }
  .pill.accent { background: var(--accent-soft); color: var(--accent); }
  .count { font: 500 10.5px/18px var(--mono); min-width: 22px; height: 18px; padding: 0 5px; text-align: center; border-radius: 5px; background: var(--hover); color: var(--text-2); }

  /* key/value */
  .kv { display: grid; grid-template-columns: 104px 1fr; }
  .kv > div { padding: 8px 0; border-top: 1px solid var(--border); min-width: 0; }
  .kv > div:nth-child(-n+2) { border-top: 0; }
  .kv .k { color: var(--text-3); }
  .kv .v { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .copyable { cursor: pointer; position: relative; border-radius: 6px; }
  .copyable:hover { color: var(--accent); }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 9px; cursor: pointer; min-width: 0; }
  .tile:hover { border-color: var(--border-strong); background: var(--hover); }
  .tile .l { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); font-weight: 600; }
  .tile .v { font-size: 14px; font-weight: 600; letter-spacing: -.01em; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .s { font-size: 10.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .list { display: flex; flex-direction: column; }
  .item { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 6px 8px; margin: 0 -8px; border-radius: 8px; cursor: pointer; min-width: 0; }
  .item:hover { background: var(--hover); }
  .item + .item { background: linear-gradient(var(--border), var(--border)) 8px 0 / calc(100% - 16px) 1px no-repeat; }
  .item:hover, .item + .item:hover { background: var(--hover); }

  .sw { width: 16px; height: 16px; border-radius: 5px; flex: none; position: relative; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(127,127,127,.28);
    background: repeating-conic-gradient(var(--check) 0 25%, var(--check-2) 0 50%) 0 0 / 8px 8px; }
  .sw > i { position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px rgba(127,127,127,.22); }
  .sw.lg { width: 36px; height: 36px; border-radius: 8px; }

  .swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
  .chip { all: unset; position: relative; aspect-ratio: 1; border-radius: 8px; cursor: pointer; overflow: hidden;
    background: repeating-conic-gradient(var(--check) 0 25%, var(--check-2) 0 50%) 0 0 / 10px 10px; box-shadow: inset 0 0 0 1px rgba(127,127,127,.25); transition: transform .1s; }
  .chip > i { position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgba(127,127,127,.2); border-radius: inherit; }
  .chip:hover { transform: translateY(-1px) scale(1.06); z-index: 1; }
  .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .preview { border-radius: 8px; padding: 14px 14px 12px; margin-bottom: 12px; box-shadow: inset 0 0 0 1px rgba(127,127,127,.18); overflow: hidden; }
  .preview .spec { font-size: 32px; line-height: 1.15; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview .sample { font-size: 14px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; opacity: .85; }

  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 22px 16px; color: var(--text-3); }
  .empty .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--hover); color: var(--text-2); margin-bottom: 4px; }
  .empty b { color: var(--text); font-weight: 600; font-size: 12.5px; }
  .empty p { margin: 0; max-width: 270px; line-height: 1.5; }

  .note { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border-radius: 8px; font-size: 11px; line-height: 1.45; background: var(--hover); color: var(--text-2); }
  .note.warn { background: var(--warn-soft); color: var(--warn); }
  .note svg { margin-top: 1px; }

  /* code viewer */
  .code { border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; background: var(--code-bg); }
  .code .bar { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--border); background: var(--surface); }
  .code .bar .name { font: 500 11px/1 var(--mono); color: var(--text-2); }
  .code pre { margin: 0; padding: 8px 0; max-height: 360px; overflow: auto; overscroll-behavior: contain; font: 11px/1.65 var(--mono); color: var(--text); tab-size: 2; counter-reset: ln;
    scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; user-select: text; }
  .code .ln { display: block; padding: 0 12px 0 0; white-space: pre; min-height: 1.65em; }
  .code .ln::before { counter-increment: ln; content: counter(ln); display: inline-block; width: 34px; padding-right: 10px; margin-right: 8px; text-align: right; color: var(--text-3); opacity: .6; user-select: none; }
  .hk { color: var(--hl-key); } .hs { color: var(--hl-str); } .ht { color: var(--hl-tag); } .ha { color: var(--hl-attr); } .hn { color: var(--hl-num); } .hc { color: var(--hl-com); font-style: italic; } .hsel { color: var(--hl-sel); } .hp { color: var(--hl-prop); }

  .crumb { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface); }
  .subtabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); margin: 12px 0 10px; overflow-x: auto; scrollbar-width: none; }
  .subtabs button { all: unset; padding: 6px 10px 8px; font-size: 11.5px; font-weight: 500; color: var(--text-3); cursor: pointer; position: relative; white-space: nowrap; }
  .subtabs button:hover { color: var(--text); }
  .subtabs button.on { color: var(--text); }
  .subtabs button.on::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--accent); }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
  .stat b { display: block; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
  .stat span { font-size: 10.5px; color: var(--text-3); }
  .exp { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 10px; }
  .exp + .exp { border-top: 1px solid var(--border); }
  .exp .ficon { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; background: var(--hover); color: var(--text-2); }
  .bar-track { height: 6px; border-radius: 3px; background: var(--hover); overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; background: var(--accent); opacity: .85; }
  .radii { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .radius { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
  .radius:hover { background: var(--hover); }
  .radius i { width: 30px; height: 30px; border: 1.5px solid var(--accent); border-right: 0; border-bottom: 0; }

  /* images */
  .thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .thumb { all: unset; box-sizing: border-box; display: flex; flex-direction: column; border-radius: 9px; overflow: hidden; cursor: pointer; border: 1px solid var(--border); background: var(--surface); min-width: 0; }
  .thumb:hover { border-color: var(--border-strong); }
  .thumb:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .thumb .im { aspect-ratio: 1; display: grid; place-items: center; padding: 8px; background: repeating-conic-gradient(var(--check) 0 25%, var(--check-2) 0 50%) 0 0 / 12px 12px; position: relative; }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .thumb .ty { position: absolute; top: 5px; left: 5px; font: 600 9px/1 var(--mono); text-transform: uppercase; padding: 3px 4px; border-radius: 4px; background: rgba(0,0,0,.62); color: #fff; letter-spacing: .04em; }
  .thumb .meta { padding: 5px 7px; font: 10.5px/1.3 var(--mono); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-top: 1px solid var(--border); }
  .big { height: 210px; border-radius: var(--r); border: 1px solid var(--border); display: grid; place-items: center; padding: 12px;
    background: repeating-conic-gradient(var(--check) 0 25%, var(--check-2) 0 50%) 0 0 / 14px 14px; overflow: hidden; }
  .big img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .fmt { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .fmt button { all: unset; box-sizing: border-box; display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--border); background: var(--surface); }
  .fmt button:hover { border-color: var(--accent); background: var(--accent-soft); }
  .fmt button:focus-visible { outline: 2px solid var(--accent); }
  .fmt button b { font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
  .fmt button span { font-size: 10.5px; color: var(--text-3); }
  .fmt button.busy { pointer-events: none; opacity: .6; }
  .range { display: flex; align-items: center; gap: 10px; }
  .range input { flex: 1; accent-color: var(--accent); }

  /* measure layer */
  .mlayer { position: fixed; inset: 0; pointer-events: none; z-index: 1; --m-box: var(--accent); --m-red: #f2385a; --m-pin: #f2385a; --m-letter: #9b5cf6; }
  .mlayer > * { position: fixed; box-sizing: border-box; }
  .mbox { border: 1px solid var(--m-box); }
  .mbox.pin { border: 1.5px solid var(--m-pin); }
  .mbox.letter { border: 1px solid var(--m-letter); background: color-mix(in srgb, var(--m-letter) 12%, transparent); }
  .mbox.next { border: 1px dashed var(--m-letter); }
  .mpad { background: rgba(52, 199, 120, .22); }
  .mmar { background: rgba(255, 159, 10, .22); }
  .mgap { background: rgba(236, 72, 153, .28); }
  .mline { background: var(--m-red); }
  .mline.v { width: 1px; } .mline.h { height: 1px; }
  .mline.v::before, .mline.v::after { content: ""; position: absolute; left: -3px; width: 7px; height: 1px; background: var(--m-red); }
  .mline.v::before { top: 0; } .mline.v::after { bottom: 0; }
  .mline.h::before, .mline.h::after { content: ""; position: absolute; top: -3px; height: 7px; width: 1px; background: var(--m-red); }
  .mline.h::before { left: 0; } .mline.h::after { right: 0; }
  .mguide { border-left: 1px dashed var(--m-red); opacity: .55; }
  .mguide.h { border-left: 0; border-top: 1px dashed var(--m-red); }
  .mruler { height: 1px; background: var(--m-red); transform-origin: 0 50%; }
  .mdot { width: 7px; height: 7px; margin: -3px 0 0 -3px; border-radius: 2px; background: #fff; border: 1.5px solid var(--m-red); }
  .mlabel { font: 600 10.5px/1 var(--mono); font-variant-numeric: tabular-nums; padding: 3px 5px; border-radius: 4px; white-space: nowrap; transform: translate(-50%, -50%);
    background: var(--m-red); color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
  .mlabel.box { background: var(--m-box); transform: translate(-50%, 0); }
  .mlabel.letter { background: var(--m-letter); transform: translate(-50%, 0); }
  .mlabel.gap { background: #db2777; }
  .mread { display: grid; grid-template-columns: 96px 1fr; row-gap: 0; }
  .mread > div { padding: 7px 0; border-top: 1px solid var(--border); min-width: 0; }
  .mread > div:nth-child(-n+2) { border-top: 0; }
  .mread .k { color: var(--text-3); }
  .mread .v { font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums; display: flex; gap: 6px; align-items: center; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 10px; font-size: 11px; color: var(--text-3); }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

  /* selected-text dialog */
  .seldlg { position: fixed; z-index: 4; width: 340px; max-height: min(560px, calc(100vh - 24px)); overflow: auto; overscroll-behavior: contain;
    background: var(--bg); color: var(--text); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow);
    font: 400 12px/1.5 var(--sans); font-feature-settings: "cv11", "ss03"; text-align: left; }
  .seldlg .sh2 { display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 1; }
  .seldlg .sh2 .glyph { width: 12px; height: 12px; color: var(--accent); }
  .seldlg .sh2 b { flex: 1; font-weight: 600; font-size: 12.5px; }
  .seldlg .specimen { display: flex; align-items: center; justify-content: center; height: 120px; font-size: 84px; line-height: 1; border-radius: 10px; margin: 12px 12px 0; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(127,127,127,.18); }
  .seldlg .quote { margin: 12px 12px 0; padding: 12px; border-radius: 10px; font-size: 18px; line-height: 1.35; box-shadow: inset 0 0 0 1px rgba(127,127,127,.18);
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .seldlg .grp { padding: 12px; }
  .seldlg .grp + .grp { border-top: 1px solid var(--border); }
  .seldlg .fam { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .seldlg .fam b { font-size: 14px; font-weight: 600; letter-spacing: -.01em; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .seldlg .acts { display: flex; gap: 6px; padding: 0 12px 12px; }

  /* page overlay + tooltip */
  .overlay { position: fixed; pointer-events: none; border: 1.5px solid var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 2px; z-index: 1; display: none; }
  .overlay.sel { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 8%, transparent); }
  .overlay .tag { position: absolute; left: -1.5px; bottom: 100%; margin-bottom: 4px; font: 500 10.5px/1 var(--mono); padding: 4px 6px; border-radius: 5px; white-space: nowrap;
    background: var(--accent); color: #fff; }
  .overlay.sel .tag { background: var(--ok); color: #06140d; }
  .overlay.below .tag { bottom: auto; top: 100%; margin: 4px 0 0; }
  .tip { position: fixed; pointer-events: none; z-index: 3; display: none; width: 236px; padding: 10px 12px; border-radius: 10px; background: var(--bg); color: var(--text);
    border: 1px solid var(--border-strong); box-shadow: var(--shadow); font: 400 11.5px/1.45 var(--sans); }
  .tip .fam { font-size: 13px; font-weight: 600; letter-spacing: -.01em; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tip .g { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
  .tip .g span:nth-child(odd) { color: var(--text-3); }
  .tip .g span:nth-child(even) { font-family: var(--mono); font-size: 11px; text-align: right; display: flex; justify-content: flex-end; align-items: center; gap: 5px; }
  .tip .hint { margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--border); color: var(--text-3); font-size: 10.5px; }
  `;

  const root = h('div', { class: 'root' });
  put(shadow, h('style', { text: STYLE }), root);
  const overlay = h('div', { class: 'overlay' }, h('div', { class: 'tag' }));
  const selOverlay = h('div', { class: 'overlay sel' }, h('div', { class: 'tag' }));
  const tip = h('div', { class: 'tip', role: 'tooltip' });
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Uxearly Inspect' });
  const mLayer = h('div', { class: 'mlayer', 'aria-hidden': 'true' });
  put(root, mLayer, overlay, selOverlay, tip, panel);

  // ── preferences (chrome.storage.local, this device only) ──
  const prefs = { lastTab: 'font', theme: 'auto', colorFormat: 'hex', imgFormat: 'png', quality: 0.9, pos: null, shot: { area: 'full', res: 'screen', format: 'png' } };
  const storage = (() => { try { return chrome.storage && chrome.storage.local; } catch (_) { return null; } })();
  function savePrefs() { try { storage && storage.set({ uxiPrefs: prefs }); } catch (_) { /* extension reloaded */ } }

  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    const t = prefs.theme === 'auto' ? (mql && mql.matches ? 'light' : 'dark') : prefs.theme;
    root.setAttribute('data-theme', t);
    themeBtn.replaceChildren(icon(t === 'light' ? 'moon' : 'sun', 15));
    themeBtn.title = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }

  // ── status bar ──
  function brandGlyph() {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 128 128'); s.setAttribute('class', 'glyph'); s.setAttribute('aria-hidden', 'true');
    for (const d of ['M24 56V36a12 12 0 0 1 12-12h20', 'M72 24h20a12 12 0 0 1 12 12v20', 'M104 72v20a12 12 0 0 1-12 12H72', 'M56 104H36a12 12 0 0 1-12-12V72']) {
      const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '14'); p.setAttribute('stroke-linecap', 'round'); s.appendChild(p);
    }
    const r = document.createElementNS(SVG_NS, 'rect'); r.setAttribute('x', '50'); r.setAttribute('y', '50'); r.setAttribute('width', '28'); r.setAttribute('height', '28'); r.setAttribute('rx', '6'); r.setAttribute('fill', 'currentColor'); s.appendChild(r);
    return s;
  }
  const footMsg = h('div', { class: 'msg' });
  const roX = h('b', { text: '—' }), roY = h('b', { text: '—' }), roVp = h('b', { text: '' });
  const readout = h('div', { class: 'readout', title: 'Cursor position on the page and viewport size, in CSS pixels' },
    h('span', null, h('i', { text: 'X' }), roX), h('span', null, h('i', { text: 'Y' }), roY), h('span', null, h('i', { text: 'VP' }), roVp));
  const footer = h('div', { class: 'foot', role: 'status', 'aria-live': 'polite' }, brandGlyph(), footMsg, readout);
  let cursor = null;
  function updateReadout() {
    roVp.textContent = `${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`;
    if (cursor) { roX.textContent = String(Math.round(cursor.x + window.scrollX)); roY.textContent = String(Math.round(cursor.y + window.scrollY)); }
    else { roX.textContent = '—'; roY.textContent = '—'; }
  }
  let footTimer = 0;
  function status(msg, kind, progress) {
    footMsg.textContent = msg;
    footMsg.title = msg;
    footer.className = 'foot' + (kind ? ' ' + kind : '') + (kind === 'busy' && typeof progress !== 'number' ? ' indet' : '');
    footer.style.setProperty('--p', typeof progress === 'number' ? Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%' : '0%');
    clearTimeout(footTimer);
    if (kind === 'ok' || kind === 'err') footTimer = setTimeout(() => status(defaultStatus()), kind === 'err' ? 4500 : 2200);
  }

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0;opacity:0' });
      ta.value = text; put(root, ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_e) { ok = false; }
      ta.remove();
      if (!ok) { status('This page blocked clipboard access', 'err'); return; }
    }
    status(`Copied ${what || ''}`.trim(), 'ok');
  }
  function downloadText(name, text, mime) {
    sendBg({ type: 'uxi:download', b64: utf8ToB64(text), mime: mime || 'text/plain', filename: name }).then((r) => {
      if (r && r.ok) status(`Saved ${name}`, 'ok'); else status('Download failed', 'err');
    });
  }
  function swatch(c, cls) { const s = h('span', { class: 'sw' + (cls ? ' ' + cls : '') }); const i = h('i'); i.style.background = toRgb(c); put(s, i); return s; }
  function empty(ic, title, text) { return h('div', { class: 'empty' }, h('div', { class: 'ic' }, icon(ic, 20)), h('b', { text: title }), text ? h('p', { text }) : null); }
  function section(title, count, actions) {
    return h('div', { class: 'sh' }, h('h3', null, title, count !== undefined && count !== null ? h('em', { text: String(count) }) : null), actions ? h('div', { class: 'row' }, actions) : null);
  }
  function seg(options, current, onPick, full) {
    const s = h('div', { class: 'seg' + (full ? ' full' : ''), role: 'radiogroup' });
    for (const [k, label, n] of options) {
      const b = h('button', { class: k === current ? 'on' : '', role: 'radio', 'aria-checked': k === current ? 'true' : 'false' }, label, n !== undefined ? h('span', { class: 'n', text: String(n) }) : null);
      b.addEventListener('click', () => onPick(k));
      put(s, b);
    }
    return s;
  }
  function btn(label, opts) {
    opts = opts || {};
    const b = h('button', { class: 'btn' + (opts.variant ? ' ' + opts.variant : '') + (opts.size ? ' ' + opts.size : '') + (opts.block ? ' block' : ''), title: opts.title || null, disabled: opts.disabled || null },
      opts.icon ? icon(opts.icon, opts.size === 'sm' ? 13 : 15) : null, label ? h('span', { text: label }) : null);
    if (opts.onClick) b.addEventListener('click', opts.onClick);
    return b;
  }
  function switchEl(on, label) {
    return h('button', { class: 'switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label });
  }
  // A labelled setting row with a switch: the whole row is clickable.
  function toggle(on, title, desc, onChange) {
    const row = h('div', { class: 'control' }, h('div', { class: 'txt' }, h('b', { text: title }), desc ? h('span', { text: desc }) : null), switchEl(on, title));
    row.addEventListener('click', () => onChange(!on));
    return row;
  }
  function miniToggle(on, label, onChange) {
    const row = h('span', { class: 'mini', title: label }, switchEl(on, label), h('span', { text: label }));
    row.addEventListener('click', () => onChange(!on));
    return row;
  }
  // Brand mark: corner brackets around a solid square. Flat, follows the theme.
  function logoMark() {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 128 128'); s.setAttribute('class', 'mark'); s.setAttribute('aria-hidden', 'true');
    const el = (tag, attrs) => { const e = document.createElementNS(SVG_NS, tag); for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); s.appendChild(e); return e; };
    el('rect', { width: '128', height: '128', rx: '30', fill: 'var(--text)' });
    for (const d of ['M32 52V40a8 8 0 0 1 8-8h12', 'M76 32h12a8 8 0 0 1 8 8v12', 'M96 76v12a8 8 0 0 1-8 8H76', 'M52 96H40a8 8 0 0 1-8-8V76']) {
      el('path', { d, fill: 'none', stroke: 'var(--bg)', 'stroke-width': '10', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    }
    el('rect', { x: '53', y: '53', width: '22', height: '22', rx: '5', fill: 'var(--accent)' });
    return s;
  }
  function ibtn(name, title, onClick, small) {
    const b = h('button', { class: 'ibtn' + (small ? ' sm' : ''), title, 'aria-label': title }, icon(name, small ? 14 : 16));
    b.addEventListener('click', onClick);
    return b;
  }

  // ── syntax highlighting (text nodes only) ──
  const HL = {
    css: /(\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^[^{}\n][^{}\n]*(?=\s*\{))|([\w-]+)(?=\s*:[^:])|(#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|rem|em|%|s|ms|deg|vh|vw|fr)?\b)/gm,
    js: /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\})|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|(<\/?[A-Za-z][\w.]*|\/?>)|\b(import|from|export|default|function|const|let|return|true|false|null|module|exports)\b|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$-]*)(?==)/g
  };
  function highlight(code, lang) {
    const frag = document.createDocumentFragment();
    const lines = code.replace(/\n$/, '').split('\n');
    const big = code.length > 120000;
    const re = HL[lang];
    for (const line of lines.slice(0, 4000)) {
      const ln = h('span', { class: 'ln' });
      if (big || !re) ln.textContent = line;
      else {
        let last = 0; let m; re.lastIndex = 0;
        while ((m = re.exec(line))) {
          if (m[0] === '') { re.lastIndex++; continue; }
          if (m.index > last) put(ln, line.slice(last, m.index));
          let cls = '';
          if (lang === 'css') cls = m[1] ? 'hc' : m[2] ? 'hs' : m[3] ? 'hsel' : m[4] ? 'hp' : 'hn';
          else cls = m[1] ? 'hc' : m[2] ? 'hs' : m[3] ? 'ht' : m[4] ? 'hk' : m[5] ? 'hn' : 'ha';
          put(ln, h('span', { class: cls, text: m[0] }));
          last = m.index + m[0].length;
        }
        if (last < line.length) put(ln, line.slice(last));
      }
      put(frag, ln);
    }
    return frag;
  }
  function codeViewer(text, file, lang, extraActions) {
    const pre = h('pre');
    put(pre, highlight(text, lang));
    const lines = text.replace(/\n$/, '').split('\n').length;
    return h('div', { class: 'code' },
      h('div', { class: 'bar' }, icon('file', 13), h('span', { class: 'name grow ell', text: file }), h('span', { class: 't3 sm', text: `${lines} lines` }),
        extraActions || null,
        ibtn('copy', 'Copy', () => copy(text, file), true),
        ibtn('download', 'Download', () => downloadText(file, text, file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript'), true)),
      pre);
  }

  // ── header ──
  const themeBtn = h('button', { class: 'ibtn', 'aria-label': 'Toggle theme' });
  themeBtn.addEventListener('click', () => {
    const cur = root.getAttribute('data-theme');
    prefs.theme = cur === 'light' ? 'dark' : 'light'; savePrefs(); applyTheme();
  });
  const btnMin = ibtn('minus', 'Minimize', () => {
    panel.classList.toggle('min');
    btnMin.replaceChildren(icon(panel.classList.contains('min') ? 'plus' : 'minus', 16));
  });
  const helpBtn = ibtn('help', 'Help', () => { state.help = !state.help; render(); body.scrollTop = 0; });
  const head = h('div', { class: 'head' },
    logoMark(),
    h('div', { class: 'brand' }, h('b', { text: 'Uxearly Inspect' }), h('span', { text: 'v' + (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '') })),
    helpBtn, themeBtn, btnMin, ibtn('close', 'Close', () => destroy()));

  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(window.innerHeight - 48, e.clientY - drag.dy));
    panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto';
  });
  head.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    prefs.pos = { left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0 }; savePrefs();
  });

  const TABS = [['font', 'Fonts', 'font'], ['color', 'Colors', 'color'], ['measure', 'Measure', 'ruler'], ['system', 'Tokens', 'tokens'], ['code', 'Code', 'code'], ['images', 'Images', 'image'], ['capture', 'Capture', 'camera']];
  const tabBtns = {};
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  for (const [id, name, ic] of TABS) {
    const b = h('button', { class: 'tab', role: 'tab', 'aria-selected': 'false' }, icon(ic, 17), h('span', { text: name }));
    b.addEventListener('click', () => setTab(id));
    tabBtns[id] = b; put(tabsEl, b);
  }
  const body = h('div', { class: 'body' });
  put(panel, head, tabsEl, body, footer);

  // ── state ──
  const state = {
    tab: 'font', mode: 'none', hoverEl: null, pinnedFont: null, codeEl: null,
    picked: [], scan: null, tokens: null, scanning: false, paletteFilter: 'all',
    codeView: 'css', codeChildren: true, codeResult: null, pageFramework: null,
    images: null, imgFilter: 'all', imgDetail: null, imgBusy: false, allSites: null, shot: null, shotAbort: false, dbgGranted: null, help: false, stale: false, measure: { anchor: null, ruler: null, drag: null, letter: null, point: null }, mPrefs: { spacing: true, letters: true, unit: 'px' }, fontFiles: null, fontFilesLoading: false
  };
  const views = {};

  function defaultStatus() {
    if (state.mode === 'font') return 'Hover text · click to pin · Esc';
    if (state.mode === 'code') return 'Click an element · Esc to cancel';
    if (state.mode === 'measure') return 'Click to pin · drag for a ruler · Esc';
    return 'Ready';
  }
  function setTab(id) {
    state.tab = id;
    state.help = false;
    if (prefs.lastTab !== id && id !== 'capture') { prefs.lastTab = id; savePrefs(); }
    for (const k of Object.keys(tabBtns)) { tabBtns[k].classList.toggle('on', k === id); tabBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false'); }
    if (id === 'font') setMode('font');
    else if (id === 'measure') setMode('measure');
    else if (state.mode !== 'none') setMode('none');
    if (id === 'code' && state.codeEl && document.contains(state.codeEl)) placeBox(selOverlay, state.codeEl);
    else selOverlay.style.display = 'none';
    render();
    body.scrollTop = 0;
  }
  function setMode(m) {
    state.mode = m;
    overlay.style.display = 'none'; tip.style.display = 'none';
    if (m !== 'measure') { mLayer.replaceChildren(); state.measure.drag = null; }
    if (m === 'none') state.hoverEl = null;
    status(defaultStatus());
  }
  function render() {
    const keep = body.scrollTop;
    body.replaceChildren();
    helpBtn.classList.toggle('on', state.help);
    if (state.stale) {
      put(body, h('div', { class: 'note warn', style: 'margin-bottom:12px' }, icon('alert', 14), h('div', { class: 'grow' },
        h('div', { text: 'Uxearly Inspect was updated in the background. Close this panel and click the toolbar icon to load the new version.' }),
        h('div', { style: 'margin-top:8px' }, btn('Close panel', { size: 'sm', onClick: () => destroy() })))));
    }
    const v = state.help ? views.help : views[state.tab];
    if (v) v(body);
    body.scrollTop = keep;
  }

  // ═════════ Fonts ═════════
  views.font = (rootEl) => {
    const live = state.mode === 'font';
    put(rootEl, h('div', { class: 'card' }, toggle(live, 'Inspect text on hover',
      live ? 'Hover text to preview its type. Click to pin the full spec.' : 'Turn on to read typography from the page.',
      (v) => { setMode(v ? 'font' : 'none'); render(); })));

    const f = state.pinnedFont;
    const sec = h('div', { class: 'section' });
    put(rootEl, sec);
    if (!f || !document.contains(f.el)) {
      put(sec, h('div', { class: 'card' }, empty('font', 'No text selected', 'Hover any text on the page to preview its type. Click to pin the full spec here.')));
    } else {
      const i = fontInfo(f.el);
      const prev = h('div', { class: 'preview' });
      prev.style.background = toRgb(i.bg); prev.style.color = i.color ? toRgb(i.color) : '';
      const spec = h('div', { class: 'spec', text: i.rendered || i.family });
      const sample = h('div', { class: 'sample', text: (f.el.innerText || f.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) || 'The quick brown fox jumps over the lazy dog' });
      for (const el of [spec, sample]) { el.style.fontFamily = i.stack; el.style.fontWeight = String(i.weight); el.style.fontStyle = i.style; }
      sample.style.letterSpacing = i.letterSpacing; sample.style.textTransform = i.transform;
      put(prev, spec, sample);

      const tile = (l, v, s, val) => { const t = h('div', { class: 'tile', title: 'Copy ' + l.toLowerCase() }, h('div', { class: 'l', text: l }), h('div', { class: 'v', text: v }), h('div', { class: 's', text: s || ' ' })); t.addEventListener('click', () => copy(val || v, l.toLowerCase())); return t; };
      const tiles = h('div', { class: 'tiles' },
        tile('Size', `${round(i.size, 2)}px`, `${i.sizeRem}rem`),
        tile('Weight', String(i.weight), i.weightName),
        tile('Line', i.lhPx ? `${round(i.lhPx, 1)}px` : 'normal', i.lhRatio ? `${i.lhRatio} ratio` : 'auto'),
        tile('Tracking', i.letterSpacing === 'normal' ? '0' : i.letterSpacing, i.letterSpacing === 'normal' ? 'normal' : (i.size ? round(px(i.letterSpacing) / i.size, 3) + 'em' : ''), i.letterSpacing));

      const kv = h('div', { class: 'kv' });
      const row = (k, v, copyVal) => {
        const vv = h('div', { class: 'v' + (copyVal ? ' copyable' : ''), title: copyVal ? 'Click to copy' : null }, v);
        if (copyVal) vv.addEventListener('click', () => copy(copyVal, k.toLowerCase()));
        put(kv, h('div', { class: 'k', text: k }), vv);
      };
      row('Family', i.family, i.family);
      row('Rendered', i.rendered === i.family ? h('span', { text: i.rendered }) : h('span', { class: 'row' }, h('span', { text: i.rendered }), h('span', { class: 'pill warn', text: 'Fallback' })), i.rendered);
      row('Stack', h('span', { class: 'mono t2 break', text: i.stack }), i.stack);
      row('Color', i.color ? h('span', { class: 'row' }, swatch(i.color), h('span', { class: 'mono', text: fmtColor(i.color, prefs.colorFormat) })) : '—', i.color ? fmtColor(i.color, prefs.colorFormat) : null);
      row('Background', h('span', { class: 'row' }, swatch(i.bg), h('span', { class: 'mono', text: fmtColor(i.bg, prefs.colorFormat) })), fmtColor(i.bg, prefs.colorFormat));
      if (i.contrast) {
        const c = i.contrast;
        row('Contrast', h('span', { class: 'row' }, h('span', { class: 'mono', text: `${c.toFixed(2)}:1` }),
          h('span', { class: 'pill ' + (c >= 4.5 ? 'ok' : c >= 3 ? 'warn' : 'bad'), text: c >= 7 ? 'AAA' : c >= 4.5 ? 'AA' : c >= 3 ? 'AA Large' : 'Fail' })));
      }
      row('Style', [i.style, i.transform !== 'none' ? i.transform : null, i.decoration !== 'none' ? i.decoration : null, `align ${i.align}`].filter(Boolean).join(' · '));
      row('Element', h('span', { class: 'mono t2', text: label(f.el) }));

      const css = cssBlock(rootSelector(f.el), [
        ['font-family', i.stack], ['font-size', `${round(i.size, 2)}px`], ['font-weight', String(i.weight)],
        ['line-height', i.lineHeight], ...(i.letterSpacing !== 'normal' ? [['letter-spacing', i.letterSpacing]] : []),
        ...(i.style !== 'normal' ? [['font-style', i.style]] : []), ...(i.transform !== 'none' ? [['text-transform', i.transform]] : []),
        ...(i.color ? [['color', toHex(i.color)]] : [])
      ]);
      put(sec, section('Selected text', null, ibtn('close', 'Unpin', () => { state.pinnedFont = null; render(); }, true)),
        h('div', { class: 'card pad' }, prev, tiles, h('div', { style: 'margin-top:10px' }, kv),
          h('div', { class: 'sh', style: 'margin:14px 0 6px' }, h('h3', null, 'Copy code')),
          h('div', { class: 'fmt' },
            codeAction('Typography', 'Font CSS only', () => copy(css, 'typography CSS')),
            codeAction('Element CSS', 'All styles', () => copy(plainCss(f.el, false).css, 'element CSS')),
            codeAction('HTML', 'Outer markup', () => copy(f.el.outerHTML.length > 200000 ? f.el.outerHTML.slice(0, 200000) : f.el.outerHTML, 'HTML'))),
          h('div', { style: 'margin-top:8px' }, btn('Open in Code tab', { icon: 'code', block: true, onClick: () => { const el = f.el; setTab('code'); showSel(el); extractCode(el); } }))));
    }

    const fsec = h('div', { class: 'section' });
    put(rootEl, fsec);
    const fill = () => {
      fsec.replaceChildren();
      const fams = [...state.scan.families.values()].sort((a, b) => b.count - a.count);
      put(fsec, section('Fonts on this page', fams.length));
      if (!fams.length) { put(fsec, h('div', { class: 't3', text: 'No text found.' })); return; }
      const list = h('div', { class: 'list' });
      for (const fam of fams.slice(0, 24)) {
        const nm = h('div', { class: 'ell', text: fam.family, style: 'font-size:14px;line-height:1.3' });
        nm.style.fontFamily = fam.stack;
        const rendered = renderedFont(fam.stack);
        const it = h('div', { class: 'item', title: 'Copy font-family' },
          h('div', { class: 'grow' }, nm, h('div', { class: 'mono t3 ell', text: [...fam.weights].sort().join(' · ') + (rendered !== fam.family ? `  →  ${rendered}` : '') })),
          rendered !== fam.family ? h('span', { class: 'pill warn', text: 'Fallback' }) : null,
          h('span', { class: 'count', text: String(fam.count) }));
        it.addEventListener('click', () => copy(`font-family: ${fam.stack};`, 'font-family'));
        put(list, it);
      }
      put(fsec, list);
      put(fsec, fontFilesSection());
    };
    if (state.scan) fill();
    else { put(fsec, section('Fonts on this page'), h('div', { class: 'row t3' }, h('span', { class: 'spin' }), 'Scanning…')); ensureScan().then(() => { if (state.tab === 'font') fill(); }); }
  };

  function codeAction(title, sub, fn) {
    const b = h('button', { title: 'Copy ' + title }, h('b', null, title, icon('copy', 13)), h('span', { text: sub }));
    b.addEventListener('click', fn);
    return b;
  }

  // ═════════ Font files ═════════
  const FONT_EXT_RE = /\.(woff2|woff|ttf|otf|eot)(?:[?#]|$)/i;
  const FONT_ORDER = ['woff2', 'woff', 'ttf', 'otf', 'eot'];
  const FONT_MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject' };
  function fontFormat(url, hint) {
    const h2 = String(hint || '').toLowerCase();
    if (/woff2/.test(h2)) return 'woff2';
    if (/woff/.test(h2)) return 'woff';
    if (/truetype|ttf/.test(h2)) return 'ttf';
    if (/opentype|otf/.test(h2)) return 'otf';
    if (/embedded/.test(h2)) return 'eot';
    if (url.startsWith('data:')) { const m = /^data:([^;,]+)/.exec(url); const t = m ? m[1] : ''; return /woff2/.test(t) ? 'woff2' : /woff/.test(t) ? 'woff' : /otf|opentype/.test(t) ? 'otf' : /ttf|truetype|sfnt/.test(t) ? 'ttf' : 'woff2'; }
    const m = FONT_EXT_RE.exec(url); return m ? m[1].toLowerCase() : null;
  }
  const unquote = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  function normWeight(w) { w = String(w || '').trim().toLowerCase(); if (!w || w === 'normal') return '400'; if (w === 'bold') return '700'; return w.replace(/\s+/g, ' '); }
  function normStyle(st) { st = String(st || '').trim().toLowerCase(); return st.startsWith('italic') ? 'italic' : st.startsWith('oblique') ? 'oblique' : 'normal'; }

  async function collectFontFiles() {
    const faces = new Map();
    const known = new Set();
    const addFace = (family, weight, style, src, base, origin) => {
      family = unquote(family); if (!family) return;
      const key = `${family.toLowerCase()}|${normWeight(weight)}|${normStyle(style)}`;
      let f = faces.get(key);
      if (!f) { f = { key, family, weight: normWeight(weight), style: normStyle(style), files: [], origin }; faces.set(key, f); }
      const re = /url\(\s*(["']?)(.*?)\1\s*\)(?:\s*format\(\s*(["']?)(.*?)\3\s*\))?/gi;
      let m;
      while ((m = re.exec(String(src || '')))) {
        let url; try { url = new URL(m[2], base).href; } catch (_) { continue; }
        if (!/^(https?:|data:)/i.test(url) || known.has(url)) continue;
        const format = fontFormat(url, m[4]);
        if (!format) continue;
        known.add(url);
        f.files.push({ url, format });
      }
    };
    const blocked = [];
    const seenSheets = new Set();
    const visit = (rules, base) => {
      for (const r of rules) {
        if (typeof CSSFontFaceRule !== 'undefined' && r instanceof CSSFontFaceRule) addFace(r.style.getPropertyValue('font-family'), r.style.getPropertyValue('font-weight'), r.style.getPropertyValue('font-style'), r.style.getPropertyValue('src'), base, 'css');
        else if (typeof CSSImportRule !== 'undefined' && r instanceof CSSImportRule) { if (r.styleSheet) readSheet(r.styleSheet); else if (r.href) blocked.push(new URL(r.href, base).href); }
        else if (r.cssRules) visit(r.cssRules, base);
      }
    };
    const readSheet = (sheet) => {
      if (!sheet || seenSheets.has(sheet)) return;
      seenSheets.add(sheet);
      const base = sheet.href || location.href;
      let rules = null;
      try { rules = sheet.cssRules; } catch (_) { if (sheet.href) blocked.push(sheet.href); return; }
      if (rules) visit(rules, base);
    };
    for (const sh of [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets || [])]) readSheet(sh);

    // Cross-origin stylesheets (Google Fonts, Typekit, CDNs) can't be read by the page; read their @font-face rules here.
    const parseText = (text, base) => {
      const re = /@font-face\s*\{([^}]*)\}/gi; let m;
      while ((m = re.exec(text))) {
        const p = {}; const pr = /(?:^|;)\s*(font-family|font-weight|font-style|src)\s*:\s*([^;]+)/gi; let q;
        while ((q = pr.exec(m[1]))) p[q[1].toLowerCase()] = (p[q[1].toLowerCase()] ? p[q[1].toLowerCase()] + ', ' : '') + q[2];
        addFace(p['font-family'], p['font-weight'], p['font-style'], p.src, base, 'css');
      }
      const imports = []; const ir = /@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/gi; let im;
      while ((im = ir.exec(text))) { try { imports.push(new URL(im[1], base).href); } catch (_) { /* ignore */ } }
      return imports;
    };
    const queue = [...new Set(blocked)].slice(0, 25); const fetched = new Set();
    let unreadable = 0;
    while (queue.length && fetched.size < 30) {
      const url = queue.shift(); if (fetched.has(url)) continue; fetched.add(url);
      const r = await sendBg({ type: 'uxi:fetchCss', url });
      if (r && r.ok && typeof r.text === 'string') { for (const i of parseText(r.text, r.url || url)) if (!fetched.has(i)) queue.push(i); }
      else unreadable++;
    }
    // Font files the browser actually downloaded, even from CSS nobody can read
    try {
      for (const e of performance.getEntriesByType('resource')) {
        if (!FONT_EXT_RE.test(e.name) || known.has(e.name)) continue;
        let file = ''; try { file = decodeURIComponent(new URL(e.name).pathname.split('/').pop()); } catch (_) { file = 'font'; }
        const fam = file.replace(FONT_EXT_RE, '').replace(/[-_.][0-9a-f]{6,}$/i, '').replace(/[-_]+/g, ' ').trim() || 'Font';
        addFace(fam, '', '', `url("${e.name}")`, location.href, 'network');
      }
    } catch (_) { /* no timing data */ }

    const loaded = new Set();
    try { for (const ff of document.fonts) if (ff.status === 'loaded' && !/^Uxi /.test(unquote(ff.family))) loaded.add(unquote(ff.family).toLowerCase()); } catch (_) { /* ignore */ }
    const used = new Set();
    if (state.scan) for (const k of state.scan.families.keys()) used.add(String(k).toLowerCase());
    const list = [...faces.values()].filter((f) => f.files.length);
    for (const f of list) {
      f.files.sort((a, b) => FONT_ORDER.indexOf(a.format) - FONT_ORDER.indexOf(b.format));
      f.formats = [...new Set(f.files.map((x) => x.format))];
      f.loaded = loaded.has(f.family.toLowerCase());
      f.used = used.has(f.family.toLowerCase());
      try { f.host = f.files[0].url.startsWith('data:') ? 'embedded' : new URL(f.files[0].url).hostname.replace(/^www\./, ''); } catch (_) { f.host = ''; }
      f.google = /fonts\.gstatic\.com$/.test(f.host);
    }
    list.sort((a, b) => (b.used - a.used) || a.family.localeCompare(b.family) || parseInt(a.weight, 10) - parseInt(b.weight, 10) || a.style.localeCompare(b.style));
    list.unreadable = unreadable;
    return list;
  }
  function fontFileName(face, format, idx, total) {
    const fam = face.family.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font';
    return `Uxearly Inspect/${siteFolder()}/fonts/${fam}-${face.weight.replace(/\s+/g, '-')}${face.style !== 'normal' ? '-' + face.style : ''}${total > 1 ? '-' + (idx + 1) : ''}.${format}`;
  }
  async function downloadFace(face, format) {
    const files = face.files.filter((x) => x.format === format);
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const filename = fontFileName(face, format, i, files.length);
      let r;
      if (f.url.startsWith('data:')) {
        const m = /^data:[^,]*;base64,(.*)$/s.exec(f.url);
        r = m ? await sendBg({ type: 'uxi:download', b64: m[1].replace(/\s/g, ''), mime: FONT_MIME[format], filename }) : { ok: false };
      } else r = await sendBg({ type: 'uxi:download', url: f.url, filename });
      if (r && r.ok) ok++;
    }
    return { ok, total: files.length };
  }
  function ensureFontFiles() {
    if (state.fontFiles || state.fontFilesLoading) return;
    state.fontFilesLoading = true;
    collectFontFiles().then((list) => { state.fontFiles = list; }, () => { state.fontFiles = []; })
      .finally(() => { state.fontFilesLoading = false; if (state.tab === 'font' && !state.help) render(); });
  }
  function fontFilesSection() {
    const sec = h('div', { class: 'section' });
    const list = state.fontFiles;
    if (!list) {
      put(sec, section('Font files'), h('div', { class: 'row t3' }, h('span', { class: 'spin' }), 'Finding font files…'));
      ensureFontFiles();
      return sec;
    }
    const all = async () => {
      let ok = 0, total = 0;
      status(`Downloading ${list.length} font${list.length > 1 ? 's' : ''}…`, 'busy');
      for (const f of list) { const r = await downloadFace(f, f.formats[0]); ok += r.ok; total += r.total; }
      status(ok === total ? `Saved ${ok} font file${ok > 1 ? 's' : ''} to Downloads › Uxearly Inspect › ${siteFolder()} › fonts` : `Saved ${ok} of ${total} font files`, ok ? 'ok' : 'err');
    };
    put(sec, section('Font files', list.length, list.length ? btn('Download all', { size: 'sm', icon: 'download', onClick: all }) : ibtn('refresh', 'Scan again', () => { state.fontFiles = null; render(); }, true)));
    if (!list.length && !list.unreadable) {
      put(sec, h('div', { class: 'card' }, empty('type', 'No downloadable font files', 'This page only uses fonts installed on your computer.')));
      return sec;
    }
    const wrap = h('div', { class: 'list' });
    for (const f of list.slice(0, 80)) {
      const nm = h('div', { class: 'ell', text: f.family, style: 'font-size:14px;line-height:1.35' });
      nm.style.fontFamily = `"${f.family.replace(/"/g, '')}", var(--sans)`; nm.style.fontWeight = /^\d+$/.test(f.weight) ? f.weight : '400'; nm.style.fontStyle = f.style;
      const meta = [f.weight + (f.style !== 'normal' ? ' ' + f.style : ''), f.host, f.files.length > f.formats.length ? `${f.files.length} files` : null].filter(Boolean).join(' · ');
      const chips = h('div', { class: 'row', style: 'gap:4px' });
      for (const fmt of f.formats) {
        const b = h('button', { class: 'btn sm', title: `Download ${fmt.toUpperCase()}` }, h('span', { text: fmt.toUpperCase() }));
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          status(`Downloading ${f.family} ${fmt.toUpperCase()}…`, 'busy');
          const r = await downloadFace(f, fmt);
          status(r.ok === r.total ? `Saved ${f.family} (${r.ok} file${r.ok > 1 ? 's' : ''})` : 'Some files couldn’t be saved', r.ok ? 'ok' : 'err');
        });
        put(chips, b);
      }
      put(wrap, h('div', { class: 'item', style: 'cursor:default' },
        h('div', { class: 'grow' }, nm, h('div', { class: 'mono t3 ell', text: meta })),
        f.used ? h('span', { class: 'pill accent', text: 'In use' }) : null, chips));
    }
    put(sec, wrap);
    if (list.unreadable) {
      const note = h('div');
      put(sec, note);
      const show = (granted) => put(note, h('div', { class: 'note', style: 'margin-top:10px' }, icon('lock', 14), h('div', { class: 'grow' },
        h('div', { text: `${list.unreadable} stylesheet${list.unreadable > 1 ? 's are' : ' is'} hosted on a server that blocks other sites from reading ${list.unreadable > 1 ? 'them' : 'it'}, so ${list.unreadable > 1 ? 'their' : 'its'} fonts may be missing here.` }),
        granted ? null : h('div', { style: 'margin-top:8px' }, btn('Allow access on all sites…', { size: 'sm', onClick: () => sendBg({ type: 'uxi:openOptions' }) })))));
      if (state.allSites === null) checkAllSites().then(show); else show(state.allSites);
    }
    if (list.some((f) => f.google)) put(sec, h('div', { class: 't3 sm', style: 'margin-top:8px', text: 'Google Fonts are free to use under their open licenses. You can also get them at fonts.google.com.' }));
    put(sec, h('div', { class: 't3 sm', style: 'margin-top:8px', text: 'Most commercial fonts are licensed. Only download fonts you have the rights to use.' }));
    return sec;
  }

  // ═════════ Colors ═════════
  const fmtSeg = () => seg([['hex', 'HEX'], ['rgb', 'RGB'], ['hsl', 'HSL']], prefs.colorFormat, (k) => { prefs.colorFormat = k; savePrefs(); render(); });
  views.color = (rootEl) => {
    const supported = 'EyeDropper' in window;
    const pick = btn('Pick from screen', { variant: 'primary', icon: 'pipette', disabled: !supported, onClick: async () => {
      try {
        const ed = new window.EyeDropper();
        overlay.style.display = 'none'; tip.style.display = 'none';
        panel.style.visibility = 'hidden';
        const res = await ed.open();
        panel.style.visibility = '';
        const c = parseColor(res.sRGBHex);
        if (c) {
          state.picked = [c, ...state.picked.filter((x) => toHex(x) !== toHex(c))].slice(0, 24);
          render();
          copy(fmtColor(c, prefs.colorFormat), fmtColor(c, prefs.colorFormat));
        }
      } catch (_) { panel.style.visibility = ''; }
    } });
    put(rootEl, h('div', { class: 'row' }, pick, h('div', { class: 'grow' }), fmtSeg()));
    if (!supported) put(rootEl, h('div', { class: 'note warn', style: 'margin-top:10px' }, icon('alert', 14), h('span', { text: 'Screen picker needs Chrome 95 or newer.' })));

    const ps = h('div', { class: 'section' });
    put(ps, section('Picked', state.picked.length || null, state.picked.length ? btn('Clear', { variant: 'ghost', size: 'sm', onClick: () => { state.picked = []; render(); } }) : null));
    if (!state.picked.length) put(ps, h('div', { class: 'card' }, empty('pipette', 'Pick any color on screen', 'Works on images, videos and gradients too. Each pick is copied automatically.')));
    else {
      const list = h('div', { class: 'list' });
      for (const c of state.picked) {
        const vals = h('div', { class: 'grow' });
        for (const f of ['hex', 'rgb', 'hsl']) {
          const v = fmtColor(c, f);
          const line = h('div', { class: 'mono copyable ell', title: 'Copy', text: v, style: f === prefs.colorFormat ? 'color:var(--text)' : 'color:var(--text-3)' });
          line.addEventListener('click', (e) => { e.stopPropagation(); copy(v, v); });
          put(vals, line);
        }
        const onW = contrast(c, { r: 255, g: 255, b: 255, a: 1 }), onB = contrast(c, { r: 0, g: 0, b: 0, a: 1 });
        const best = onW >= onB ? ['White', onW] : ['Black', onB];
        put(list, h('div', { class: 'item', style: 'cursor:default' }, swatch(c, 'lg'), vals,
          h('div', { style: 'text-align:right' }, h('div', { class: 'sm t3', text: `on ${best[0].toLowerCase()} text` }), h('span', { class: 'pill ' + (best[1] >= 4.5 ? 'ok' : best[1] >= 3 ? 'warn' : 'bad'), text: best[1].toFixed(2) + ':1' }))));
      }
      put(ps, list);
    }
    put(rootEl, ps);

    const box = h('div', { class: 'section' });
    put(rootEl, box);
    const fill = () => {
      box.replaceChildren();
      const all = [...state.scan.colors.values()];
      const cnt = (k) => all.filter((e) => k === 'all' || e.uses.has(k)).length;
      put(box, section('Page palette', all.length, btn('', { variant: 'ghost', size: 'sm', icon: 'refresh', title: 'Rescan', onClick: async () => { state.scan = null; state.tokens = null; render(); await ensureScan(true); render(); } })));
      const filters = [['all', 'All'], ['text', 'Text'], ['background', 'Fill'], ['border', 'Border'], ['svg', 'Icons'], ['gradient', 'Gradient']].filter(([k]) => k === 'all' || cnt(k));
      put(box, seg(filters.map(([k, n]) => [k, n, cnt(k)]), state.paletteFilter, (k) => { state.paletteFilter = k; fill(); }, true));
      const list = all.filter((e) => state.paletteFilter === 'all' || e.uses.has(state.paletteFilter)).sort((a, b) => b.count - a.count);
      if (!list.length) { put(box, h('div', { class: 't3', style: 'padding:12px 0', text: 'No colors in this group.' })); return; }
      const grid = h('div', { class: 'swatches', style: 'margin-top:10px' });
      for (const e of list.slice(0, 160)) {
        const v = fmtColor(e.c, prefs.colorFormat);
        const chip = h('button', { class: 'chip', title: `${v}\nUsed ${e.count}× · ${[...e.uses].join(', ')}`, 'aria-label': `Copy ${v}` });
        const i = h('i'); i.style.background = toRgb(e.c); put(chip, i);
        chip.addEventListener('click', () => copy(v, v));
        put(grid, chip);
      }
      put(box, grid);
      const allTxt = list.map((e) => fmtColor(e.c, prefs.colorFormat)).join('\n');
      put(box, h('div', { class: 'row', style: 'margin-top:12px' },
        btn(`Copy ${list.length} colors`, { size: 'sm', icon: 'copy', onClick: () => copy(allTxt, `${list.length} colors`) }),
        h('span', { class: 't3 sm grow', style: 'text-align:right', text: 'Click a swatch to copy' })));
    };
    if (state.scan) fill();
    else { put(box, section('Page palette'), h('div', { class: 'row t3' }, h('span', { class: 'spin' }), 'Scanning…')); ensureScan().then(() => { if (state.tab === 'color') fill(); }); }
  };

  async function ensureScan(force) {
    if (state.scan && !force) return state.scan;
    if (state.scanning) return state.scanning;
    state.scanning = (async () => {
      try {
        state.scan = await scanPage((i, n) => status('Scanning page…', 'busy', n ? i / n : undefined));
        state.tokens = buildTokens(state.scan);
        status(`Scanned ${state.scan.scanned.toLocaleString()} elements`, 'ok');
      } catch (e) {
        status('Scan failed: ' + (e && e.message || e), 'err');
        state.scan = { colors: new Map(), typo: new Map(), families: new Map(), spacing: new Map(), radii: new Map(), shadows: new Map(), vars: [], breakpoints: [], webfonts: [], blockedSheets: 0, scanned: 0, total: 0 };
        state.tokens = buildTokens(state.scan);
      } finally { state.scanning = false; }
      return state.scan;
    })();
    return state.scanning;
  }

  // ═════════ Tokens (design system) ═════════
  views.system = (rootEl) => {
    if (!state.tokens) {
      put(rootEl, h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'spin' }), h('b', { text: 'Building design system…' }), h('p', { text: 'Reading colors, type, spacing, radii, shadows and CSS variables.' }))));
      ensureScan().then(() => { if (state.tab === 'system') render(); });
      return;
    }
    const t = state.tokens;
    const stat = (n, l) => h('div', { class: 'stat' }, h('b', { text: String(n) }), h('span', { text: l }));
    put(rootEl, h('div', { class: 'row', style: 'margin-bottom:10px' },
      h('div', { class: 'grow' }, h('div', { style: 'font-weight:600', text: location.hostname || 'This page' }), h('div', { class: 't3 sm', text: `${state.scan.scanned.toLocaleString()} elements scanned` })),
      btn('Rescan', { size: 'sm', icon: 'refresh', onClick: async () => { state.tokens = null; render(); await ensureScan(true); render(); } })));
    put(rootEl, h('div', { class: 'stats' }, stat(t.colors.length, 'Colors'), stat(t.textStyles.length, 'Text styles'), stat(t.spacing.length, 'Spacing'), stat(t.vars.length, 'Variables')));

    const exps = [
      ['CSS variables', ':root custom properties + text classes', () => exportCss(t), 'design-system.css', 'text/css', 'css'],
      ['Design tokens', 'W3C DTCG JSON for Figma Tokens / Style Dictionary', () => exportJson(t), 'design-tokens.json', 'application/json', 'js'],
      ['Tailwind theme', 'tailwind.config.js theme.extend', () => exportTailwind(t), 'tailwind.config.js', 'text/javascript', 'js']
    ];
    const expCard = h('div', { class: 'card' });
    for (const [n, d, fn, file, mime] of exps) {
      put(expCard, h('div', { class: 'exp' }, h('div', { class: 'ficon' }, icon('file', 15)),
        h('div', { class: 'grow' }, h('div', { style: 'font-weight:500', text: n }), h('div', { class: 't3 sm ell', text: d })),
        ibtn('copy', 'Copy ' + n, () => copy(fn(), n)), ibtn('download', 'Download ' + file, () => downloadText(file, fn(), mime))));
    }
    put(rootEl, h('div', { class: 'section' }, section('Export'), expCard));

    // Colors
    const cl = h('div', { class: 'list' });
    for (const c of t.colors) {
      const pc = parseColor(c.hex); const v = fmtColor(pc, prefs.colorFormat);
      const it = h('div', { class: 'item', title: 'Copy value' }, swatch(pc), h('span', { class: 'mono grow ell', text: `--color-${c.name}` }), h('span', { class: 'mono t2', text: v }), h('span', { class: 'count', text: String(c.count) }));
      it.addEventListener('click', () => copy(v, v));
      put(cl, it);
    }
    if (!t.colors.length) put(cl, h('div', { class: 't3', text: 'No colors found.' }));
    put(rootEl, h('div', { class: 'section' }, section('Colors', t.colors.length, fmtSeg()), cl));

    // Typography
    const tl = h('div', { class: 'list' });
    for (const s of t.textStyles) {
      const prev = h('div', { class: 'ell', text: s.sample || 'The quick brown fox' });
      prev.style.fontFamily = s.stack; prev.style.fontWeight = String(s.weight); prev.style.fontSize = Math.min(s.size, 28) + 'px'; prev.style.lineHeight = '1.25';
      const meta = `${s.family} · ${round(s.size, 1)}/${s.lineHeight === 'normal' ? 'auto' : round(px(s.lineHeight), 1)} · ${s.weight}${s.letterSpacing !== 'normal' ? ' · ' + s.letterSpacing : ''}`;
      const css = `font-family: ${s.stack};\nfont-size: ${s.size}px;\nfont-weight: ${s.weight};\nline-height: ${s.lineHeight};${s.letterSpacing !== 'normal' ? `\nletter-spacing: ${s.letterSpacing};` : ''}`;
      const it = h('div', { class: 'item', title: 'Copy CSS', style: 'display:block;padding-top:8px;padding-bottom:8px' },
        h('div', { class: 'row', style: 'margin-bottom:3px' }, h('span', { class: 'mono t2 grow', text: s.name }), h('span', { class: 'count', text: `${s.count}× ${s.topTag}` })),
        prev, h('div', { class: 'mono t3 ell', style: 'margin-top:2px', text: meta }));
      it.addEventListener('click', () => copy(css, s.name));
      put(tl, it);
    }
    put(rootEl, h('div', { class: 'section' }, section('Text styles', t.textStyles.length), tl));

    // Families
    const fl = h('div', { class: 'list' });
    for (const f of t.families.slice(0, 8)) {
      const nm = h('span', { class: 'grow ell', text: f.family, style: 'font-size:13px' }); nm.style.fontFamily = f.stack;
      const it = h('div', { class: 'item', title: 'Copy font stack' }, nm, h('span', { class: 'mono t3', text: [...f.weights].sort().join(' ') }));
      it.addEventListener('click', () => copy(f.stack, 'font stack'));
      put(fl, it);
    }
    put(rootEl, h('div', { class: 'section' }, section('Font families', t.families.length), fl));

    // Spacing
    if (t.spacing.length) {
      const max = Math.max(1, ...t.spacing);
      const sl = h('div', { class: 'list' });
      t.spacing.forEach((s, i) => {
        const it = h('div', { class: 'item', title: 'Copy' }, h('span', { class: 'mono t2', style: 'width:64px', text: `space-${i + 1}` }),
          h('div', { class: 'grow bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.max(3, (s / max) * 100)}%` })), h('span', { class: 'mono', style: 'width:44px;text-align:right', text: `${s}px` }));
        it.addEventListener('click', () => copy(`${s}px`, `${s}px`));
        put(sl, it);
      });
      put(rootEl, h('div', { class: 'section' }, section('Spacing', t.spacing.length, t.spacingBase ? h('span', { class: 'pill accent', text: `${t.spacingBase}px grid` }) : null), sl));
    }
    if (t.radii.length) {
      const rg = h('div', { class: 'radii' });
      for (const r of t.radii) {
        const sh = h('i'); sh.style.borderTopLeftRadius = Math.min(r.v, 30) + 'px';
        const it = h('div', { class: 'radius', title: 'Copy' }, sh, h('span', { class: 'mono sm', text: r.v >= 9999 ? 'full' : `${r.v}px` }));
        it.addEventListener('click', () => copy(`${r.v}px`, `${r.v}px`));
        put(rg, it);
      }
      put(rootEl, h('div', { class: 'section' }, section('Radius', t.radii.length), rg));
    }
    if (t.shadows.length) {
      const shl = h('div', { class: 'list' });
      t.shadows.forEach((s, i) => {
        const demo = h('div', { style: `width:26px;height:26px;border-radius:6px;background:var(--raised);flex:none;box-shadow:${s.v.replace(/[;{}]/g, '')}` });
        const it = h('div', { class: 'item', title: s.v }, demo, h('span', { class: 'mono t2', text: `shadow-${i + 1}` }), h('span', { class: 'mono t3 grow ell', text: s.v }));
        it.addEventListener('click', () => copy(`box-shadow: ${s.v};`, 'shadow'));
        put(shl, it);
      });
      put(rootEl, h('div', { class: 'section' }, section('Shadows', t.shadows.length), shl));
    }
    if (t.breakpoints.length) {
      put(rootEl, h('div', { class: 'section' }, section('Breakpoints', t.breakpoints.length),
        h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, t.breakpoints.slice(0, 14).map(([v, c]) => h('span', { class: 'pill', title: `${c} media rule(s)`, text: `${v}px` })))));
    }
    const vs = h('div', { class: 'section' });
    put(vs, section('CSS variables', t.vars.length));
    if (!t.vars.length) put(vs, h('div', { class: 'note' }, icon('alert', 14), h('span', { text: state.scan.blockedSheets ? `No readable root variables. ${state.scan.blockedSheets} cross-origin stylesheet(s) can't be read by the browser.` : 'This page defines no root-level CSS variables.' })));
    else {
      const vl = h('div', { class: 'list' });
      for (const v of t.vars.slice(0, 250)) {
        const val = v.resolved || v.value;
        const c = /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(val) ? parseColor(val) : null;
        const it = h('div', { class: 'item', title: `Copy var(${v.name})` }, c ? swatch(c) : h('span', { class: 'sw', style: 'background:var(--hover)' }), h('span', { class: 'mono grow ell', text: v.name }), h('span', { class: 'mono t3 ell', style: 'max-width:44%', title: val, text: val }));
        it.addEventListener('click', () => copy(`var(${v.name})`, v.name));
        put(vl, it);
      }
      put(vs, vl);
      if (state.scan.blockedSheets) put(vs, h('div', { class: 't3 sm', style: 'margin-top:8px', text: `${state.scan.blockedSheets} cross-origin stylesheet(s) couldn't be read.` }));
    }
    put(rootEl, vs);
  };

  // ═════════ Code ═════════
  // Every call to the service worker has a timeout so the panel can never get stuck waiting.
  const BG_TIMEOUT = { 'uxi:avif': 90000, 'uxi:shot-frame': 45000, 'uxi:shot-finish': 120000, 'uxi:shot-begin': 15000, 'uxi:fetch': 30000, 'uxi:fetchCss': 15000, 'uxi:download': 30000 };
  function sendBg(msg) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT', error: 'The extension took too long to respond.' }), BG_TIMEOUT[msg.type] || 10000);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) { markStale(chrome.runtime.lastError.message); finish({ ok: false, error: chrome.runtime.lastError.message }); }
          else finish(res || { ok: false });
        });
      } catch (e) { markStale('context invalidated'); finish({ ok: false, error: 'Extension was updated. Close and reopen the panel.' }); }
    });
  }
  function markStale(msg) {
    if (state.stale || !/context invalidated|Extension context|message port closed before|Could not establish connection/i.test(String(msg))) return;
    // Only treat it as stale if the runtime really is gone
    let gone = false; try { gone = !chrome.runtime || !chrome.runtime.id; } catch (_) { gone = true; }
    if (!gone && !/context invalidated/i.test(String(msg))) return;
    state.stale = true; render();
  }
  async function detectFramework() {
    if (state.pageFramework) return state.pageFramework;
    const r = await sendBg({ type: 'uxi:react', token: null });
    const d = r && r.ok && r.data && typeof r.data === 'object' ? r.data : {};
    state.pageFramework = { isReact: !!d.isReact, isNext: !!d.isNext, nextRouter: d.nextRouter === 'app' || d.nextRouter === 'pages' ? d.nextRouter : null, error: r && !r.ok ? r.error : null };
    return state.pageFramework;
  }
  function randToken() { const a = new Uint32Array(3); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(36)).join(''); }

  async function extractCode(el) {
    state.codeEl = el;
    state.codeResult = { loading: true };
    render();
    const fw = await detectFramework();
    let react = null;
    if (fw.isReact || fw.isNext) {
      const token = randToken().replace(/[^a-z0-9]/gi, '').slice(0, 30).padEnd(8, '0');
      el.setAttribute('data-uxi-target', token);
      try {
        const r = await sendBg({ type: 'uxi:react', token });
        if (r && r.ok && r.data && typeof r.data === 'object') react = r.data;
      } finally { el.removeAttribute('data-uxi-target'); }
    }
    if (state.codeEl !== el) return;
    const plain = plainCss(el, state.codeChildren);
    let gen = null;
    if (react && (react.isReact || react.isNext)) { try { gen = generateReact(el, react); } catch (e) { gen = null; } }
    state.codeResult = { plain, gen, react, fw };
    if (!gen) state.codeView = 'css';
    else if (!state.codeViewChosen) state.codeView = 'jsx';
    render();
  }

  views.code = (rootEl) => {
    const fw = state.pageFramework;
    const badge = !fw ? h('span', { class: 'pill' }, h('span', { class: 'spin' }), 'Detecting')
      : fw.isNext ? h('span', { class: 'pill accent', text: `Next.js${fw.nextRouter ? ' · ' + (fw.nextRouter === 'app' ? 'App' : 'Pages') + ' Router' : ''}` })
        : fw.isReact ? h('span', { class: 'pill accent', text: 'React' })
          : h('span', { class: 'pill', text: 'HTML / CSS' });
    if (!fw) detectFramework().then(() => { if (state.tab === 'code') render(); });

    const live = state.mode === 'code';
    const pickBtn = live
      ? btn('Cancel', { onClick: () => { setMode('none'); render(); } })
      : btn('Select element', { variant: 'primary', icon: 'target', onClick: () => { setMode('code'); render(); } });
    put(rootEl, h('div', { class: 'row' }, pickBtn, h('div', { class: 'grow' }), badge));
    if (live) put(rootEl, h('div', { class: 'note', style: 'margin-top:10px' }, icon('cursor', 14), h('span', { text: 'Click any element on the page to extract its code. Press Esc to cancel.' })));

    const el = state.codeEl;
    if (!el || !document.contains(el)) {
      put(rootEl, h('div', { class: 'card', style: 'margin-top:12px' }, empty('code', 'Select an element',
        fw && !fw.isReact && !fw.isNext
          ? 'This site isn’t built with React, so you’ll get clean CSS that matches the live markup.'
          : 'On React and Next.js sites you get a JSX component, a CSS module and its props. Everywhere else you get CSS.')));
      return;
    }
    const parentBtn = ibtn('up', 'Select parent', () => { if (el.parentElement && el.parentElement !== document.documentElement) { showSel(el.parentElement); extractCode(el.parentElement); } }, true);
    if (!el.parentElement || el.parentElement === document.documentElement || el.parentElement === document.body) parentBtn.classList.add('dis');
    const kids = miniToggle(state.codeChildren, 'Children', (v) => { state.codeChildren = v; extractCode(el); });
    const r = el.getBoundingClientRect();
    put(rootEl, h('div', { class: 'crumb', style: 'margin-top:12px' },
      h('div', { class: 'grow' }, h('div', { class: 'mono ell', title: label(el), text: label(el) }), h('div', { class: 't3 sm', text: `${Math.round(r.width)} × ${Math.round(r.height)}` })),
      ibtn('eye', 'Show on page', () => { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => placeBox(selOverlay, el), 350); }, true),
      parentBtn, kids));

    const res = state.codeResult;
    if (!res || res.loading) { put(rootEl, h('div', { class: 'row t3', style: 'padding:16px 2px' }, h('span', { class: 'spin' }), 'Extracting…')); return; }

    const tabs = [];
    if (res.gen) tabs.push(['jsx', `${res.gen.compName}.jsx`], ['module', 'CSS module'], ['css', 'Plain CSS'], ['js', 'Props']);
    else tabs.push(['css', 'CSS']);
    if (!tabs.some(([k]) => k === state.codeView)) state.codeView = tabs[0][0];
    const st = h('div', { class: 'subtabs', role: 'tablist' });
    for (const [k, n] of tabs) {
      const b = h('button', { class: state.codeView === k ? 'on' : '', role: 'tab', text: n });
      b.addEventListener('click', () => { state.codeView = k; state.codeViewChosen = true; render(); });
      put(st, b);
    }
    put(rootEl, st);

    let text = ''; let file = 'styles.css'; let note = ''; let lang = 'css'; let extra = null;
    if (state.codeView === 'jsx' && res.gen) {
      text = res.gen.jsx; file = `${res.gen.compName}.jsx`; lang = 'js';
      note = 'Rebuilt from the live React tree: real structure, text, props and styles. Event handler bodies are stubs.';
      extra = btn('Both', { size: 'sm', variant: 'ghost', icon: 'download', title: 'Download .jsx and .module.css', onClick: () => { downloadText(`${res.gen.compName}.jsx`, res.gen.jsx, 'text/javascript'); downloadText(`${res.gen.compName}.module.css`, res.gen.css, 'text/css'); } });
    } else if (state.codeView === 'module' && res.gen) {
      text = res.gen.css; file = `${res.gen.compName}.module.css`; note = `${res.gen.count} element(s). Computed styles with browser defaults removed.`;
    } else if (state.codeView === 'js' && res.gen) {
      const i = res.gen.info; lang = 'js';
      const lines = [`// Component: ${i.component}`];
      if (i.owners.length) lines.push(`// Rendered inside: ${i.owners.slice(0, 10).join(' ‹ ')}`);
      lines.push('', '// Event handlers in this subtree');
      if (!i.handlers.length) lines.push('//   none');
      for (const hd of i.handlers) lines.push(`//   <${hd.element}> ${hd.event} → ${hd.original}()`);
      lines.push('', '// Props passed to the nearest component');
      lines.push('const props = ' + JSON.stringify(i.ownerProps || {}, (k, v) => (v && typeof v === 'object' ? (v.__fn ? `[function ${v.__fn}]` : v.__arr !== undefined ? `[array(${v.__arr})]` : v.__obj ? '[object]' : v.__style ? v.__style : v) : v), 2) + ';');
      text = lines.join('\n') + '\n'; file = `${i.component}.props.js`; note = 'Live values read from React at runtime.';
    } else {
      text = res.plain.css; file = res.gen ? 'element.css' : 'styles.css';
      note = `${res.plain.count} element(s). Selectors match the live markup, so you can paste them straight into DevTools.`;
    }
    if (res.react && res.react.isReact && !res.react.rootManaged && res.gen) note += ' This node isn’t React-managed, so JSX was built from the DOM.';
    put(rootEl, codeViewer(text, file, lang, extra));
    put(rootEl, h('div', { class: 't3 sm', style: 'margin-top:8px;line-height:1.5', text: note }));
  };

  // ═════════ Images ═════════
  function ensureImages(force) {
    if ((state.images && !force) || state.imagesLoading) return state.images;
    state.imagesLoading = true;
    if (force) state.images = null;
    blobCache.clear();
    status('Finding images…', 'busy');
    collectImages().then((list) => { state.images = list; status(`Found ${list.length} assets`, 'ok'); },
      () => { state.images = []; status('Image scan failed', 'err'); })
      .finally(() => { state.imagesLoading = false; if (state.tab === 'images' && !state.help) render(); });
    return state.images;
  }
  const IMG_FILTERS = [['all', 'All'], ['img', 'Images'], ['bg', 'Backgrounds'], ['svg', 'SVG'], ['other', 'Icons']];
  function inFilter(it, f) {
    if (f === 'all') return true;
    if (f === 'svg') return isSvgItem(it);
    if (f === 'img') return it.kinds.has('img') && !isSvgItem(it);
    return it.kinds.has(f);
  }
  function thumbSrc(it) { return it.kind === 'svg' ? 'data:image/svg+xml;base64,' + utf8ToB64(it.svg) : it.url; }
  function dims(it) { const w = it.w || it.rw, hh = it.h || it.rh; return w && hh ? `${w}×${hh}` : '—'; }
  function kindLabel(it) { return it.kind === 'svg' ? 'Inline SVG' : it.kinds.has('img') ? 'Image element' : it.kinds.has('bg') ? 'CSS background' : 'Icon / meta'; }

  async function checkAllSites() {
    const r = await sendBg({ type: 'uxi:hasAllSites' });
    state.allSites = !!(r && r.ok && r.granted);
    return state.allSites;
  }

  views.images = (rootEl) => {
    const list = ensureImages();
    if (!list) {
      put(rootEl, h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'spin' }), h('b', { text: 'Finding images…' }), h('p', { text: 'Images, CSS backgrounds, inline SVG and icons.' }))));
      return;
    }
    if (state.imgDetail) { renderImageDetail(rootEl, state.imgDetail); return; }

    const counts = Object.fromEntries(IMG_FILTERS.map(([k]) => [k, list.filter((it) => inFilter(it, k)).length]));
    const shown = list.filter((it) => inFilter(it, state.imgFilter));
    put(rootEl, h('div', { class: 'row', style: 'margin-bottom:10px' },
      h('div', { class: 'grow' }, h('div', { style: 'font-weight:600', text: `${list.length} assets found` }), h('div', { class: 't3 sm', text: 'Images, CSS backgrounds, inline SVG, icons' })),
      btn('Rescan', { size: 'sm', icon: 'refresh', onClick: () => { ensureImages(true); render(); } })));
    put(rootEl, seg(IMG_FILTERS.filter(([k]) => k === 'all' || counts[k]).map(([k, n]) => [k, n, counts[k]]), state.imgFilter, (k) => { state.imgFilter = k; render(); }, true));

    if (!shown.length) { put(rootEl, h('div', { class: 'card', style: 'margin-top:12px' }, empty('image', 'No images here', 'This page has no images in this category. Try Rescan after the page finishes loading.'))); return; }

    // bulk bar
    const fmts = [['original', 'Original'], ['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['avif', 'AVIF']];
    const bulk = h('div', { class: 'card pad', style: 'margin-top:12px' },
      h('div', { style: 'margin-bottom:10px' }, h('div', { style: 'font-weight:600', text: `Download all ${shown.length}` }), h('div', { class: 't3 sm ell', text: `Saved to Downloads › Uxearly Inspect › ${siteFolder()}` })),
      seg(fmts, prefs.imgFormat, (k) => { prefs.imgFormat = k; savePrefs(); render(); }, true),
      h('div', { style: 'margin-top:8px' }, btn(state.imgBusy ? 'Working…' : `Download ${shown.length} as ${fmts.find(([k]) => k === prefs.imgFormat)[1]}`, { variant: 'primary', icon: 'download', block: true, disabled: state.imgBusy, onClick: () => bulkDownload(shown) })));
    put(rootEl, bulk);

    const grid = h('div', { class: 'thumbs', style: 'margin-top:12px' });
    for (const it of shown.slice(0, 300)) {
      const img = h('img', { alt: it.alt || '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer-when-downgrade' });
      img.addEventListener('error', () => { img.replaceWith(h('span', { class: 't3', style: 'display:grid;place-items:center' }, icon('image', 22))); }, { once: true });
      img.src = thumbSrc(it);
      const t = h('button', { class: 'thumb', title: `${kindLabel(it)} · ${dims(it)}${it.alt ? '\n' + it.alt : ''}` },
        h('div', { class: 'im' }, img, h('span', { class: 'ty', text: (it.type || '?').toUpperCase() })),
        h('div', { class: 'meta', text: dims(it) }));
      t.addEventListener('click', () => { state.imgDetail = it; render(); body.scrollTop = 0; });
      put(grid, t);
    }
    put(rootEl, grid);
    if (shown.length > 300) put(rootEl, h('div', { class: 't3 sm', style: 'margin-top:8px', text: `Showing 300 of ${shown.length}. Bulk download includes all.` }));
    put(rootEl, h('div', { class: 't3 sm', style: 'margin-top:12px;line-height:1.5', text: 'Only download images you have the rights to use.' }));
  };

  function renderImageDetail(rootEl, it) {
    put(rootEl, h('div', { class: 'row', style: 'margin-bottom:10px' },
      btn('All images', { size: 'sm', variant: 'ghost', icon: 'back', onClick: () => { state.imgDetail = null; render(); } }),
      h('div', { class: 'grow' }),
      it.el && document.contains(it.el) ? btn('Locate', { size: 'sm', icon: 'eye', onClick: () => { it.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => { placeBox(selOverlay, it.el, 'image'); setTimeout(() => { if (state.tab === 'images') selOverlay.style.display = 'none'; }, 1800); }, 400); } }) : null));
    const img = h('img', { alt: it.alt || '' });
    img.addEventListener('error', () => img.replaceWith(h('div', { class: 't3', style: 'text-align:center' }, icon('image', 28), h('div', { class: 'sm', text: 'Preview blocked by this site' }))), { once: true });
    img.src = thumbSrc(it);
    put(rootEl, h('div', { class: 'big' }, img));

    const kv = h('div', { class: 'kv', style: 'margin-top:12px' });
    const add = (k, v, cp) => { const vv = h('div', { class: 'v' + (cp ? ' copyable' : '') }, v); if (cp) vv.addEventListener('click', () => copy(cp, k.toLowerCase())); put(kv, h('div', { class: 'k', text: k }), vv); };
    const sizeEl = h('span', { class: 'mono t3', text: 'checking…' });
    const typeEl = h('span', { class: 'mono', text: (it.type || 'unknown').toUpperCase() });
    add('Format', typeEl);
    add('Intrinsic', h('span', { class: 'mono', text: it.w && it.h ? `${it.w} × ${it.h}px` : 'unknown' }));
    add('On page', h('span', { class: 'mono', text: it.rw && it.rh ? `${it.rw} × ${it.rh}px` : 'not rendered' }));
    add('File size', sizeEl);
    add('Source', kindLabel(it) + (it.count > 1 ? ` · used ${it.count}×` : ''));
    if (it.alt) add('Alt text', it.alt, it.alt);
    if (it.kind !== 'svg') add('URL', h('span', { class: 'mono t2 break', text: it.url.length > 160 ? it.url.slice(0, 157) + '…' : it.url }), it.url);
    put(rootEl, kv);

    const warn = h('div');
    put(rootEl, warn);
    // fetch bytes once to show real size/type (also warms the cache for downloads)
    getBlob(it).then((b) => {
      sizeEl.textContent = fmtBytes(b.size); sizeEl.className = 'mono';
      const t = MIME_EXT[b.type]; if (t) { typeEl.textContent = t.toUpperCase(); if (!it.type) it.type = t; }
    }).catch((e) => {
      sizeEl.textContent = 'restricted';
      if (e && e.code === 'BLOCKED') renderBlockedNote(warn);
    });

    const svg = isSvgItem(it);
    const q = Math.round(prefs.quality * 100);
    const formats = [
      ['original', 'Original', svg ? 'As served' : (it.type || 'file').toUpperCase()],
      ...(svg ? [['svg', 'SVG', 'Vector, clean']] : []),
      ['png', 'PNG', svg ? 'Lossless, @2×' : 'Lossless'], ['jpeg', 'JPG', `Quality ${q}`], ['webp', 'WebP', `Quality ${q}`], ['avif', 'AVIF', `Quality ${q}`]
    ].filter((f, i, a) => !(svg && it.kind === 'svg' && f[0] === 'original') && a.findIndex((x) => x[0] === f[0]) === i);
    const fg = h('div', { class: 'fmt' });
    for (const [k, n, d] of formats) {
      const b = h('button', { title: `Download as ${n}` }, h('b', null, n, icon('download', 13)), h('span', { text: d }));
      b.addEventListener('click', async () => {
        b.classList.add('busy');
        status(k === 'avif' ? 'Encoding AVIF…' : `Preparing ${n}…`, 'busy');
        try {
          const r = await downloadItem(it, k, prefs.quality);
          status(`Saved ${baseName(it)}.${r.ext}${r.size ? ' · ' + fmtBytes(r.size) : ''}`, 'ok');
        } catch (e) {
          status(errText(e), 'err');
          if (e && e.code === 'BLOCKED') renderBlockedNote(warn);
        } finally { b.classList.remove('busy'); }
      });
      put(fg, b);
    }
    const qIn = h('input', { type: 'range', min: '40', max: '100', step: '5', value: String(q), 'aria-label': 'Quality' });
    const qOut = h('span', { class: 'mono', style: 'width:28px;text-align:right', text: String(q) });
    qIn.addEventListener('input', () => { qOut.textContent = qIn.value; });
    qIn.addEventListener('change', () => { prefs.quality = Number(qIn.value) / 100; savePrefs(); render(); });
    put(rootEl, h('div', { class: 'section' }, section('Download as'), fg,
      h('div', { class: 'range', style: 'margin-top:10px' }, h('span', { class: 't3 sm', text: 'Quality' }), qIn, qOut)));

    const extra = h('div', { class: 'row', style: 'margin-top:10px;flex-wrap:wrap;gap:6px' },
      btn('Copy as PNG', { size: 'sm', icon: 'copy', onClick: async () => {
        status('Copying image…', 'busy');
        try {
          const blob = await convert(it, 'png', 1);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          status('Image copied to clipboard', 'ok');
        } catch (e) { status(e && e.code ? errText(e) : 'This page blocked image clipboard access', 'err'); }
      } }),
      it.kind !== 'svg' ? btn('Copy URL', { size: 'sm', icon: 'link', onClick: () => copy(it.url, 'image URL') }) : btn('Copy SVG code', { size: 'sm', icon: 'code', onClick: () => copy(it.svg, 'SVG markup') }));
    put(rootEl, extra);
  }

  function renderBlockedNote(container) {
    container.replaceChildren();
    const finish = (granted) => {
      container.replaceChildren(h('div', { class: 'note' + (granted ? '' : ' warn'), style: 'margin-top:12px' }, icon(granted ? 'alert' : 'lock', 14),
        h('div', { class: 'grow' },
          h('div', { text: granted ? 'The server refused this request. The Original button may still work.' : 'This image is on another site that blocks reading it, so it can’t be converted. Original download still works.' }),
          granted ? null : h('div', { style: 'margin-top:8px' }, btn('Allow image access on all sites…', { size: 'sm', onClick: () => sendBg({ type: 'uxi:openOptions' }) })))));
    };
    if (state.allSites === null) checkAllSites().then(finish); else finish(state.allSites);
  }

  async function bulkDownload(items) {
    if (state.imgBusy || !items.length) return;
    state.imgBusy = true; render();
    const fmt = prefs.imgFormat;
    let done = 0, ok = 0, fail = 0, blocked = 0;
    const used = new Set();
    const queue = items.slice();
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        let name = baseName(it); let n = 2;
        while (used.has(name)) name = `${baseName(it)}-${n++}`;
        used.add(name);
        try {
          // SVG targets fall back to the original file for raster items
          await downloadItem(it, fmt === 'original' ? 'original' : fmt, prefs.quality, { folder: true, name });
          ok++;
        } catch (e) { fail++; if (e && e.code === 'BLOCKED') blocked++; }
        done++;
        status(`Downloading ${done} of ${items.length}…`, 'busy', done / items.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    state.imgBusy = false;
    if (state.tab === 'images') render();
    status(`Saved ${ok} file(s)${fail ? ` · ${fail} failed${blocked ? ` (${blocked} blocked by their server)` : ''}` : ''}`, fail && !ok ? 'err' : 'ok');
  }

  // ═════════ Capture (screenshots) ═════════
  const MAX_SHOT_CSS = 40000;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Pages whose content scrolls inside a container (app shells) instead of the document
  function findScroller() {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 2) return null;
    let best = null; let bestArea = 0;
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (let i = 0; i < Math.min(all.length, MAX_SCAN); i++) {
      const el = all[i];
      if (el === host || el.clientHeight < 120 || el.scrollHeight <= el.clientHeight + 2) continue;
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) continue;
      const r = el.getBoundingClientRect();
      const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (a > bestArea) { bestArea = a; best = el; }
    }
    return bestArea >= innerWidth * innerHeight * 0.4 ? best : null;
  }
  function pageMetrics(area) {
    const scroller = area === 'full' ? findScroller() : null;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      return { scroller, x: r.left + scroller.clientLeft, y: r.top + scroller.clientTop, w: scroller.clientWidth, vh: scroller.clientHeight, full: scroller.scrollHeight };
    }
    const se = document.scrollingElement || document.documentElement;
    const w = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    return { scroller: null, x: 0, y: 0, w, vh, full: area === 'full' ? Math.max(se.scrollHeight, document.body ? document.body.scrollHeight : 0, vh) : vh };
  }
  function shotScale(res, cssW) {
    if (res === 'hd') return Math.min(2, Math.floor(16000 / cssW * 100) / 100);
    if (res === '4k') return Math.min(Math.min(4, Math.max(2, 3840 / cssW)), Math.floor(16000 / cssW * 100) / 100);
    return window.devicePixelRatio || 1;
  }
  // Fixed and sticky layers (headers, chat widgets, cookie bars) appear once, in the first frame only.
  function hideFloating(scope) {
    const changed = [];
    const vpArea = innerWidth * innerHeight;
    const all = (scope || document.body || document.documentElement).getElementsByTagName('*');
    for (let i = 0; i < Math.min(all.length, MAX_SCAN); i++) {
      const el = all[i];
      if (el === host) continue;
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (pos === 'fixed' && r.width * r.height >= vpArea * 0.8) continue; // full-screen backgrounds stay
      changed.push([el, el.style.getPropertyValue('opacity'), el.style.getPropertyPriority('opacity')]);
      el.style.setProperty('opacity', '0', 'important');
    }
    return () => { for (const [el, v, pr] of changed) { if (v) el.style.setProperty('opacity', v, pr); else el.style.removeProperty('opacity'); } };
  }
  function lockStyle(el, prop, value) {
    const v = el.style.getPropertyValue(prop), pr = el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, value, 'important');
    return () => { if (v) el.style.setProperty(prop, v, pr); else el.style.removeProperty(prop); };
  }
  function stamp() { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`; }

  async function runCapture() {
    if (state.shot && state.shot.busy) return;
    const o = prefs.shot;
    state.shot = { busy: true, result: null, error: null };
    state.shotAbort = false;
    setMode('none'); render();
    const restore = [];
    const startX = window.scrollX, startY = window.scrollY;
    let m = null; let startInner = 0; let began = false; let finalMsg = null;
    try {
      status(o.res === 'screen' ? 'Capturing…' : 'Starting high-resolution capture…', 'busy');
      const b = await sendBg({ type: 'uxi:shot-begin', res: o.res });
      if (!b || !b.ok) throw new ImgError((b && b.code) || 'SHOT', b && b.error);
      began = true;
      restore.push(lockStyle(host, 'visibility', 'hidden'));
      restore.push(lockStyle(document.documentElement, 'scroll-behavior', 'auto'));
      await nextFrame(); await nextFrame();
      m = pageMetrics(o.area);
      if (m.scroller) { startInner = m.scroller.scrollTop; restore.push(lockStyle(m.scroller, 'scroll-behavior', 'auto')); }
      const full = o.area === 'full';
      const cssH = Math.min(m.full, MAX_SHOT_CSS);
      const setup = await sendBg({ type: 'uxi:shot-setup', format: o.format, quality: 0.92, cssW: m.w, cssH: full ? cssH : m.vh, site: siteFolder(), base: `${siteFolder()}-${full ? 'full' : 'view'}-${stamp()}` });
      if (!setup || !setup.ok) throw new ImgError('SHOT', setup && setup.error);
      const ys = [];
      if (full) {
        for (let y = 0; y < cssH; y += m.vh) { const yy = Math.min(y, Math.max(0, cssH - m.vh)); if (!ys.includes(yy)) ys.push(yy); }
      } else ys.push(null);
      for (let i = 0; i < ys.length; i++) {
        if (state.shotAbort) throw new ImgError('ABORT');
        if (full) {
          if (m.scroller) m.scroller.scrollTop = ys[i]; else window.scrollTo({ top: ys[i], left: 0, behavior: 'instant' });
          await nextFrame(); await nextFrame(); await wait(160); // let lazy images and scroll effects settle
        }
        const actual = full ? (m.scroller ? m.scroller.scrollTop : window.scrollY) : 0;
        const vis = full ? Math.max(1, Math.min(m.vh, cssH - actual)) : m.vh;
        const r = await sendBg({ type: 'uxi:shot-frame', destY: actual, index: i, total: ys.length,
          crop: { x: m.x, y: m.y, w: m.w, h: vis, scrollX: window.scrollX, scrollY: window.scrollY, innerWidth: window.innerWidth } });
        if (!r || !r.ok) throw new ImgError('SHOT', r && r.error);
        if (i === 0 && full) restore.push(hideFloating(m.scroller));
      }
      status('Saving…', 'busy');
      const fin = await sendBg({ type: 'uxi:shot-finish' });
      began = false;
      if (!fin || !fin.ok) throw new ImgError('SHOT', fin && fin.error);
      state.shot.result = { ...fin, capped: full && m.full > MAX_SHOT_CSS, cssW: m.w, cssH: full ? cssH : m.vh };
      const n = fin.files.length;
      finalMsg = [n === 1 ? `Saved ${fin.files[0].name}` : `Saved ${n} files`, 'ok'];
    } catch (e) {
      if (began) await sendBg({ type: 'uxi:shot-abort' });
      state.shot.error = e;
      finalMsg = [e && e.code === 'ABORT' ? 'Capture cancelled' : shotErrText(e), e && e.code === 'ABORT' ? null : 'err'];
    } finally {
      // restore the page exactly as it was before reporting the result
      for (const f of restore.reverse()) { try { f(); } catch (_) { /* element gone */ } }
      if (m && m.scroller) m.scroller.scrollTop = startInner;
      window.scrollTo({ top: startY, left: startX, behavior: 'instant' });
      state.shot.busy = false;
      if (state.tab === 'capture') render();
      if (finalMsg) status(finalMsg[0], finalMsg[1]);
    }
  }
  function shotErrText(e) {
    const c = e && e.code;
    if (c === 'NEED_DEBUGGER') return 'Turn on high-resolution capture in Settings first.';
    if (c === 'ATTACH') return /attached/i.test(e.message || '') ? 'Close DevTools on this tab, then try again.' : 'Chrome couldn’t start high-resolution capture on this page.';
    return (e && e.message && e.message !== 'SHOT') ? e.message : 'Capture failed. Reload the page and try again.';
  }

  views.capture = (rootEl) => {
    const o = prefs.shot;
    if (state.dbgGranted === null || state.dbgGranted === undefined) {
      state.dbgGranted = false;
      sendBg({ type: 'uxi:hasDebugger' }).then((r) => { const g = !!(r && r.ok && r.granted); if (g !== state.dbgGranted) { state.dbgGranted = g; if (state.tab === 'capture') render(); } else state.dbgGranted = g; });
    }
    const busy = state.shot && state.shot.busy;
    const m = pageMetrics(o.area);
    const cssH = o.area === 'full' ? Math.min(m.full, MAX_SHOT_CSS) : m.vh;
    const scale = shotScale(o.res, m.w);
    const outW = Math.round(m.w * scale), outH = Math.round(cssH * scale);
    const partPx = o.format === 'pdf' ? Math.min(16384, Math.round(14000 / 0.75 * scale)) : 16384;
    const parts = Math.max(1, Math.ceil(outH / partPx));
    const dpr = window.devicePixelRatio || 1;
    const set = (k) => (v) => { prefs.shot = { ...prefs.shot, [k]: v }; savePrefs(); render(); };
    const field = (label, control) => h('div', { class: 'field' }, h('span', { text: label }), control);

    put(rootEl, h('div', { class: 'card pad' },
      field('Area', seg([['full', 'Full page'], ['visible', 'Visible area']], o.area, set('area'), true)),
      field('Quality', seg([['screen', `Screen ${round(dpr, 2)}×`], ['hd', 'HD 2×'], ['4k', '4K']], o.res, set('res'), true)),
      field('Format', seg([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['pdf', 'PDF']], o.format, set('format'), true))));

    const kv = h('div', { class: 'kv' });
    const row = (k, v) => put(kv, h('div', { class: 'k', text: k }), h('div', { class: 'v' }, v));
    row('Page', h('span', { class: 'mono', text: `${m.w.toLocaleString()} × ${cssH.toLocaleString()} px` }));
    row('Output', h('span', { class: 'mono', text: `${outW.toLocaleString()} × ${outH.toLocaleString()} px` }));
    row('Files', o.format === 'pdf' ? `1 PDF · ${parts} page${parts > 1 ? 's' : ''}` : parts > 1 ? `${parts} images (long page, split to keep full quality)` : '1 image');
    if (m.scroller) row('Scrolls in', h('span', { class: 'mono t2', text: label(m.scroller) }));
    put(rootEl, h('div', { class: 'section' }, section('Summary'), kv));
    if (o.area === 'full' && m.full > MAX_SHOT_CSS) put(rootEl, h('div', { class: 'note warn', style: 'margin-top:10px' }, icon('alert', 14), h('span', { text: `This page is very long. The first ${MAX_SHOT_CSS.toLocaleString()} px will be captured.` })));

    const needPerm = o.res !== 'screen' && !state.dbgGranted;
    if (needPerm) {
      put(rootEl, h('div', { class: 'note', style: 'margin-top:12px' }, icon('lock', 14), h('div', { class: 'grow' },
        h('div', { text: 'HD and 4K re-render the page at a higher resolution using Chrome’s debugging interface. Turn it on once in Settings.' }),
        h('div', { style: 'margin-top:8px' }, btn('Open Settings', { size: 'sm', onClick: () => sendBg({ type: 'uxi:openOptions', section: 'capture' }) })))));
    } else if (o.res !== 'screen') {
      put(rootEl, h('div', { class: 't3 sm', style: 'margin-top:10px', text: 'Chrome shows a “started debugging this browser” bar while a high-resolution capture runs. It closes on its own.' }));
    }
    put(rootEl, h('div', { style: 'margin-top:14px' }, btn(busy ? 'Capturing…' : o.area === 'full' ? 'Capture full page' : 'Capture visible area',
      { variant: 'primary', icon: 'camera', block: true, disabled: busy || needPerm, onClick: () => runCapture() })));
    put(rootEl, h('div', { class: 't3 sm', style: 'margin-top:8px;text-align:center', text: 'The panel hides while capturing. Progress shows on the toolbar icon. Press Esc to cancel.' }));

    const res = state.shot && state.shot.result;
    if (res && !busy) {
      const sec = h('div', { class: 'section' });
      put(sec, section('Last capture', null, btn('Show in folder', { size: 'sm', variant: 'ghost', icon: 'folder', onClick: () => sendBg({ type: 'uxi:showDownload', id: res.files[0] && res.files[0].id }) })));
      if (res.preview) put(sec, h('div', { class: 'shot' }, h('img', { alt: 'Screenshot preview', src: 'data:image/jpeg;base64,' + res.preview })));
      const fl = h('div', { style: 'margin-top:8px' });
      for (const f of res.files) {
        put(fl, h('div', { class: 'file-row' }, h('span', { class: 't2' }, icon(f.pages ? 'file' : 'image', 15)),
          h('div', { class: 'grow' }, h('div', { class: 'ell', text: f.name }), h('div', { class: 't3 sm mono', text: `${f.w.toLocaleString()} × ${f.h.toLocaleString()} px${f.pages ? ` · ${f.pages} pages` : ''}` })),
          h('span', { class: 'mono t2 sm nowrap', text: fmtBytes(f.size) })));
      }
      put(sec, fl);
      put(rootEl, sec);
    }
  };

  // ═════════ Measure ═════════
  const mfmt = (v) => {
    const n = Math.abs(v) < 0.05 ? 0 : v;
    if (state.mPrefs.unit === 'rem') return `${round(n / rootFontPx(), 3)}rem`;
    const r = Math.round(n * 10) / 10;
    return (Number.isInteger(r) ? String(r) : r.toFixed(1));
  };
  const mAdd = (cls, x, y, w, hh, text) => {
    const d = h('div', { class: cls, text: text || null });
    d.style.left = x + 'px'; d.style.top = y + 'px';
    if (w !== null && w !== undefined) d.style.width = Math.max(0, w) + 'px';
    if (hh !== null && hh !== undefined) d.style.height = Math.max(0, hh) + 'px';
    mLayer.appendChild(d);
    return d;
  };
  // Labels are clamped so they never run off the edge of the viewport
  const mLabel = (x, y, text, kind) => {
    const d = mAdd('mlabel' + (kind ? ' ' + kind : ''), x, y, null, null, text);
    const r = d.getBoundingClientRect();
    if (r.left < 4) d.style.left = (x + 4 - r.left) + 'px';
    else if (r.right > window.innerWidth - 4) d.style.left = (x - (r.right - window.innerWidth + 4)) + 'px';
    if (r.top < 4) d.style.top = (y + 4 - r.top) + 'px';
    else if (r.bottom > window.innerHeight - 4) d.style.top = (y - (r.bottom - window.innerHeight + 4)) + 'px';
    return d;
  };
  function vLine(x, y1, y2, label) { if (Math.abs(y2 - y1) < 0.5) return; const top = Math.min(y1, y2); mAdd('mline v', x, top, null, Math.abs(y2 - y1)); if (label) mLabel(x, top + Math.abs(y2 - y1) / 2, mfmt(Math.abs(y2 - y1))); }
  function hLine(y, x1, x2, label) { if (Math.abs(x2 - x1) < 0.5) return; const left = Math.min(x1, x2); mAdd('mline h', left, y, Math.abs(x2 - x1), null); if (label) mLabel(left + Math.abs(x2 - x1) / 2, y, mfmt(Math.abs(x2 - x1))); }
  function boxLabel(r, text, kind) {
    const below = r.top < 26;
    const lab = mLabel(r.left + r.width / 2, below ? r.bottom + 4 : r.top - 22, text, kind || 'box');
    return lab;
  }
  function edges(el, cs, prop) {
    const g = (k) => px(cs[prop + k]) || 0;
    return { t: g('Top'), r: g('Right'), b: g('Bottom'), l: g('Left') };
  }
  function drawSpacing(el, r) {
    const cs = getComputedStyle(el);
    const p = edges(el, cs, 'padding'), b = { t: px(cs.borderTopWidth) || 0, r: px(cs.borderRightWidth) || 0, b: px(cs.borderBottomWidth) || 0, l: px(cs.borderLeftWidth) || 0 };
    const m = edges(el, cs, 'margin');
    const ix = r.left + b.l, iy = r.top + b.t, iw = r.width - b.l - b.r, ih = r.height - b.t - b.b;
    if (p.t) mAdd('mpad', ix, iy, iw, p.t); if (p.b) mAdd('mpad', ix, iy + ih - p.b, iw, p.b);
    if (p.l) mAdd('mpad', ix, iy + p.t, p.l, ih - p.t - p.b); if (p.r) mAdd('mpad', ix + iw - p.r, iy + p.t, p.r, ih - p.t - p.b);
    if (m.t > 0) mAdd('mmar', r.left, r.top - m.t, r.width, m.t); if (m.b > 0) mAdd('mmar', r.left, r.bottom, r.width, m.b);
    if (m.l > 0) mAdd('mmar', r.left - m.l, r.top - Math.max(0, m.t), m.l, r.height + Math.max(0, m.t) + Math.max(0, m.b));
    if (m.r > 0) mAdd('mmar', r.right, r.top - Math.max(0, m.t), m.r, r.height + Math.max(0, m.t) + Math.max(0, m.b));
    // gaps between children of flex / grid containers
    const gaps = [];
    if (/flex|grid/.test(cs.display)) {
      const kids = Array.from(el.children).filter((k) => k !== host && isVisible(k)).slice(0, 60).map((k) => k.getBoundingClientRect()).filter((k) => k.width && k.height);
      for (let i = 0; i + 1 < kids.length; i++) {
        const a = kids[i], c = kids[i + 1];
        const vOverlap = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        const hOverlap = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        if (vOverlap > 0 && c.left - a.right >= 0.5) { const g = c.left - a.right; mAdd('mgap', a.right, Math.max(a.top, c.top), g, vOverlap); if (g >= 2) mLabel(a.right + g / 2, Math.max(a.top, c.top) + vOverlap / 2, mfmt(g), 'gap'); gaps.push(g); }
        else if (hOverlap > 0 && c.top - a.bottom >= 0.5) { const g = c.top - a.bottom; mAdd('mgap', Math.max(a.left, c.left), a.bottom, hOverlap, g); if (g >= 2) mLabel(Math.max(a.left, c.left) + hOverlap / 2, a.bottom + g / 2, mfmt(g), 'gap'); gaps.push(g); }
      }
    }
    return { p, m, b, gaps };
  }
  // Distances between a pinned element A and the hovered element B (Figma-style redlines)
  function drawDistances(a, b) {
    const out = [];
    const inside = (o, i) => i.left >= o.left - 0.5 && i.right <= o.right + 0.5 && i.top >= o.top - 0.5 && i.bottom <= o.bottom + 0.5;
    if (inside(a, b) || inside(b, a)) {
      const o = inside(a, b) ? a : b, i = o === a ? b : a;
      const cx = i.left + i.width / 2, cy = i.top + i.height / 2;
      vLine(cx, o.top, i.top, true); vLine(cx, i.bottom, o.bottom, true); hLine(cy, o.left, i.left, true); hLine(cy, i.right, o.right, true);
      out.push(['Top', i.top - o.top], ['Right', o.right - i.right], ['Bottom', o.bottom - i.bottom], ['Left', i.left - o.left]);
      return out;
    }
    // horizontal gap
    if (b.left >= a.right || b.right <= a.left) {
      const x1 = b.left >= a.right ? a.right : b.right, x2 = b.left >= a.right ? b.left : a.left;
      const top = Math.max(a.top, b.top), bot = Math.min(a.bottom, b.bottom);
      const y = bot > top ? (top + bot) / 2 : b.top + b.height / 2;
      if (bot <= top) { const ay = a.top + a.height / 2; const gx = b.left >= a.right ? a.right : a.left; mAdd('mguide', gx, Math.min(ay, y), null, Math.abs(y - ay)); }
      hLine(y, x1, x2, true); out.push(['Horizontal', x2 - x1]);
    }
    if (b.top >= a.bottom || b.bottom <= a.top) {
      const y1 = b.top >= a.bottom ? a.bottom : b.bottom, y2 = b.top >= a.bottom ? b.top : a.top;
      const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
      const x = right > left ? (left + right) / 2 : b.left + b.width / 2;
      if (right <= left) { const ax = a.left + a.width / 2; const gy = b.top >= a.bottom ? a.bottom : a.top; mAdd('mguide h', Math.min(ax, x), gy, Math.abs(x - ax), null); }
      vLine(x, y1, y2, true); out.push(['Vertical', y2 - y1]);
    }
    if (!out.length) { // overlapping: offsets of each edge
      vLine(b.left + b.width / 2, a.top, b.top, true); hLine(b.top + b.height / 2, a.left, b.left, true);
      out.push(['Top offset', b.top - a.top], ['Left offset', b.left - a.left]);
    }
    return out;
  }
  // Ink bounds of a glyph (the visible shape, not its advance box), from canvas text metrics
  const inkCtx = document.createElement('canvas').getContext('2d');
  function inkBox(ch, el, r) {
    const cs = getComputedStyle(el);
    inkCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = inkCtx.measureText(ch);
    const asc = m.fontBoundingBoxAscent || 0, desc = m.fontBoundingBoxDescent || 0;
    const baseline = r.top + asc + (r.height - asc - desc) / 2;
    const left = r.left - (m.actualBoundingBoxLeft || 0), right = r.left + (m.actualBoundingBoxRight || 0);
    const top = baseline - (m.actualBoundingBoxAscent || 0), bottom = baseline + (m.actualBoundingBoxDescent || 0);
    return { left, right, top, bottom, width: right - left, height: bottom - top, advance: r.width };
  }
  // The character under the pointer, its neighbour and the visible gap between them
  function letterAt(x, y) {
    if (!document.caretRangeFromPoint) return null;
    const cr = document.caretRangeFromPoint(x, y);
    if (!cr || cr.startContainer.nodeType !== 3) return null;
    const node = cr.startContainer, text = node.nodeValue || '';
    const rectOf = (i) => { if (i < 0 || i >= text.length) return null; const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const rs = r.getClientRects(); return rs.length ? rs[0] : null; };
    for (const i of [cr.startOffset, cr.startOffset - 1]) {
      const r = rectOf(i);
      if (!r || x < r.left - 0.5 || x > r.right + 0.5 || y < r.top - 0.5 || y > r.bottom + 0.5 || !text[i].trim()) continue;
      const j = i + 1; const nr = rectOf(j);
      const sameLine = nr && Math.abs(nr.top - r.top) < r.height / 2;
      const el = node.parentElement;
      const ink = inkBox(text[i], el, r);
      let next = null;
      if (sameLine) {
        // skip spaces so the gap is measured to the next visible letter (a word gap)
        let k = j; while (k < text.length && !text[k].trim()) k++;
        const kr = k < text.length ? rectOf(k) : null;
        if (kr && Math.abs(kr.top - r.top) < r.height / 2) next = { ch: text[k], r: kr, ink: inkBox(text[k], el, kr), word: k > j };
      }
      return { ch: text[i], r, ink, next, el };
    }
    return null;
  }
  let mRaf = 0;
  function scheduleMeasure() { if (!mRaf) mRaf = requestAnimationFrame(() => { mRaf = 0; drawMeasure(); }); }
  function drawMeasure() {
    mLayer.replaceChildren();
    const M = state.measure;
    const info = { el: null, size: null, spacing: null, dist: null, letter: null, ruler: null };
    if (state.mode !== 'measure') { updateMeasureReadout(info); return; }
    const anchorOk = M.anchor && document.contains(M.anchor);
    const ar = anchorOk ? M.anchor.getBoundingClientRect() : null;
    if (ar) { mAdd('mbox pin', ar.left, ar.top, ar.width, ar.height); }
    const el = state.hoverEl && document.contains(state.hoverEl) ? state.hoverEl : null;
    if (el && !M.drag) {
      const r = el.getBoundingClientRect();
      info.el = el; info.size = [r.width, r.height];
      if (state.mPrefs.spacing) info.spacing = drawSpacing(el, r);
      mAdd('mbox', r.left, r.top, r.width, r.height);
      boxLabel(r, `${mfmt(r.width)} × ${mfmt(r.height)}`);
      if (ar && el !== M.anchor) info.dist = drawDistances(ar, r);
      if (state.mPrefs.letters && M.point) {
        const L = letterAt(M.point.x, M.point.y);
        if (L) {
          info.letter = L;
          const a = L.ink;
          mAdd('mbox letter', a.left, a.top, a.width, a.height);
          let gapTxt = '';
          if (L.next) {
            const b = L.next.ink;
            mAdd('mbox next', b.left, b.top, b.width, b.height);
            const g = b.left - a.right;
            const y = Math.max(a.bottom, b.bottom) + 5;
            if (Math.abs(g) >= 0.05) hLine(y, a.right, b.left, false);
            gapTxt = `  gap ${mfmt(g)}`;
          }
          mLabel(a.left + a.width / 2, Math.max(a.bottom, L.next ? L.next.ink.bottom : a.bottom) + 12, `${mfmt(a.width)} × ${mfmt(a.height)}${gapTxt}`, 'letter');
        }
      }
    }
    if (M.ruler) {
      const p0 = { x: M.ruler.x0 - window.scrollX, y: M.ruler.y0 - window.scrollY }, p1 = { x: M.ruler.x1 - window.scrollX, y: M.ruler.y1 - window.scrollY };
      const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
      const line = mAdd('mruler', p0.x, p0.y, len, null); line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      mAdd('mdot', p0.x, p0.y); mAdd('mdot', p1.x, p1.y);
      mLabel(p0.x + dx / 2, p0.y + dy / 2 - 12, `${mfmt(len)}  (${mfmt(Math.abs(dx))} × ${mfmt(Math.abs(dy))})`);
      info.ruler = { len, dx, dy };
    }
    updateMeasureReadout(info);
  }
  let mReadEl = null;
  function updateMeasureReadout(info) {
    if (!mReadEl || !document.contains(host)) return;
    mReadEl.replaceChildren();
    const row = (k, v) => put(mReadEl, h('div', { class: 'k', text: k }), h('div', { class: 'v' }, v));
    const unit = state.mPrefs.unit === 'px' ? ' px' : '';
    if (info.ruler) { row('Ruler', mfmt(info.ruler.len) + unit); row('Δx / Δy', `${mfmt(Math.abs(info.ruler.dx))} / ${mfmt(Math.abs(info.ruler.dy))}`); }
    if (info.el) {
      row('Element', h('span', { class: 'ell', text: label(info.el) }));
      row('Size', `${mfmt(info.size[0])} × ${mfmt(info.size[1])}${unit}`);
      if (info.spacing) {
        const q = (o) => [o.t, o.r, o.b, o.l].map(mfmt).join(' ');
        row('Padding', q(info.spacing.p));
        row('Margin', q(info.spacing.m));
        if (info.spacing.gaps.length) row('Gap', [...new Set(info.spacing.gaps.map(mfmt))].join(', '));
      }
    }
    if (info.dist) for (const [k, v] of info.dist) row(k, mfmt(Math.abs(v)) + unit);
    if (info.letter) {
      const L = info.letter; const cs = getComputedStyle(L.el);
      row('Letter', h('span', null, `“${L.ch}”  ink ${mfmt(L.ink.width)} × ${mfmt(L.ink.height)}${unit}`));
      row('Advance', mfmt(L.ink.advance) + unit);
      if (L.next) row(`Gap to “${L.next.ch}”`, mfmt(L.next.ink.left - L.ink.right) + unit + (L.next.word ? '  (word gap)' : ''));
      row('Font', `${mfmt(px(cs.fontSize))}${unit} · ${cs.fontWeight} · tracking ${cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing}`);
    }
    if (!mReadEl.childNodes.length) put(mReadEl, h('div', { class: 'k', style: 'grid-column:1/-1;border:0', text: state.mode === 'measure' ? 'Move over the page to measure.' : 'Turn on measuring to start.' }));
  }
  function measurePointer(e) {
    const M = state.measure;
    if (e.type === 'pointerdown' && e.button === 0) {
      M.drag = { x0: e.clientX + window.scrollX, y0: e.clientY + window.scrollY, moved: false, target: e.target };
    } else if (e.type === 'pointerup' && M.drag) {
      const d = M.drag; M.drag = null;
      if (!d.moved) {
        const t = d.target instanceof Element && d.target !== document.documentElement && d.target !== document.body ? d.target : null;
        M.ruler = null;
        M.anchor = t && t !== M.anchor ? t : null;
        status(M.anchor ? `Pinned ${label(M.anchor)}. Hover another element for distances.` : 'Pin cleared', 'ok');
      }
      scheduleMeasure();
    }
  }
  function measureMove(e) {
    const M = state.measure;
    M.point = { x: e.clientX, y: e.clientY };
    if (M.drag) {
      const x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
      if (!M.drag.moved && Math.hypot(x - M.drag.x0, y - M.drag.y0) > 4) M.drag.moved = true;
      if (M.drag.moved) M.ruler = { x0: M.drag.x0, y0: M.drag.y0, x1: x, y1: y };
    }
    scheduleMeasure();
  }

  views.measure = (rootEl) => {
    const live = state.mode === 'measure';
    put(rootEl, h('div', { class: 'card' },
      toggle(live, 'Measure on hover', live ? 'Hover to measure. Click to pin an element, drag for a ruler.' : 'Turn on to measure the page.', (v) => { setMode(v ? 'measure' : 'none'); render(); }),
      toggle(state.mPrefs.spacing, 'Padding, margin and gaps', 'Shaded green, orange and pink on the hovered element.', (v) => { state.mPrefs.spacing = v; render(); scheduleMeasure(); }),
      toggle(state.mPrefs.letters, 'Letters', 'Size of the letter under the cursor and the gap to the next one.', (v) => { state.mPrefs.letters = v; render(); scheduleMeasure(); })));
    put(rootEl, h('div', { class: 'section' }, section('Readout', null, seg([['px', 'px'], ['rem', 'rem']], state.mPrefs.unit, (k) => { state.mPrefs.unit = k; render(); scheduleMeasure(); })),
      (mReadEl = h('div', { class: 'mread' }))));
    put(rootEl, h('div', { class: 'legend' },
      h('span', null, h('i', { style: 'border:1.5px solid var(--accent)' }), 'Element'), h('span', null, h('i', { style: 'border:1.5px solid #f2385a' }), 'Pinned'),
      h('span', null, h('i', { style: 'background:rgba(52,199,120,.45)' }), 'Padding'), h('span', null, h('i', { style: 'background:rgba(255,159,10,.45)' }), 'Margin'),
      h('span', null, h('i', { style: 'background:rgba(236,72,153,.5)' }), 'Gap'), h('span', null, h('i', { style: 'border:1.5px solid #9b5cf6' }), 'Letter')));
    const actions = h('div', { class: 'row', style: 'margin-top:12px;gap:6px' });
    if (state.measure.anchor || state.measure.ruler) put(actions, btn('Clear pin and ruler', { size: 'sm', icon: 'close', onClick: () => { state.measure.anchor = null; state.measure.ruler = null; render(); scheduleMeasure(); } }));
    put(actions, h('span', { class: 't3 sm grow', style: 'text-align:right', text: 'Esc clears, then stops' }));
    put(rootEl, actions);
    scheduleMeasure();
  };

  // ═════════ Selected text (right-click menu) ═════════
  const selDialog = h('div', { class: 'seldlg', role: 'dialog', 'aria-label': 'Font of selected text' });
  selDialog.addEventListener('wheel', onPanelWheel, { passive: false });
  function closeSelDialog() { selDialog.remove(); }
  function selectionInfo() {
    let text = '', rect = null; const parts = [];
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && typeof ae.selectionStart === 'number' && ae.selectionStart !== ae.selectionEnd) {
      text = ae.value.slice(ae.selectionStart, ae.selectionEnd);
      rect = ae.getBoundingClientRect();
      parts.push({ el: ae, text });
    } else {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      text = sel.toString();
      const rs = range.getClientRects();
      rect = rs.length ? rs[rs.length - 1] : range.getBoundingClientRect();
      const top = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
      if (range.commonAncestorContainer.nodeType === 3) parts.push({ el: top, text });
      else {
        const tw = document.createTreeWalker(top, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() && range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
        let n; let c = 0;
        while ((n = tw.nextNode()) && c++ < 500) {
          const from = n === range.startContainer ? range.startOffset : 0;
          const to = n === range.endContainer ? range.endOffset : n.nodeValue.length;
          const t = n.nodeValue.slice(from, to);
          if (t.trim() && n.parentElement && !host.contains(n.parentElement)) parts.push({ el: n.parentElement, text: t });
        }
        if (!parts.length && top.nodeType === 1) parts.push({ el: top, text });
      }
    }
    if (!text.trim() || !parts.length) return null;
    const groups = new Map();
    for (const p of parts) {
      const i = fontInfo(p.el);
      const key = [i.stack, i.size, i.weight, i.style, i.lineHeight, i.letterSpacing, i.color ? toHex(i.color) : ''].join('|');
      const g = groups.get(key) || { info: i, el: p.el, text: '' };
      g.text += p.text; groups.set(key, g);
    }
    return { text, rect, groups: [...groups.values()].sort((a, b) => b.text.length - a.text.length) };
  }
  function showSelection() {
    const sel = selectionInfo();
    if (!sel) { status('Select some text on the page first', 'err'); return; }
    closeSelDialog();
    selDialog.replaceChildren();
    const main = sel.groups[0];
    const clean = sel.text.replace(/\s+/g, ' ').trim();
    put(selDialog, h('div', { class: 'sh2' }, brandGlyph(), h('b', { text: sel.groups.length > 1 ? `Selected text · ${sel.groups.length} styles` : 'Selected text' }), ibtn('close', 'Close', closeSelDialog, true)));
    const styleSample = (el, i) => { el.style.fontFamily = i.stack; el.style.fontWeight = String(i.weight); el.style.fontStyle = i.style; el.style.letterSpacing = i.letterSpacing; if (i.color) el.style.color = toRgb(i.color); el.style.background = toRgb(i.bg); };
    const glyphs = [...clean.replace(/\s/g, '')];
    if (glyphs.length <= 2) { const sp = h('div', { class: 'specimen', text: glyphs.join('') }); styleSample(sp, main.info); put(selDialog, sp); }
    else { const q = h('div', { class: 'quote', text: clean.slice(0, 220) }); styleSample(q, main.info); put(selDialog, q); }
    for (const g of sel.groups.slice(0, 4)) {
      const i = g.info;
      const tile = (l, v, sub, val) => { const t = h('div', { class: 'tile', title: 'Copy' }, h('div', { class: 'l', text: l }), h('div', { class: 'v', text: v }), h('div', { class: 's', text: sub || ' ' })); t.addEventListener('click', () => copy(val || v, l.toLowerCase())); return t; };
      const famEl = h('b', { text: i.family || i.rendered }); famEl.style.fontFamily = i.stack;
      put(selDialog, h('div', { class: 'grp' },
        h('div', { class: 'fam' }, famEl, i.rendered !== i.family ? h('span', { class: 'pill warn', title: `Renders as ${i.rendered}`, text: 'Fallback' }) : null,
          i.color ? h('span', { class: 'row', style: 'gap:5px' }, swatch(i.color), h('span', { class: 'mono t2', text: toHex(i.color) })) : null),
        h('div', { class: 'tiles' },
          tile('Size', `${round(i.size, 1)}px`, `${i.sizeRem}rem`),
          tile('Weight', String(i.weight), i.weightName),
          tile('Line', i.lhPx ? `${round(i.lhPx, 1)}px` : 'normal', i.lhRatio ? `${i.lhRatio}` : 'auto'),
          tile('Tracking', i.letterSpacing === 'normal' ? '0' : i.letterSpacing, i.style !== 'normal' ? i.style : ' ', i.letterSpacing)),
        sel.groups.length > 1 ? h('div', { class: 't3 sm ell', style: 'margin-top:6px', text: '“' + g.text.replace(/\s+/g, ' ').trim().slice(0, 80) + '”' }) : null,
        h('div', { class: 'mono t3 sm break', style: 'margin-top:6px', text: i.stack })));
    }
    const cssFor = (g) => cssBlock(rootSelector(g.el), [['font-family', g.info.stack], ['font-size', `${round(g.info.size, 2)}px`], ['font-weight', String(g.info.weight)], ['line-height', g.info.lineHeight],
      ...(g.info.letterSpacing !== 'normal' ? [['letter-spacing', g.info.letterSpacing]] : []), ...(g.info.style !== 'normal' ? [['font-style', g.info.style]] : []), ...(g.info.color ? [['color', toHex(g.info.color)]] : [])]);
    put(selDialog, h('div', { class: 'acts' },
      btn('Copy CSS', { size: 'sm', icon: 'copy', onClick: () => copy(sel.groups.slice(0, 4).map(cssFor).join('\n'), 'font CSS') }),
      btn('Open in panel', { size: 'sm', icon: 'font', onClick: () => {
        closeSelDialog(); panel.classList.remove('min'); btnMin.replaceChildren(icon('minus', 16));
        state.pinnedFont = { el: main.el }; setTab('font');
      } })));
    // place under the selection, or above it if there's no room
    put(root, selDialog);
    const r = sel.rect; const w = selDialog.offsetWidth, hh = selDialog.offsetHeight;
    let left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
    let top = r.bottom + 10;
    if (top + hh > window.innerHeight - 12) top = Math.max(12, r.top - hh - 10);
    selDialog.style.left = left + 'px'; selDialog.style.top = top + 'px';
  }

  // ═════════ Help ═════════
  views.help = (rootEl) => {
    const kb = (k) => h('kbd', { text: k });
    const mac = navigator.platform && /Mac/i.test(navigator.platform);
    const item = (ic, title, text) => h('div', { class: 'item', style: 'cursor:default;align-items:flex-start' },
      h('span', { class: 't2', style: 'margin-top:2px' }, icon(ic, 16)), h('div', { class: 'grow' }, h('div', { style: 'font-weight:500', text: title }), h('div', { class: 't3 sm', text })));
    put(rootEl, h('div', { class: 'row', style: 'margin-bottom:12px' }, h('div', { class: 'grow' }, h('div', { style: 'font-weight:600;font-size:13px', text: 'How to use Uxearly Inspect' }), h('div', { class: 't3 sm', text: 'Everything works on the page you have open. Nothing is sent anywhere.' })),
      btn('Back', { size: 'sm', variant: 'ghost', icon: 'back', onClick: () => { state.help = false; render(); } })));
    put(rootEl, h('div', { class: 'list' },
      item('font', 'Fonts', 'Hover text for its typography, click to pin the full spec and copy its CSS or HTML. Download the font files the site loads.'),
      item('color', 'Colors', 'Pick any pixel on screen, or browse and copy the page palette in HEX, RGB or HSL.'),
      item('ruler', 'Measure', 'Sizes, padding, margins and gaps on hover. Click to pin and see distances. Hover text for letter widths and gaps. Drag for a ruler.'),
      item('tokens', 'Tokens', 'Export the page’s design system as CSS variables, JSON design tokens or a Tailwind theme.'),
      item('code', 'Code', 'Select an element for clean CSS, or a JSX component and CSS module on React and Next.js sites.'),
      item('image', 'Images', 'Download images, CSS backgrounds and SVG icons as the original file, PNG, JPG, WebP or AVIF.'),
      item('camera', 'Capture', 'Save the full page or the visible area as PNG, JPG, WebP or PDF, up to 4K.')));
    const sc = h('div', { class: 'kv' });
    put(sc, h('div', { class: 'k', text: 'Open / close' }), h('div', { class: 'v' }, kb(mac ? '⌥ ⇧ I' : 'Alt + Shift + I')));
    put(sc, h('div', { class: 'k', text: 'Stop / cancel' }), h('div', { class: 'v' }, kb('Esc'), h('span', { class: 't3 sm', text: 'inspecting, selecting or a capture' })));
    put(sc, h('div', { class: 'k', text: 'Font of a selection' }), h('div', { class: 'v t2', text: 'Select text, right-click, then “Inspect font of …”.' }));
    put(sc, h('div', { class: 'k', text: 'Move panel' }), h('div', { class: 'v t2', text: 'Drag the header. The position is remembered.' }));
    put(rootEl, h('div', { class: 'section' }, section('Shortcuts'), sc));
    put(rootEl, h('div', { class: 'section' }, section('If something doesn’t work'), h('div', { class: 'list' },
      item('refresh', 'Page reloaded', 'The panel reopens by itself on the same site. If it doesn’t, click the toolbar icon once.'),
      item('lock', 'Icon shows “!”', 'Chrome doesn’t allow extensions on its own pages (chrome://, the Web Store, new tab). Open a normal website.'),
      item('image', 'An image or font can’t be converted', 'Some CDNs block other sites from reading files. The original download still works, or allow access in Settings.'),
      item('camera', 'HD or 4K is locked', 'Turn on high-resolution capture once in Settings.'),
      item('alert', 'Panel stops responding after an update', 'Close it and click the toolbar icon again to load the new version.'))));
    put(rootEl, h('div', { class: 'row', style: 'margin-top:14px;gap:8px' },
      btn('Open Settings', { icon: 'settings', onClick: () => sendBg({ type: 'uxi:openOptions' }) }),
      h('span', { class: 't3 sm grow', style: 'text-align:right', text: 'v' + chrome.runtime.getManifest().version })));
  };

  // ═════════ Page interaction ═════════
  function ownsEvent(e) { const p = e.composedPath ? e.composedPath() : []; return p.includes(host); }
  function placeBox(box, el, tagText) {
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    box.classList.toggle('below', r.top < 26);
    box.firstChild.textContent = tagText || `${label(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }
  function showTip(el, x, y) {
    tip.replaceChildren();
    const i = fontInfo(el);
    const g = h('div', { class: 'g' });
    const add = (k, v) => put(g, h('span', { text: k }), h('span', null, v));
    add('Size', `${round(i.size, 1)}px`);
    add('Weight', `${i.weight} ${i.weightName}`);
    add('Line height', i.lhPx ? `${round(i.lhPx, 1)}px` : 'normal');
    if (i.letterSpacing !== 'normal') add('Tracking', i.letterSpacing);
    if (i.color) add('Color', h('span', { class: 'row', style: 'gap:5px' }, swatch(i.color), toHex(i.color)));
    put(tip, h('div', { class: 'fam', text: i.family || i.rendered }),
      i.rendered !== i.family ? h('div', { class: 'sm', style: 'color:var(--warn);margin:-4px 0 6px', text: `Not installed, renders as ${i.rendered}` }) : null,
      g, h('div', { class: 'hint', text: label(el) }));
    tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.min(x + 16, window.innerWidth - tw - 8);
    let top = y + 20;
    if (top + th > window.innerHeight - 8) top = Math.max(8, y - th - 12);
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = top + 'px';
  }

  let raf = 0; let lastMove = null;
  function onMove(e) {
    if (state.mode === 'none') return;
    if (ownsEvent(e)) { overlay.style.display = 'none'; tip.style.display = 'none'; return; }
    lastMove = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const ev = lastMove;
      if (!ev || state.mode === 'none') return;
      const el = ev.target;
      if (!(el instanceof Element) || el === host) return;
      if (el === document.documentElement || el === document.body) { state.hoverEl = null; overlay.style.display = 'none'; tip.style.display = 'none'; if (state.mode === 'measure') measureMove(ev); return; }
      state.hoverEl = el;
      if (state.mode === 'measure') { measureMove(ev); return; }
      placeBox(overlay, el);
      if (state.mode === 'font') showTip(el, ev.clientX, ev.clientY); else tip.style.display = 'none';
    });
  }
  function block(e) {
    if (state.mode === 'none' || ownsEvent(e)) return;
    if (state.mode === 'measure' && (e.type === 'pointerdown' || e.type === 'pointerup')) measurePointer(e);
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  }
  function onClick(e) {
    if (state.mode === 'none' || ownsEvent(e)) return;
    block(e);
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el === document.documentElement || el === document.body) return;
    if (state.mode === 'measure') return; // handled by pointer events
    if (state.mode === 'font') { state.pinnedFont = { el }; render(); status('Pinned ' + label(el), 'ok'); }
    else if (state.mode === 'code') { setMode('none'); showSel(el); extractCode(el); }
  }
  function showSel(el) { state.codeEl = el; placeBox(selOverlay, el); }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (state.shot && state.shot.busy) { state.shotAbort = true; e.stopPropagation(); return; }
    if (selDialog.isConnected) { closeSelDialog(); e.stopPropagation(); return; }
    if (state.mode === 'measure' && (state.measure.anchor || state.measure.ruler)) { state.measure.anchor = null; state.measure.ruler = null; scheduleMeasure(); if (state.tab === 'measure') render(); e.stopPropagation(); return; }
    if (state.mode !== 'none') { setMode('none'); render(); e.stopPropagation(); return; }
    selOverlay.style.display = 'none';
  }
  function onScroll() {
    if (state.mode === 'measure') scheduleMeasure();
    if (state.hoverEl && state.mode !== 'none' && document.contains(state.hoverEl)) placeBox(overlay, state.hoverEl);
    if (selOverlay.style.display === 'block') {
      if (state.codeEl && document.contains(state.codeEl) && state.tab === 'code') placeBox(selOverlay, state.codeEl);
      else if (state.tab !== 'images') selOverlay.style.display = 'none';
    }
  }
  const onScheme = () => { if (prefs.theme === 'auto') applyTheme(); };

  const listeners = [
    // pointermove keeps firing while a button is held (mousemove doesn't once pointerdown is cancelled)
    [window, 'pointermove', onMove, { capture: true, passive: true }],
    [window, 'click', onClick, true],
    [window, 'mousedown', block, true], [window, 'mouseup', block, true],
    [window, 'pointerdown', block, true], [window, 'pointerup', block, true],
    [window, 'auxclick', block, true], [window, 'dblclick', block, true], [window, 'contextmenu', block, true],
    [window, 'keydown', onKey, true],
    [window, 'scroll', onScroll, { capture: true, passive: true }],
    [window, 'resize', onScroll, { passive: true }]
  ];
  for (const [t, n, f, o] of listeners) t.addEventListener(n, f, o);
  if (mql && mql.addEventListener) mql.addEventListener('change', onScheme);

  let destroyed = false;
  // Wheel/trackpad over the panel scrolls the panel only, never the page underneath.
  function onPanelWheel(e) {
    // Chrome keeps a fast wheel burst "latched" to where it started. If the pointer has already
    // moved onto the page, hand the scroll to the page instead of swallowing it.
    const box = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
    if (box && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom)) {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      window.scrollBy({ left: e.deltaX * k, top: e.deltaY * k, behavior: 'instant' });
      return;
    }
    let el = e.target instanceof Element ? e.target : null;
    const path = e.composedPath ? e.composedPath() : [];
    for (const n of path) {
      if (n === root || n === shadow) break;
      if (!(n instanceof Element)) continue;
      const cs = getComputedStyle(n);
      const canY = /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1;
      const canX = /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1;
      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX) && canY) {
        const atTop = n.scrollTop <= 0, atEnd = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
        if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atEnd)) return; // this element scrolls; let it
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && canX) {
        const atStart = n.scrollLeft <= 0, atEnd = n.scrollLeft + n.clientWidth >= n.scrollWidth - 1;
        if ((e.deltaX < 0 && !atStart) || (e.deltaX > 0 && !atEnd)) return;
      }
      el = n;
    }
    e.preventDefault();
  }
  for (const layer of [panel, tip]) layer.addEventListener('wheel', onPanelWheel, { passive: false });

  // Panel typefaces (Inter + JetBrains Mono, bundled). Loaded as FontFace objects from bytes,
  // so nothing is fetched from the web and no stylesheet is added to the page.
  const uiFaces = [];
  (async () => {
    try {
      for (const [name, family] of [['sans', 'Uxi Inter'], ['mono', 'Uxi Mono']]) {
        const r = await sendBg({ type: 'uxi:uiFont', name });
        if (!r || !r.ok || destroyed) return;
        const face = new FontFace(family, b64ToBytes(r.b64), { weight: '100 900', display: 'swap' });
        await face.load();
        if (destroyed) return;
        document.fonts.add(face); uiFaces.push(face);
      }
    } catch (_) { /* system fonts are the fallback */ }
  })();

  function onCursor(e) { cursor = ownsEvent(e) ? null : { x: e.clientX, y: e.clientY }; if (!readoutRaf) readoutRaf = requestAnimationFrame(() => { readoutRaf = 0; updateReadout(); }); }
  let readoutRaf = 0;
  function onLeaveDoc(e) { if (!e.relatedTarget) { cursor = null; updateReadout(); } }
  window.addEventListener('pointermove', onCursor, { capture: true, passive: true });
  document.addEventListener('mouseout', onLeaveDoc, { passive: true });
  window.addEventListener('resize', updateReadout, { passive: true });
  window.addEventListener('scroll', updateReadout, { capture: true, passive: true });
  updateReadout();
  // Leaving the page (reload, navigation): stop any capture so nothing is left half-done
  function onPageHide() { if (state.shot && state.shot.busy) { state.shotAbort = true; sendBg({ type: 'uxi:shot-abort' }); } }
  window.addEventListener('pagehide', onPageHide);

  // Single-page apps change the URL without reloading: reset page data when that happens.
  let lastHref = location.href;
  const hrefTimer = setInterval(() => {
    if (location.href === lastHref || (state.shot && state.shot.busy)) return;
    lastHref = location.href;
    Object.assign(state, { scan: null, tokens: null, images: null, imgDetail: null, pageFramework: null, codeEl: null, codeResult: null, fontFiles: null });
    if (state.pinnedFont && !document.contains(state.pinnedFont.el)) state.pinnedFont = null;
    blobCache.clear();
    selOverlay.style.display = 'none';
    render();
    status('Page changed. Data refreshed.', 'ok');
  }, 800);

  function destroy(keepOpenRecord) {
    if (destroyed) return;
    destroyed = true;
    clearInterval(hrefTimer);
    window.removeEventListener('pointermove', onCursor, { capture: true });
    document.removeEventListener('mouseout', onLeaveDoc);
    window.removeEventListener('resize', updateReadout);
    window.removeEventListener('scroll', updateReadout, { capture: true });
    window.removeEventListener('pagehide', onPageHide);
    if (readoutRaf) cancelAnimationFrame(readoutRaf);
    for (const f of uiFaces) { try { document.fonts.delete(f); } catch (_) { /* ignore */ } }
    if (!keepOpenRecord && !state.stale) sendBg({ type: 'uxi:panel', open: false });
    for (const [t, n, f, o] of listeners) t.removeEventListener(n, f, o);
    if (mql && mql.removeEventListener) mql.removeEventListener('change', onScheme);
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(footTimer);
    blobCache.clear();
    host.remove();
    delete window.__uxiInstance;
  }
  window.__uxiInstance = {
    build: BUILD,
    toggle: () => destroy(),
    destroy: () => destroy(true),
    showSelection: () => showSelection(),
    alive: () => { try { return !destroyed && !state.stale && !!chrome.runtime.id && document.contains(host); } catch (_) { return false; } }
  };

  applyTheme();
  document.documentElement.appendChild(host);
  setTab('font');
  sendBg({ type: 'uxi:panel', open: true });
  if (action === 'selection') {
    // Opened from the right-click menu: keep the panel compact and show the dialog by the selection
    panel.classList.add('min'); btnMin.replaceChildren(icon('plus', 16));
    setMode('none');
    setTimeout(showSelection, 0);
  }
  // Restore saved preferences (theme, formats, panel position)
  try {
    storage && storage.get('uxiPrefs', (res) => {
      const p = res && res.uxiPrefs;
      if (!p || typeof p !== 'object') return;
      if (['auto', 'light', 'dark'].includes(p.theme)) prefs.theme = p.theme;
      if (['font', 'color', 'measure', 'system', 'code', 'images'].includes(p.lastTab)) prefs.lastTab = p.lastTab;
      if (['hex', 'rgb', 'hsl'].includes(p.colorFormat)) prefs.colorFormat = p.colorFormat;
      if (['original', 'png', 'jpeg', 'webp', 'avif'].includes(p.imgFormat)) prefs.imgFormat = p.imgFormat;
      if (typeof p.quality === 'number' && p.quality >= 0.4 && p.quality <= 1) prefs.quality = p.quality;
      if (p.shot && typeof p.shot === 'object') prefs.shot = {
        area: ['full', 'visible'].includes(p.shot.area) ? p.shot.area : 'full',
        res: ['screen', 'hd', '4k'].includes(p.shot.res) ? p.shot.res : 'screen',
        format: ['png', 'jpeg', 'webp', 'pdf'].includes(p.shot.format) ? p.shot.format : 'png' };
      if (p.pos && Number.isFinite(p.pos.left) && Number.isFinite(p.pos.top)) {
        prefs.pos = p.pos;
        panel.style.left = Math.max(0, Math.min(window.innerWidth - 120, p.pos.left)) + 'px';
        panel.style.top = Math.max(0, Math.min(window.innerHeight - 48, p.pos.top)) + 'px';
        panel.style.right = 'auto';
      }
      applyTheme();
      if (auto && prefs.lastTab && prefs.lastTab !== state.tab) setTab(prefs.lastTab); else render();
    });
  } catch (_) { /* ignore */ }
})();

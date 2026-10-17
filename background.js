'use strict';

// Uxearly Inspect — service worker.
// Runs only after the user clicks the toolbar icon or presses the shortcut (activeTab).
// Network use: fetching an image the user asked to download/convert. Nothing is sent anywhere.
// AVIF encoder (Squoosh, Apache-2.0) is bundled; its WASM is compiled only on first AVIF export.
importScripts('vendor/avif.js');

const BLOCKED = /^(chrome|edge|about|devtools|chrome-extension|view-source):/i;

// Pages Chrome never lets extensions run on
function blockedReason(url) {
  if (!url) return null;
  if (BLOCKED.test(url)) return 'Chrome doesn’t allow extensions on its own pages';
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)) return 'Chrome doesn’t allow extensions on the Web Store';
  return null;
}

async function flashBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025', tabId });
    await chrome.action.setBadgeText({ text, tabId });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), 2500);
  } catch (_) { /* tab closed */ }
}

async function explainBlocked(tabId, reason) {
  flashBadge(tabId, '!');
  try { await chrome.action.setTitle({ tabId, title: `Uxearly Inspect: ${reason}. Open a regular website to use it.` }); } catch (_) { /* tab gone */ }
}

async function toggle(tab) {
  if (!tab || typeof tab.id !== 'number') return;
  const reason = blockedReason(tab.url);
  if (reason) { explainBlocked(tab.id, reason); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (err) {
    // chrome:// pages (their URL is hidden from extensions), PDF viewer, other extensions' pages, file:// without access
    explainBlocked(tab.id, 'Chrome doesn’t allow extensions on this page');
  }
}

// ---- keep the panel open across reloads ----
// Tabs where the panel is open are remembered for this browser session. After a reload or a
// same-site navigation the panel is restored automatically (Chrome keeps the activeTab grant
// for the same site; if it doesn't, nothing happens and the user simply clicks the icon again).
const openTabs = {
  async get() { try { return (await chrome.storage.session.get('uxiOpen')).uxiOpen || {}; } catch (_) { return {}; } },
  async set(tabId, origin) { const m = await this.get(); if (origin) m[tabId] = origin; else delete m[tabId]; try { await chrome.storage.session.set({ uxiOpen: m }); } catch (_) { /* ignore */ } }
};
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  // A reload or navigation during a capture ends it cleanly (detaches the debugger, clears the badge)
  if (info.status === 'loading' && shots.has(tabId)) shotEnd(tabId);
  if (info.status !== 'complete' || !tab.url) return;
  const m = await openTabs.get();
  if (!m[tabId]) return;
  let origin = null; try { origin = new URL(tab.url).origin; } catch (_) { origin = null; }
  if (origin !== m[tabId] || blockedReason(tab.url)) { openTabs.set(tabId, null); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__uxiAuto = true; } });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
  catch (_) { openTabs.set(tabId, null); }
});
chrome.tabs.onRemoved.addListener((tabId) => { openTabs.set(tabId, null); });

// ---- right-click → "Inspect font of “…”" on selected text ----
const MENU_ID = 'uxi-inspect-selection';
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Inspect font of “%s”', contexts: ['selection'] }, () => void chrome.runtime.lastError);
  });
}
chrome.runtime.onInstalled.addListener((d) => {
  createMenus();
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
});
chrome.runtime.onStartup.addListener(createMenus);
async function onMenuClick(info, tab) {
  if (info.menuItemId !== MENU_ID || !tab || typeof tab.id !== 'number') return;
  const reason = blockedReason(tab.url);
  if (reason) { explainBlocked(tab.id, reason); return; }
  const target = { tabId: tab.id, frameIds: [typeof info.frameId === 'number' ? info.frameId : 0] };
  try {
    // An open panel shows the dialog directly; otherwise open the panel in compact mode first.
    const [r] = await chrome.scripting.executeScript({ target, func: () => {
      const i = window.__uxiInstance;
      if (i && i.alive && i.alive() && i.showSelection) { i.showSelection(); return true; }
      window.__uxiAction = 'selection';
      return false;
    } });
    if (!r || !r.result) await chrome.scripting.executeScript({ target, files: ['content.js'] });
  } catch (_) { explainBlocked(tab.id, 'Chrome doesn’t allow extensions on this page'); }
}
chrome.contextMenus.onClicked.addListener(onMenuClick);

// ---- UI fonts (Inter + JetBrains Mono, OFL) handed to the panel as bytes ----
// Loaded with the FontFace API inside the extension's own context, so no stylesheet or
// web-accessible URL is exposed to the page.
const uiFontCache = {};
async function uiFont(name) {
  const file = { sans: 'fonts/inter-latin.woff2', mono: 'fonts/jetbrains-mono-latin.woff2' }[name];
  if (!file) return { ok: false };
  if (!uiFontCache[name]) uiFontCache[name] = fetch(chrome.runtime.getURL(file)).then((r) => r.arrayBuffer()).then(bufToB64);
  return { ok: true, b64: await uiFontCache[name] };
}

chrome.action.onClicked.addListener(toggle);

// ---- React / Next.js inspection (runs in the page's MAIN world, returns plain JSON) ----
// Self-contained: chrome.scripting serializes this function, so it cannot use outer variables.
function inspectReactInPage(token) {
  const LIMIT = 400;
  const out = { ok: true, isReact: false, isNext: false, nextRouter: null, rootManaged: false, owners: [], ownerProps: null, tree: null };
  try {
    const w = window;
    const hasNextScript = !!document.querySelector('script[src*="/_next/"]');
    out.isNext = !!(w.__NEXT_DATA__ || w.next || w.__next_f || hasNextScript || document.getElementById('__next'));
    if (out.isNext) out.nextRouter = w.__NEXT_DATA__ ? 'pages' : (w.__next_f ? 'app' : null);

    const fiberKeyOf = (node) => {
      if (!node) return null;
      const ks = Object.keys(node);
      for (let i = 0; i < ks.length; i++) {
        if (ks[i].startsWith('__reactFiber$') || ks[i].startsWith('__reactInternalInstance$')) return ks[i];
      }
      return null;
    };
    const propsKeyOf = (node) => {
      const ks = Object.keys(node);
      for (let i = 0; i < ks.length; i++) if (ks[i].startsWith('__reactProps$')) return ks[i];
      return null;
    };

    // Page-level detection
    const probes = [document.getElementById('__next'), document.getElementById('root'), document.getElementById('app')]
      .concat(Array.prototype.slice.call(document.body ? document.body.querySelectorAll('body > *, body > * > *') : [], 0, 40));
    for (const p of probes) { if (p && fiberKeyOf(p)) { out.isReact = true; break; } }

    if (!token) return out;
    const el = document.querySelector('[data-uxi-target="' + String(token).replace(/[^a-z0-9]/gi, '') + '"]');
    if (!el) return out;

    const key = fiberKeyOf(el);
    if (!key) return out;
    out.isReact = true;
    out.rootManaged = true;

    // Pick the current fiber (DOM may point at the stale alternate)
    let fiber = el[key];
    const pk = propsKeyOf(el);
    if (pk && fiber.alternate && fiber.alternate.memoizedProps === el[pk]) fiber = fiber.alternate;

    const nameOf = (type) => {
      if (!type) return null;
      if (typeof type === 'string') return type;
      if (typeof type === 'function') return type.displayName || type.name || null;
      if (typeof type === 'object') {
        if (type.displayName) return type.displayName;
        if (type.render) return type.render.displayName || type.render.name || 'ForwardRef';
        if (type.type) return nameOf(type.type);
      }
      return null;
    };

    const safe = (p) => {
      const o = {};
      if (!p || typeof p !== 'object') return o;
      let n = 0;
      for (const k of Object.keys(p)) {
        if (k === 'children' || n++ > 60) continue;
        const v = p[k]; const t = typeof v;
        if (v === null || v === undefined || t === 'boolean' || t === 'number') o[k] = v === undefined ? null : v;
        else if (t === 'string') o[k] = v.slice(0, 2000);
        else if (t === 'function') o[k] = { __fn: String(v.name || 'anonymous').slice(0, 80) };
        else if (Array.isArray(v)) o[k] = { __arr: v.length };
        else if (k === 'style') {
          const s = {}; let m = 0;
          for (const sk of Object.keys(v)) { const sv = v[sk]; if (m++ < 40 && (typeof sv === 'string' || typeof sv === 'number')) s[sk] = sv; }
          o[k] = { __style: s };
        } else o[k] = { __obj: true };
      }
      return o;
    };

    const pathOf = (node) => {
      const p = [];
      let n = node;
      while (n && n !== el) {
        const parent = n.parentElement;
        if (!parent) return null;
        p.unshift(Array.prototype.indexOf.call(parent.children, n));
        n = parent;
      }
      return n === el ? p : null;
    };

    let count = 0;
    const COMP_TAGS = { 0: 1, 1: 1, 11: 1, 14: 1, 15: 1 };
    const kids = (f, d) => {
      const r = [];
      let c = f.child;
      while (c && count < LIMIT) { const w2 = walk(c, d + 1); for (const x of w2) r.push(x); c = c.sibling; }
      return r;
    };
    const walk = (f, d) => {
      if (!f || count >= LIMIT || d > 80) return [];
      if (f.tag === 5 || f.tag === 27) {
        count++;
        const node = { k: 'h', tag: String(f.type), props: safe(f.memoizedProps), path: pathOf(f.stateNode), c: [] };
        node.c = kids(f, d);
        return [node];
      }
      if (f.tag === 6) { count++; return [{ k: 't', text: String(f.memoizedProps == null ? '' : f.memoizedProps).slice(0, 1000) }]; }
      if (f.tag === 4 || f.tag === 26) return []; // portals, hoistables
      if (COMP_TAGS[f.tag]) return [{ k: 'c', name: nameOf(f.type), props: safe(f.memoizedProps), c: kids(f, d) }];
      return kids(f, d);
    };

    out.tree = walk(fiber, 0)[0] || null;

    let r = fiber.return; let i = 0;
    while (r && i < 40) {
      if (COMP_TAGS[r.tag]) {
        const nm = nameOf(r.type);
        if (nm) out.owners.push(String(nm).slice(0, 80));
        if (!out.ownerProps) out.ownerProps = safe(r.memoizedProps);
      }
      r = r.return; i++;
    }
  } catch (e) {
    out.ok = false;
    out.error = String(e && e.message || e).slice(0, 200);
  }
  return out;
}


// ---- image helpers ----
const MAX_BYTES = 60 * 1024 * 1024;

function bufToB64(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

// Only image bytes are ever returned, so this can't be used to read arbitrary cross-site pages.
function sniffImage(bytes, declared) {
  const b = bytes;
  const at = (o, sig) => sig.every((v, i) => b[o + i] === v);
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  if (at(4, [0x66, 0x74, 0x79, 0x70]) && /^(avif|avis|mif1|msf1)/.test(String.fromCharCode(...b.subarray(8, 12)))) return 'image/avif';
  if (at(0, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  if (at(0, [0x42, 0x4d])) return 'image/bmp';
  if (at(0, [0x49, 0x49, 0x2a, 0x00]) || at(0, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff';
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^﻿/, '');
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  if (/^image\//.test(declared || '') && !/^\s*</.test(head)) return declared.split(';')[0];
  return null;
}

async function fetchImage(url) {
  let u;
  try { u = new URL(url); } catch (_) { return { ok: false, code: 'BAD_URL' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, code: 'BAD_URL' };
  let res;
  // With host access (the active tab's site, or the optional all-sites grant) CORS doesn't apply.
  // Otherwise retry without cookies so CDNs that send `Access-Control-Allow-Origin: *` still work.
  for (const credentials of ['include', 'omit']) {
    try { res = await fetch(u.href, { credentials, cache: 'force-cache', redirect: 'follow' }); break; }
    catch (_) { res = null; }
  }
  if (!res) return { ok: false, code: 'BLOCKED', error: 'Blocked by the image server' };
  if (!res.ok) return { ok: false, code: 'HTTP', error: 'HTTP ' + res.status };
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return { ok: false, code: 'TOO_LARGE' };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return { ok: false, code: 'TOO_LARGE' };
  const mime = sniffImage(new Uint8Array(buf), res.headers.get('content-type'));
  if (!mime) return { ok: false, code: 'NOT_IMAGE', error: 'Response is not an image' };
  return { ok: true, b64: bufToB64(buf), mime, size: buf.byteLength };
}

async function encodeAvif(b64png, quality) {
  const bmp = await createImageBitmap(new Blob([b64ToBytes(b64png)], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = await self.UxiAvif.encode(data, quality);
  return bufToB64(out);
}

const SAFE_MIME = /^(image\/(png|jpeg|webp|avif|gif|svg\+xml|x-icon|vnd\.microsoft\.icon|bmp|tiff)|text\/(css|plain|javascript)|application\/(json|javascript|octet-stream|pdf|font-woff|x-font-ttf|x-font-otf|vnd\.ms-fontobject)|font\/(woff2|woff|ttf|otf|sfnt|collection))$/;

// Stylesheets the page can't expose to scripts (cross-origin, e.g. Google Fonts) are fetched here
// only to read their @font-face rules. Only CSS text is returned.
async function fetchCss(url) {
  let u; try { u = new URL(url); } catch (_) { return { ok: false, code: 'BAD_URL' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, code: 'BAD_URL' };
  let res = null;
  for (const credentials of ['include', 'omit']) {
    try { res = await fetch(u.href, { credentials, cache: 'force-cache' }); break; } catch (_) { res = null; }
  }
  if (!res || !res.ok) return { ok: false, code: 'BLOCKED' };
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  if (text.length > 3_000_000) return { ok: false, code: 'TOO_LARGE' };
  if (!/text\/css/.test(type) && !/@font-face|@import|\{[^}]*:[^}]*\}/.test(text.slice(0, 20000))) return { ok: false, code: 'NOT_CSS' };
  if (/^\s*</.test(text)) return { ok: false, code: 'NOT_CSS' };
  return { ok: true, text, url: res.url };
}
function cleanFilename(name) {
  const parts = String(name || 'download').split('/').map((p) => p.replace(/[\\:*?"<>|\x00-\x1f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 100)).filter(Boolean);
  return parts.slice(-4).join('/') || 'download';
}

async function startDownload(msg) {
  const filename = cleanFilename(msg.filename);
  let url;
  if (typeof msg.url === 'string') {
    let u; try { u = new URL(msg.url); } catch (_) { return { ok: false, error: 'Bad URL' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Unsupported URL' };
    url = u.href;
  } else if (typeof msg.b64 === 'string') {
    const mime = String(msg.mime || '');
    if (!SAFE_MIME.test(mime)) return { ok: false, error: 'Unsupported type' };
    url = `data:${mime};base64,${msg.b64}`;
  } else return { ok: false, error: 'Nothing to download' };
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  return { ok: typeof id === 'number', id };
}

// ---- full-page screenshots ----
// The content script scrolls the page and asks for one frame at a time; frames are drawn straight into
// output "parts" (≤ 16,384 px tall) so memory stays bounded, and each finished part is encoded and saved.
// Screen quality uses captureVisibleTab (activeTab). HD / 4K use the optional `debugger` permission to
// re-render each frame at a higher device scale.
const PART_MAX = 16384;
const shots = new Map(); // tabId -> session

function pdfFromJpegs(pages) {
  // Minimal PDF writer: one JPEG per page, page size in points (1 CSS px = 0.75 pt, i.e. actual size).
  const enc = new TextEncoder();
  const chunks = []; let len = 0; const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`]);
  pages.forEach((pg, i) => {
    const pn = 3 + i * 3, cn = pn + 1, im = pn + 2;
    const W = (pg.cssW * 0.75).toFixed(2), H = (pg.cssH * 0.75).toFixed(2);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(pn, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>`]);
    obj(cn, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    obj(im, [`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`, pg.jpeg, '\nendstream']);
  });
  const n = 3 + pages.length * 3;
  const xref = len;
  push(`xref\n0 ${n}\n0000000000 65535 f \n`);
  for (let k = 1; k < n; k++) push(String(offsets[k]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const dbg = (target, method, params) => new Promise((res, rej) => chrome.debugger.sendCommand(target, method, params || {}, (r) => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shotEnd(tabId) {
  const s = shots.get(tabId);
  shots.delete(tabId);
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  if (s && s.debugger) { try { await chrome.debugger.detach({ tabId }); } catch (_) { /* already detached */ } }
  if (s) for (const p of s.parts.values()) if (p.canvas) p.canvas = null;
}

async function shotBegin(tab, msg) {
  await shotEnd(tab.id);
  const res = ['screen', 'hd', '4k'].includes(msg.res) ? msg.res : 'screen';
  const s = { tabId: tab.id, windowId: tab.windowId, res, debugger: false, lastCapture: 0, parts: new Map(), pdf: [], files: [], scale: 0, setup: null, preview: null };
  if (res !== 'screen') {
    if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) return { ok: false, code: 'NEED_DEBUGGER' };
    hookDetach();
    try { await chrome.debugger.attach({ tabId: tab.id }, '1.3'); } catch (e) { return { ok: false, code: 'ATTACH', error: String(e.message || e) }; }
    s.debugger = true;
    await sleep(450); // Chrome's "started debugging" bar resizes the viewport; let layout settle
  }
  shots.set(tab.id, s);
  return { ok: true };
}

function partIndexRange(s, y0, y1) { return [Math.floor(y0 / s.partPx), Math.floor((y1 - 1) / s.partPx)]; }

async function flushPart(s, k) {
  const p = s.parts.get(k);
  if (!p || p.done) return;
  p.done = true;
  const st = s.setup;
  const fmt = st.format;
  const mime = fmt === 'pdf' || fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  const blob = await p.canvas.convertToBlob({ type: mime, quality: fmt === 'png' ? undefined : st.quality });
  if (k === 0) {
    // small preview of the top of the page for the panel
    const pw = 480, ph = Math.min(Math.round(pw * 0.75), Math.round(p.h * pw / s.widthPx));
    const pc = new OffscreenCanvas(pw, ph);
    pc.getContext('2d').drawImage(p.canvas, 0, 0, s.widthPx, Math.round(ph * s.widthPx / pw), 0, 0, pw, ph);
    s.preview = bufToB64(await (await pc.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer());
  }
  p.canvas = null;
  if (fmt === 'pdf') { s.pdf.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: s.widthPx, h: p.h, cssW: st.cssW, cssH: p.h / s.scale }); return; }
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;
  const name = `${st.folder}${st.base}${s.partCount > 1 ? `-part-${k + 1}` : ''}.${ext}`;
  const id = await chrome.downloads.download({ url: `data:${mime};base64,${bufToB64(await blob.arrayBuffer())}`, filename: cleanFilename(name), conflictAction: 'uniquify', saveAs: false });
  s.files.push({ id, name: name.split('/').pop(), size: blob.size, w: s.widthPx, h: p.h });
}

async function shotFrame(tabId, msg) {
  const s = shots.get(tabId);
  if (!s || !s.setup) return { ok: false, error: 'No capture in progress' };
  const c = msg.crop; // CSS px: viewport-relative x/y/w/h plus page scroll offsets
  let bmp;
  if (s.debugger) {
    const r = await dbg({ tabId }, 'Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: c.x + c.scrollX, y: c.y + c.scrollY, width: c.w, height: c.h, scale: s.scale } });
    bmp = await createImageBitmap(new Blob([b64ToBytes(r.data)], { type: 'image/png' }));
  } else {
    const wait = 520 - (Date.now() - s.lastCapture); // Chrome allows ~2 captureVisibleTab calls per second
    if (wait > 0) await sleep(wait);
    const url = await chrome.tabs.captureVisibleTab(s.windowId, { format: 'png' });
    s.lastCapture = Date.now();
    const full = await createImageBitmap(await (await fetch(url)).blob());
    const k = full.width / c.innerWidth;
    if (!s.scale) s.scale = k;
    bmp = await createImageBitmap(full, Math.round(c.x * k), Math.round(c.y * k), Math.max(1, Math.round(c.w * k)), Math.max(1, Math.round(c.h * k)));
    full.close();
  }
  if (!s.widthPx) {
    s.widthPx = Math.round(s.setup.cssW * s.scale);
    s.totalPx = Math.round(s.setup.cssH * s.scale);
    s.partPx = s.setup.format === 'pdf' ? Math.min(PART_MAX, Math.round(14000 / 0.75 * s.scale)) : PART_MAX;
    s.partCount = Math.max(1, Math.ceil(s.totalPx / s.partPx));
  }
  const destY = Math.round(msg.destY * s.scale);
  const y1 = Math.min(s.totalPx, destY + bmp.height);
  const [k0, k1] = partIndexRange(s, destY, y1);
  for (let k = k0; k <= k1; k++) {
    let p = s.parts.get(k);
    if (!p) {
      const h = Math.min(s.partPx, s.totalPx - k * s.partPx);
      p = { h, canvas: new OffscreenCanvas(s.widthPx, h), done: false };
      const ctx = p.canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, s.widthPx, h);
      s.parts.set(k, p);
    }
    if (p.done) continue;
    p.canvas.getContext('2d').drawImage(bmp, 0, destY - k * s.partPx);
  }
  bmp.close();
  if (msg.total > 1) chrome.action.setBadgeBackgroundColor({ color: '#4f5ff0', tabId }).then(() => chrome.action.setBadgeText({ text: Math.round(((msg.index + 1) / msg.total) * 100) + '%', tabId })).catch(() => {});
  // Frames arrive top to bottom: every part above this frame is complete
  for (const [k, p] of s.parts) if (!p.done && (k + 1) * s.partPx <= destY) await flushPart(s, k);
  return { ok: true, scale: s.scale };
}

async function shotFinish(tabId) {
  const s = shots.get(tabId);
  if (!s) return { ok: false, error: 'No capture in progress' };
  try {
    for (const k of [...s.parts.keys()].sort((a, b) => a - b)) await flushPart(s, k);
    if (s.setup.format === 'pdf' && s.pdf.length) {
      const pdf = pdfFromJpegs(s.pdf);
      const name = `${s.setup.folder}${s.setup.base}.pdf`;
      const id = await chrome.downloads.download({ url: `data:application/pdf;base64,${bufToB64(pdf)}`, filename: cleanFilename(name), conflictAction: 'uniquify', saveAs: false });
      s.files.push({ id, name: name.split('/').pop(), size: pdf.length, w: s.widthPx, h: s.totalPx, pages: s.pdf.length });
    }
    return { ok: true, files: s.files, width: s.widthPx, height: s.totalPx, scale: s.scale, preview: s.preview };
  } finally { await shotEnd(tabId); }
}

// chrome.debugger only exists once the optional permission is granted
let detachHooked = false;
function hookDetach() {
  if (detachHooked || !chrome.debugger) return;
  detachHooked = true;
  chrome.debugger.onDetach.addListener((src) => { const s = shots.get(src.tabId); if (s) s.debugger = false; });
}
hookDetach();
chrome.permissions.onAdded.addListener(hookDetach);
chrome.tabs.onRemoved.addListener((tabId) => { shots.delete(tabId); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  const fromTab = sender.tab && typeof sender.tab.id === 'number';
  const reply = (p) => { p.then(sendResponse, (err) => sendResponse({ ok: false, error: String(err && err.message || err).slice(0, 200) })); return true; };

  switch (msg.type) {
    case 'uxi:react': {
      if (!fromTab) return false;
      const token = typeof msg.token === 'string' && /^[a-z0-9]{8,40}$/i.test(msg.token) ? msg.token : null;
      return reply(chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [typeof sender.frameId === 'number' ? sender.frameId : 0] },
        world: 'MAIN', func: inspectReactInPage, args: [token]
      }).then((res) => ({ ok: true, data: res && res[0] ? res[0].result : null })));
    }
    case 'uxi:fetch':
      if (!fromTab || typeof msg.url !== 'string') return false;
      return reply(fetchImage(msg.url));
    case 'uxi:avif':
      if (!fromTab || typeof msg.b64 !== 'string') return false;
      return reply(encodeAvif(msg.b64, Number(msg.quality) || 70).then((b64) => ({ ok: true, b64 })));
    case 'uxi:download':
      if (!fromTab) return false;
      return reply(startDownload(msg));
    case 'uxi:uiFont':
      return reply(uiFont(msg.name));
    case 'uxi:fetchCss':
      if (!fromTab || typeof msg.url !== 'string') return false;
      return reply(fetchCss(msg.url));
    case 'uxi:panel':
      if (!fromTab) return false;
      return reply(openTabs.set(sender.tab.id, msg.open ? (() => { try { return new URL(sender.tab.url).origin; } catch (_) { return null; } })() : null).then(() => ({ ok: true })));
    case 'uxi:shot-begin':
      if (!fromTab) return false;
      return reply(shotBegin(sender.tab, msg));
    case 'uxi:shot-setup': {
      if (!fromTab) return false;
      const s = shots.get(sender.tab.id);
      if (!s) { sendResponse({ ok: false, error: 'No capture in progress' }); return false; }
      const fmt = ['png', 'jpeg', 'webp', 'pdf'].includes(msg.format) ? msg.format : 'png';
      const cssW = Math.max(1, Math.min(10000, Math.round(Number(msg.cssW) || 0)));
      const cssH = Math.max(1, Math.min(60000, Math.round(Number(msg.cssH) || 0)));
      s.setup = { format: fmt, quality: Math.min(1, Math.max(0.5, Number(msg.quality) || 0.92)), cssW, cssH,
        folder: 'Uxearly Inspect/' + String(msg.site || 'page').replace(/[^a-z0-9.-]/gi, '-').slice(0, 60) + '/', base: String(msg.base || 'screenshot').replace(/[^a-z0-9._-]/gi, '-').slice(0, 80) };
      if (s.debugger) s.scale = s.res === '4k' ? Math.min(4, Math.max(2, 3840 / cssW)) : 2;
      // keep each output part within Chrome's canvas limits
      if (s.debugger) s.scale = Math.min(s.scale, Math.floor(16000 / cssW * 100) / 100);
      sendResponse({ ok: true, scale: s.scale || null });
      return false;
    }
    case 'uxi:shot-frame':
      if (!fromTab || !msg.crop) return false;
      return reply(shotFrame(sender.tab.id, msg));
    case 'uxi:shot-finish':
      if (!fromTab) return false;
      return reply(shotFinish(sender.tab.id));
    case 'uxi:shot-abort':
      if (!fromTab) return false;
      return reply(shotEnd(sender.tab.id).then(() => ({ ok: true })));
    case 'uxi:showDownload':
      if (typeof msg.id === 'number') chrome.downloads.show(msg.id);
      sendResponse({ ok: true }); return false;
    case 'uxi:hasDebugger':
      return reply(chrome.permissions.contains({ permissions: ['debugger'] }).then((granted) => ({ ok: true, granted })));
    case 'uxi:hasAllSites':
      return reply(chrome.permissions.contains({ origins: ['<all_urls>'] }).then((granted) => ({ ok: true, granted })));
    case 'uxi:openOptions':
      if (msg.section === 'capture') return reply(chrome.tabs.create({ url: chrome.runtime.getURL('options.html#capture') }).then(() => ({ ok: true })));
      return reply(chrome.runtime.openOptionsPage().then(() => ({ ok: true })));
    default:
      return false;
  }
});

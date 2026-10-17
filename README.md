<p align="center">
  <img src="icons/logo.svg" width="72" height="72" alt="Uxearly Inspect logo">
</p>

<h1 align="center">Uxearly Inspect</h1>

<p align="center">
  A Chrome extension for designers and front-end developers. Inspect fonts and colors, extract a site's design system, copy CSS or React code, and save images and full-page screenshots, all from one panel.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-v3-blue">
  <img alt="Version" src="https://img.shields.io/badge/version-0.5.0-informational">
  <img alt="Chrome 116+" src="https://img.shields.io/badge/chrome-116%2B-brightgreen">
  <img alt="No tracking" src="https://img.shields.io/badge/tracking-none-success">
</p>

---

## Features

| Tab | What it does |
|---|---|
| **Fonts** | Hover any text to see its font family, the font actually rendered, size (px and rem), weight, line height, letter spacing, color and WCAG contrast. Pin it to copy typography CSS, full element CSS or HTML. Lists every font on the page and downloads the font files it loads (WOFF2, WOFF, TTF, OTF), including Google Fonts. |
| **Colors** | Eyedropper for any pixel on screen, plus the page's full palette filtered by text, fill, border, icons and gradients. Copy as HEX, RGB or HSL. |
| **Measure** | Size, padding, margin and flex/grid gaps on hover. Click to pin an element and hover another for exact distances. Hover text to measure a single letter and the gap to the next. Drag anywhere for a free ruler. px or rem. |
| **Tokens** | Turns a page into a design system: color tokens, text styles, spacing scale, radii, shadows, breakpoints and existing CSS variables. Export as CSS variables, W3C design tokens (JSON) or a Tailwind theme. |
| **Code** | Select an element to get clean CSS that matches the live markup. On React and Next.js sites, get a reconstructed JSX component with a CSS module, props and event handlers (including `next/link` and `next/image`). |
| **Images** | Finds every image, CSS background, inline SVG, favicon and social image. Download originals or convert to PNG, JPG, WebP or AVIF, one at a time or all at once. |
| **Capture** | Full-page or visible-area screenshots as PNG, JPG, WebP or multi-page PDF. Fixed headers appear once, long pages are split without losing quality, and optional HD (2×) and 4K modes re-render the page at higher resolution. |

You can also **right-click** selected text and choose **“Inspect font of …”** for a quick font-details dialog.

## Installation

### From source (developer mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/saad-hasnain-dev/uxearly-inspect.git
   ```
2. Open `chrome://extensions` in Chrome (or any Chromium browser, version 116 or later).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the cloned `uxearly-inspect` folder.
5. Pin the icon from the puzzle-piece menu so it's always one click away.

The repository already includes a built `content.js`, so no build step is needed to try it.

## Usage

Open any regular website, then click the toolbar icon or press the shortcut.

| Action | Shortcut |
|---|---|
| Open / close the panel | <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> (<kbd>⌥</kbd> <kbd>⇧</kbd> <kbd>I</kbd> on macOS) |
| Stop inspecting, selecting or a capture | <kbd>Esc</kbd> |
| Move the panel | Drag its header (the position is remembered) |
| Font of a selection | Select text → right-click → “Inspect font of …” |

You can change the shortcut at `chrome://extensions/shortcuts`.

### Optional settings

Open the extension's **Settings** page (from the panel or `chrome://extensions` → Details → Extension options) to turn on:

- **Image and font access on all sites.** Some CDNs block other sites from reading their files. Granting this optional host permission lets the extension convert those images and list fonts from stylesheets hosted there. Downloading an original image never needs it.
- **High-resolution screenshots.** HD (2×) and 4K capture use Chrome's debugging interface to re-render the page. Chrome shows a “started debugging this browser” bar while a capture runs; it closes when the capture finishes.

### Limitations

Chrome doesn't allow extensions on its own pages (`chrome://`, the new tab page, the Chrome Web Store, the built-in PDF viewer). If the icon shows a red **!**, open a normal website instead.

## Development

### Project structure

```
uxearly-inspect/
├── manifest.json        # Manifest V3 config
├── background.js        # Service worker: injection, context menu, downloads, capture, AVIF encoding
├── content.js           # Built bundle injected into pages (generated, do not edit by hand)
├── src/
│   ├── engine.js        # Page analysis: styles, fonts, colors, tokens, code generation
│   └── ui.js            # Inspector panel UI
├── options.*            # Settings page (HTML, CSS, JS)
├── build.sh             # Builds content.js from src/
├── fonts/               # Bundled Inter and JetBrains Mono (latin subsets)
├── icons/               # Extension icons and logo
├── vendor/              # Squoosh AVIF encoder (JS + WASM)
├── PRIVACY.md           # Privacy policy
└── STORE_LISTING.md     # Chrome Web Store listing copy and permission justifications
```

### Building

Edit the readable sources in `src/`, then rebuild `content.js`:

```bash
./build.sh
```

The script concatenates `src/engine.js` and `src/ui.js`, stamps a build ID, and minifies the result with [esbuild](https://esbuild.github.io/) via `npx` (whitespace and syntax only; names are kept and nothing is obfuscated). It requires **Node.js**. If esbuild isn't available, it ships the readable, unminified bundle instead. Every output file is syntax-checked with `node --check`.

On Windows, run it from Git Bash or WSL.

After building, click the reload icon for the extension on `chrome://extensions`, then reopen the panel on your tab.

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read and capture the current page only after you open the extension on it. |
| `scripting` | Inject the inspector panel into that tab, and read React component data for code export. |
| `downloads` | Save images, screenshots and exported files. |
| `storage` | Remember preferences (theme, formats, panel position) locally. |
| `contextMenus` | Add “Inspect font of …” to the right-click menu for selected text. |
| Optional: `debugger` | HD and 4K screenshots. Requested only when you turn it on in Settings. |
| Optional: all sites | Read cross-origin images and font stylesheets. Requested only when you turn it on in Settings. |

## Privacy

No accounts, no analytics, no tracking, no servers. The extension runs on a tab only after you open it there, everything is processed locally in your browser, and all code (including the AVIF encoder) ships inside the package. See [PRIVACY.md](PRIVACY.md) for the full policy.

Please respect copyright and font licenses: only download images, fonts and other assets you have the rights to use.

## Credits

- AVIF encoder from [Squoosh](https://github.com/GoogleChromeLabs/squoosh), Apache-2.0 ([license](vendor/LICENSE-avif.txt))
- [Inter](https://rsms.me/inter/), SIL Open Font License ([license](fonts/LICENSE-Inter.txt))
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/), SIL Open Font License ([license](fonts/LICENSE-JetBrainsMono.txt))

---

Made by [Uxearly](https://uxearly.com).

# Chrome Web Store submission — Uxearly Inspect

Copy these into the Developer Dashboard fields.

## Single purpose
Inspect, measure and extract the design of a web page (its typography, colors, spacing, design tokens, element code, image and font assets, and full-page screenshots) for designers and front-end developers.

## Short description (≤132 chars)
Inspect fonts and colors, extract a site's design system, copy CSS or React code, save images and full-page screenshots.

## Detailed description
Uxearly Inspect is one inspector for everything you need from a web page's design.

FONTS — Hover any text to see its font family, the font actually rendered, size (px and rem), weight, line height, letter spacing, color and WCAG contrast. Pin it to copy its typography CSS, full element CSS or HTML. See every font used on the page and download the font files (WOFF2, WOFF, TTF, OTF) it loads, including Google Fonts.

MEASURE — Hover any element for its size, padding, margin and flex/grid gaps. Click to pin one and hover another for exact distances. Hover text to measure a single letter and the gap to the next. Drag anywhere for a free ruler. px or rem.

RIGHT-CLICK — Select text, right-click and choose “Inspect font of …” for a dialog with the letters and their font family, size, weight, line height, tracking and color.

COLORS — Pick any pixel on screen with the eyedropper, or browse the page's full palette filtered by text, fill, border, icons and gradients. Copy in HEX, RGB or HSL.

TOKENS — Turn any page into a design system: color tokens, text styles, spacing scale, radii, shadows, breakpoints and existing CSS variables. Export as CSS variables, W3C design tokens (JSON) or a Tailwind theme.

CODE — Select any element to get clean CSS that matches the live markup. On React and Next.js sites, get a reconstructed JSX component with a CSS module, props and event handlers, including next/link and next/image.

IMAGES — Find every image, CSS background, inline SVG, favicon and social image on the page. Download originals or convert to PNG, JPG, WebP or AVIF, one at a time or all at once.

CAPTURE — Save the full page or the visible area as PNG, JPG, WebP or a multi-page PDF. Fixed headers appear once, long pages are split without losing quality, and optional HD (2×) and 4K modes re-render the page at higher resolution.

Private by design: no accounts, no tracking, nothing leaves your browser. Runs only when you open it.

## Permission justifications
- activeTab — The inspector reads the current page only after the user clicks the toolbar icon or presses the shortcut.
- scripting — Injects the inspector panel into the active tab, and reads React component data from the page to generate component code.
- activeTab (also) — Captures the visible tab for screenshots the user starts.
- downloads — Saves images, screenshots and exported design-token / code files the user chooses to download.
- Optional debugger — Requested only when the user turns on "High-resolution screenshots" in Settings. Used only while a screenshot the user started is running, to call Page.captureScreenshot at 2× or 4K on that tab; detached immediately after. No other debugging methods are used.
- contextMenus — Adds one item, “Inspect font of …”, for selected text. Clicking it shows that text's font details on the current tab.
- storage — Saves the user's preferences (theme, color format, image format, panel position) locally.
- Optional host permission (<all_urls>) — Requested only when the user turns on "Image access on all sites" in Settings. Lets the extension read image files and font stylesheets hosted on a different domain (e.g. a CDN) so the user can convert images and download the fonts a page uses. Used only when the user opens the Images or Fonts tab, downloads, or opens image details.

## Remote code
No. All JavaScript and WebAssembly (AVIF encoder from Squoosh, Apache-2.0) is included in the package.

## Data usage
Does not collect or transmit any user data. Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

## Privacy policy
Host PRIVACY.md at a public URL (e.g. https://uxearly.com/inspect/privacy) and paste that URL in the dashboard.

## Assets to prepare
- 128×128 icon (icons/icon128.png included)
- At least one 1280×800 screenshot per tab
- Optional 440×280 small promo tile

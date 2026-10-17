# Uxearly Inspect — Privacy Policy

_Last updated: 17 October 2026_

Uxearly Inspect is a Chrome extension that helps designers and developers inspect fonts, colors, design tokens, code and images on web pages.

## What we collect

Nothing. Uxearly Inspect does not collect, store, sell or transmit any personal data, browsing history, page content or usage analytics. There are no accounts and no servers.

## How the extension works with your data

- **Runs only when you ask.** The extension reads a page only after you click its toolbar icon or press its keyboard shortcut on that tab (Chrome's `activeTab` permission).
- **Stays on your device.** Everything you inspect is processed locally in your browser. Copied values go to your clipboard and exported files go to your Downloads folder.
- **Images.** When you download or open the details of an image, the extension requests that image file from the site that hosts it, the same way the page itself loaded it, to save or convert it. The image is not sent anywhere else.
- **Optional permission.** If you choose to allow "image access on all sites" in Settings, the extension can read image files hosted on other domains (for example a CDN) so it can convert them. It is used only when you start a download or open image details, and you can turn it off at any time.
- **Fonts.** To list the font files a page uses, the extension reads that page's stylesheets, and when you click download it saves the font file the page already loads. Fonts are often licensed; download only fonts you have the rights to use.
- **Screenshots.** Captures are made locally from the tab you're viewing and saved to your Downloads folder. If you turn on high-resolution capture in Settings, Chrome's debugging interface is used only while a capture you started is running, on that tab, and is released right after.
- **Right-click menu.** Choosing “Inspect font of …” reads the font styles of the text you selected, on that tab only.
- **Preferences.** Theme, color format, image format, quality and panel position are saved with `chrome.storage.local` on your device only.
- **No remote code.** All code, including the bundled AVIF encoder, ships inside the extension package.

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read and capture the current page only after you open the extension on it. |
| `scripting` | Inject the inspector panel into that tab, and read React component data for code export. |
| `downloads` | Save images, screenshots and exported files to your Downloads folder. |
| `storage` | Remember your preferences locally. |
| `contextMenus` | Add “Inspect font of …” to the right-click menu for selected text. |
| Optional: `debugger` | Re-render the current tab at 2× or 4K for high-resolution screenshots. Requested only when you turn it on. |
| Optional: access to all sites | Read image files and font stylesheets hosted on other domains so images can be converted and fonts listed. Requested only when you turn it on. |

## Contact

Questions: https://uxearly.com

#!/usr/bin/env bash
# Builds content.js from src/ (engine + UI).
# The shipped file is minified (whitespace + syntax only; names kept, nothing obfuscated) for faster
# parsing on every page. Readable sources live in src/. Requires Node; uses esbuild via npx.
set -euo pipefail
cd "$(dirname "$0")"
BUILD_ID="$(date +%Y%m%d%H%M%S)-$RANDOM"
cat src/engine.js src/ui.js | sed "s/__UXI_BUILD__/$BUILD_ID/" > content.src.js
node --check content.src.js
if npx --yes esbuild@0.24.0 --version >/dev/null 2>&1; then
  npx --yes esbuild@0.24.0 content.src.js --minify-whitespace --minify-syntax --legal-comments=inline --charset=utf8 --target=chrome116 --outfile=content.js --log-level=warning
  rm content.src.js
else
  mv content.src.js content.js   # no esbuild available: ship the readable build
fi
node --check content.js && node --check background.js && node --check options.js

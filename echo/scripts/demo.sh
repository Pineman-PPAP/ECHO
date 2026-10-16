#!/usr/bin/env bash
# Builds ECHO and opens it full-screen in Chromium (or Chrome) for the demo.
# Usage: npm run demo            or   npm run demo -- '?debug=1'
# Uses its own browser profile (~/.cache/echo-demo-browser), so it opens full-screen even when your normal
# browser is already running. First run: the browser asks for camera + microphone once; the profile remembers it.
# Close the browser window to stop the server. ECHO_BROWSER=/path/to/browser overrides the browser choice.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f public/models/face_landmarker.task ] || npm run assets
npm run build
npm run preview &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf http://127.0.0.1:4173/ >/dev/null && break; sleep 0.1; done

BROWSER="${ECHO_BROWSER:-}"
if [ -z "$BROWSER" ]; then
  for b in chromium chromium-browser google-chrome-stable google-chrome; do
    if command -v "$b" >/dev/null; then BROWSER="$b"; break; fi
  done
fi
if [ -z "$BROWSER" ]; then
  echo "No Chromium or Chrome found. Install one (sudo pacman -S chromium) or open http://127.0.0.1:4173/${1:-} yourself." >&2
  wait $SERVER
fi
"$BROWSER" --user-data-dir="$HOME/.cache/echo-demo-browser" --no-first-run --no-default-browser-check \
  --start-fullscreen "http://127.0.0.1:4173/${1:-}"

#!/usr/bin/env bash
set -euo pipefail

# Linux/WSL port of build.ps1 + patch-html.ps1.
# Packages the repo into a .love, runs the love.js web build, then applies the
# canonical HTML/CSS, bridge/worker patches, and game.data chunking.

cd "$(dirname "$0")"

OUT="balatro-orce.love"
ZIPOUT="$OUT.zip"
OUTDIR="Balatro"
SRC_RELEASE="love.js/src/release"

echo "Building $OUT..."

# ---- .game_data_version.txt bump (mirror patch-html.ps1:10-22) ----
TAG=1
if [ -f ".game_data_version.txt" ]; then
  RAW=$(cat .game_data_version.txt)
  if echo "$RAW" | grep -qE '^[0-9]+$'; then
    if [ "$RAW" -ge 1 ]; then
      TAG=$((RAW + 1))
    fi
  fi
fi
printf "%s" "$TAG" > .game_data_version.txt
URL="./game.data?v=$TAG"

# ---- preserve files that exist only inside Balatro/ ----
BAK=$(mktemp -d)
trap 'rm -rf "$BAK"' EXIT
[ -f "$OUTDIR/favicon.png" ] && cp "$OUTDIR/favicon.png" "$BAK/"
[ -f "$OUTDIR/coi-serviceworker.js" ] && cp "$OUTDIR/coi-serviceworker.js" "$BAK/"

# ---- package .love (mirror build.ps1:15-66) ----
rm -f "$OUT" "$ZIPOUT"
zip -q -9 -r "$ZIPOUT" . \
  -x '.git/*' \
  -x 'Balatro/*' \
  -x '*.love' \
  -x '*.ps1' \
  -x '*.py' \
  -x '*.md' \
  -x '*.gitignore' \
  -x 'build.sh' \
  -x 'build.ps1' \
  -x 'serve.py' \
  -x 'README.md' \
  -x 'love.js/node_modules/*' \
  -x 'love.js/build/*'
mv "$ZIPOUT" "$OUT"
SIZE=$(stat -c%s "$OUT")
echo "Packaged $OUT ($SIZE bytes)"

# ---- ensure love.js CLI deps present ----
if [ ! -d "love.js/node_modules" ]; then
  echo "Installing love.js CLI dependencies (npm install --omit=dev in love.js/)."
  (cd love.js && npm install --omit=dev)
fi

# ---- memory sizing (mirror build.ps1:74-79) ----
MEM=$(python3 - "$SIZE" <<'PY'
import math, sys
size = int(sys.argv[1])
step = 16 * 1024 * 1024
rec = math.ceil(size * 1.35 / step) * step
print(int(max(256 * 1024 * 1024, rec)))
PY
)
echo "love.js memory: $MEM bytes"

# ---- love.js web build (mirror build.ps1:117-143) ----
rm -rf "$OUTDIR"
node love.js/index.js "$OUT" "$OUTDIR" -t Balatro -m "$MEM"

# ---- canonical index.html / love.css (mirror patch-html.ps1:31-889) ----
awk '/^\$indexHtml = *@'"'"'$/ {f=1; next} f && /^'"'"'@$/ {f=0; exit} f {print}' patch-html.ps1 > "$BAK/index.html.tmpl"
awk '/^\$css = *@'"'"'$/ {f=1; next} f && /^'"'"'@$/ {f=0; exit} f {print}' patch-html.ps1 > "$BAK/love.css.tmpl"
sed "s|\"./game.data\"|\"$URL\"|" "$BAK/index.html.tmpl" > "$OUTDIR/index.html"
cat "$BAK/love.css.tmpl" > "$OUTDIR/theme/love.css"
echo "Wrote $OUTDIR/index.html and $OUTDIR/theme/love.css (game.data URL: $URL)"

# ---- copy bridge + service worker (mirror patch-html.ps1:891-909) ----
cp browser_fs.js "$OUTDIR/browser_fs.js"
cp coi-serviceworker.js "$OUTDIR/coi-serviceworker.js"
[ -f "$BAK/favicon.png" ] && cp "$BAK/favicon.png" "$OUTDIR/favicon.png"

# ---- restore runtime artifacts if missing (mirror patch-html.ps1:911-925) ----
for artifact in love.wasm love.worker.js; do
  if [ ! -f "$OUTDIR/$artifact" ]; then
    cp "$SRC_RELEASE/$artifact" "$OUTDIR/$artifact"
    echo "Restored missing $OUTDIR/$artifact from $SRC_RELEASE"
  fi
done

# ---- split game.data into <=100MiB chunks, drop the full file (patch-html.ps1:927-944) ----
python3 - <<'PY'
import math
src = "Balatro/game.data"
data = open(src, "rb").read()
chunk = 104857600
count = math.ceil(len(data) / chunk)
for i in range(count):
    open(f"{src}.{i}", "wb").write(data[i*chunk:(i+1)*chunk])
print(f"Split game.data into {count} chunk(s)")
PY
rm -f "$OUTDIR/game.data"

# ---- patch game.js: cache URL, heap-copy fix, loader progress/fail hooks
# (mirror patch-html.ps1:946-966 plus the webLoader hooks seen in the deployed
# Balatro/game.js) ----
python3 - "$URL" <<'PY'
import re, sys
url = sys.argv[1]
path = "Balatro/game.js"
c = open(path, encoding="utf-8", errors="surrogateescape").read()

heap = re.compile(
    r"var ptr = Module\['getMemory'\]\(byteArray\.length\);"
    r"\s*Module\['HEAPU8'\]\.set\(byteArray, ptr\);"
    r"\s*DataRequest\.prototype\.byteArray = Module\['HEAPU8'\]\.subarray\(ptr, ptr\+byteArray\.length\);"
)
c = heap.sub("DataRequest.prototype.byteArray = byteArray;", c, count=1)

fail_hook_indent = '          '
def require_replace(s, old, new):
    if old not in s:
        raise SystemExit(f"game.js pattern not found:\n{old!r}")
    return s.replace(old, new, 1)

# download progress/copy
c = require_replace(c,
    "if (Module['setStatus']) Module['setStatus']('Downloading data... (' + loaded + '/' + total + ')');",
    "if (Module['setStatus']) Module['setStatus']('Downloading game data', Math.min(event.loaded, total), total);")

# fail hooks on xhr.onerror and non-200 onload
c = require_replace(c,
    "      xhr.onerror = function(event) {\n        throw new Error(\"NetworkError for: \" + packageName);",
    "      xhr.onerror = function(event) {\n        try { if (window.__balatroWebLoader) window.__balatroWebLoader.fail(); } catch (e) {}\n        throw new Error(\"NetworkError for: \" + packageName);")
c = require_replace(c,
    "        } else {\n          throw new Error(xhr.statusText + \" : \" + xhr.responseURL);",
    "        } else {\n          try { if (window.__balatroWebLoader) window.__balatroWebLoader.fail(); } catch (e) {}\n          throw new Error(xhr.statusText + \" : \" + xhr.responseURL);")

# cache-load status
c = require_replace(c,
    "                console.info('loading ' + PACKAGE_NAME + ' from cache');\n                fetchCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME, processPackageData, preloadFallback);",
    "                console.info('loading ' + PACKAGE_NAME + ' from cache');\n                if (Module['setStatus']) Module['setStatus']('Loading game data from cache');\n                fetchCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME, processPackageData, preloadFallback);")

# cache URL
c = c.replace("/game.love", url)
c = re.sub(r'\./game\.data(?:\?v=\d+)?', url, c)
open(path, "w", encoding="utf-8", errors="surrogateescape").write(c)
print("Patched game.js")
PY

# ---- patch love.js: expose Module.FS + OpenAL vector handlers (patch-html.ps1:968-1009) ----
python3 - <<'PY'
import re
path = "Balatro/love.js"
c = open(path, encoding="utf-8", errors="surrogateescape").read()
n0 = c
c = c.replace('Module["FS_unlink"]=FS.unlink;', 'Module["FS_unlink"]=FS.unlink;Module["FS"]=FS;')
for st in (4115, 4114, 4116):
    c = re.sub(
        r"AL\.setSourceState\(HEAP32\[pSourceIds\+i\*4>>2\],%d\)" % st,
        lambda m, st=st: "var src=AL.currentCtx.sources[HEAP32[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,%d)}" % st,
        c,
    )
    c = re.sub(
        r"AL\.setSourceState\(GROWABLE_HEAP_I32\(\)\[pSourceIds\+i\*4>>2\],%d\)" % st,
        lambda m, st=st: "var src=AL.currentCtx.sources[GROWABLE_HEAP_I32()[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,%d)}" % st,
        c,
    )
changed = "no" if c == n0 else "yes"
open(path, "w", encoding="utf-8", errors="surrogateescape").write(c)
print(f"Patched love.js (changed: {changed})")
PY

echo
echo "Done!"
echo "  - Run with Love2D: love $OUT"
echo "  - Web build output: $OUTDIR"
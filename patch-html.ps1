# Post-build script: overwrite the generated Balatro/index.html and Balatro/theme/love.css
# using the project's canonical HTML/CSS contents. This ensures the built package
# always contains the exact files provided by the repo attachments.

$htmlPath = "Balatro\index.html"
$cssDir = "Balatro\theme"
$cssPath = Join-Path $cssDir "love.css"
$browserFsSource = "browser_fs.js"
$browserFsDest = "Balatro\browser_fs.js"
$gameDataVersionFile = ".game_data_version.txt"
$gameDataCacheTag = 1
if (Test-Path $gameDataVersionFile) {
  $rawVersion = (Get-Content $gameDataVersionFile -Raw)
  if ($null -ne $rawVersion) {
    [int]$parsedVersion = 0
    if ([int]::TryParse($rawVersion.Trim(), [ref]$parsedVersion) -and $parsedVersion -ge 1) {
      $gameDataCacheTag = $parsedVersion + 1
    }
  }
}
Set-Content $gameDataVersionFile -Value $gameDataCacheTag -NoNewline
$gameDataUrl = "./game.data?v=$gameDataCacheTag"

Write-Host "Writing canonical index.html and theme/love.css to Balatro..." -ForegroundColor Cyan
Write-Host "Using game.data cache version: v$gameDataCacheTag" -ForegroundColor Cyan

# Ensure output directory exists
if (-not (Test-Path "Balatro")) { New-Item -ItemType Directory -Path "Balatro" | Out-Null }
if (-not (Test-Path $cssDir)) { New-Item -ItemType Directory -Path $cssDir | Out-Null }

# Canonical HTML content (from repository attachments)
$indexHtml = @'
<!doctype html>
<html lang="en-us">
  <head>
    <script src="coi-serviceworker.js"></script>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, minimum-scale=1, maximum-scale=1">
    <title>Balatro</title>
    <link rel="icon" type="image/png" href="favicon.png">

    <!-- Load custom style sheet -->
    <link rel="stylesheet" type="text/css" href="theme/love.css">
  </head>
  <body>
    <center>
      <div>
        <canvas id="loadingCanvas" oncontextmenu="event.preventDefault()" width="800" height="600"></canvas>
        <canvas id="canvas" oncontextmenu="event.preventDefault()" onclick="goFullScreen();"></canvas>
      </div>
    </center>

    <script type='text/javascript'>
        function isFullscreenActive() {
          return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
        }

        function requestElementFullscreen(el) {
          if (!el) return null;
          if (el.requestFullscreen) return el.requestFullscreen();
          if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
          if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
          if (el.msRequestFullscreen) return el.msRequestFullscreen();
          if (el.requestFullScreen) return el.requestFullScreen();
          return null;
        }

        function goFullScreen(){
              var canvas = document.getElementById("canvas");
              if (!canvas) return;
              canvas.focus();
              if (isFullscreenActive()) return;

              var requestPromise = requestElementFullscreen(canvas);
              if (!requestPromise && document.documentElement) {
                requestPromise = requestElementFullscreen(document.documentElement);
              }
              if (requestPromise && requestPromise.catch) {
                requestPromise.catch(function(err){
                  try {
                    var retry = requestElementFullscreen(document.documentElement);
                    if (retry && retry.catch) retry.catch(function(){});
                  } catch (_) {}
                  console.debug('Fullscreen request failed', err);
                });
              }
        }

      // Virtual cursor system for pointer lock
      var virtualCursor = {
        x: 0,
        y: 0,
        locked: false,
        canvas: null,
        lastUpdateTime: 0
      };

      function initVirtualCursor() {
        virtualCursor.canvas = document.getElementById("canvas");
        
        // Initialize position to center
        var rect = virtualCursor.canvas.getBoundingClientRect();
        virtualCursor.x = rect.width / 2;
        virtualCursor.y = rect.height / 2;

        // Request pointer lock only when already in fullscreen to avoid conflicting with fullscreen gesture.
        virtualCursor.canvas.addEventListener('click', function() {
          if (!isFullscreenActive() || virtualCursor.locked) return;
          virtualCursor.canvas.requestPointerLock = virtualCursor.canvas.requestPointerLock ||
                                                     virtualCursor.canvas.mozRequestPointerLock ||
                                                     virtualCursor.canvas.webkitRequestPointerLock;
          if (virtualCursor.canvas.requestPointerLock) {
            try { virtualCursor.canvas.requestPointerLock(); } catch (_) {}
          }
        });

        // Listen for pointer lock changes
        document.addEventListener('pointerlockchange', lockChangeAlert, false);
        document.addEventListener('mozpointerlockchange', lockChangeAlert, false);
        document.addEventListener('webkitpointerlockchange', lockChangeAlert, false);

        // Handle mouse movement when locked
        document.addEventListener('mousemove', function(e) {
          if (virtualCursor.locked) {
            var rect = virtualCursor.canvas.getBoundingClientRect();
            
            // Update virtual cursor position with movement deltas
            virtualCursor.x += e.movementX;
            virtualCursor.y += e.movementY;

            // Clamp to canvas bounds
            virtualCursor.x = Math.max(0, Math.min(rect.width, virtualCursor.x));
            virtualCursor.y = Math.max(0, Math.min(rect.height, virtualCursor.y));

            // Throttle updates to ~60fps
            var now = Date.now();
            if (now - virtualCursor.lastUpdateTime > 16) {
              virtualCursor.lastUpdateTime = now;
            }
          }
        }, false);
        
        console.log('Virtual cursor system initialized');
      }

      function lockChangeAlert() {
        var canvas = virtualCursor.canvas;
        if (document.pointerLockElement === canvas ||
            document.mozPointerLockElement === canvas ||
            document.webkitPointerLockElement === canvas) {
          console.log('Pointer locked - virtual cursor enabled');
          virtualCursor.locked = true;
          canvas.style.cursor = 'none';
        } else {
          console.log('Pointer unlocked - virtual cursor disabled');
          virtualCursor.locked = false;
          canvas.style.cursor = 'default';
        }
      }

      function onFullscreenChanged() {
        resizeLoveCanvases();
        pollAudioUnlock();
        if (!isFullscreenActive()) {
          virtualCursor.locked = false;
          if (virtualCursor.canvas) virtualCursor.canvas.style.cursor = 'default';
        }
      }

      // Audio unlock overlay for browsers that block autoplay
      var audioUnlock = {
        overlay: null,
        ctx: null,
        unlocked: false,
        userInteracted: false,
        firstInteractionAt: 0
      };

      function hideAudioUnlockOverlay() {
        if (audioUnlock.overlay) {
          try { audioUnlock.overlay.style.display = 'none'; } catch(e){}
        }
      }

      function createAudioUnlockOverlay() {
        if (audioUnlock.unlocked) return;
        if (audioUnlock.overlay) {
          try { audioUnlock.overlay.style.display = 'flex'; } catch (e) {}
          return;
        }
        if (finalizeAudioUnlockIfReady()) return;
        try {
          audioUnlock.overlay = document.createElement('div');
          audioUnlock.overlay.id = 'audio-unlock-overlay';
          audioUnlock.overlay.style.position = 'fixed';
          audioUnlock.overlay.style.left = 0;
          audioUnlock.overlay.style.top = 0;
          audioUnlock.overlay.style.width = '100%';
          audioUnlock.overlay.style.height = '100%';
          audioUnlock.overlay.style.display = 'flex';
          audioUnlock.overlay.style.alignItems = 'center';
          audioUnlock.overlay.style.justifyContent = 'center';
          audioUnlock.overlay.style.background = 'rgba(32,32,32,32)';
          audioUnlock.overlay.style.color = 'white';
          audioUnlock.overlay.style.fontFamily = 'sans-serif';
          audioUnlock.overlay.style.fontSize = '20px';
          audioUnlock.overlay.style.zIndex = 999999;
          audioUnlock.overlay.style.cursor = 'pointer';
          audioUnlock.overlay.innerText = 'Click or press any key to enable audio';
          audioUnlock.overlay.addEventListener('click', unlockAudioOnce);
          document.body.appendChild(audioUnlock.overlay);
  } catch (e) { }
      }

      function collectAudioContexts() {
        var contexts = [];
        try {
          if (window.Module && Module.SDL2 && Module.SDL2.audioContext) {
            contexts.push(Module.SDL2.audioContext);
          }
        } catch (e) { }
        try {
          if (window.AL && AL.currentCtx && AL.currentCtx.audioCtx) {
            contexts.push(AL.currentCtx.audioCtx);
          }
          if (window.AL && AL.sharedCaptureAudioCtx) {
            contexts.push(AL.sharedCaptureAudioCtx);
          }
        } catch (e) { }
        return contexts;
      }

      function finalizeAudioUnlockIfReady() {
        var contexts = collectAudioContexts();
        var hasReadyContext = false;
        for (var i = 0; i < contexts.length; i++) {
          var ctx = contexts[i];
          if (ctx && ctx.state !== 'suspended') {
            hasReadyContext = true;
            break;
          }
        }

        if (!hasReadyContext) {
          var now = Date.now();
          if (audioUnlock.userInteracted && audioUnlock.firstInteractionAt > 0 && (now - audioUnlock.firstInteractionAt) > 2500) {
            hasReadyContext = true;
          }
        }

        if (!hasReadyContext) return false;

        audioUnlock.unlocked = true;
        hideAudioUnlockOverlay();
        window.removeEventListener('click', unlockAudioOnce);
        window.removeEventListener('keydown', unlockAudioOnce);
        window.removeEventListener('touchstart', unlockAudioOnce);
        return true;
      }

      function unlockAudioOnce(e) {
        if (audioUnlock.unlocked) return;
        if (!audioUnlock.userInteracted) {
          audioUnlock.userInteracted = true;
          audioUnlock.firstInteractionAt = Date.now();
        }
        try {
          var contexts = collectAudioContexts();
          for (var i = 0; i < contexts.length; i++) {
            var ctx = contexts[i];
            if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
              ctx.resume().then(function(){ finalizeAudioUnlockIfReady(); }).catch(function(err){ });
            }
          }
        } catch (err) { }

        finalizeAudioUnlockIfReady();
      }

      function pollAudioUnlock() {
        if (audioUnlock.unlocked) return;
        try {
          unlockAudioOnce();
          if (!audioUnlock.unlocked && audioUnlock.userInteracted) {
            createAudioUnlockOverlay();
          }
        } catch (_) {}
      }

      // Attach global listeners to unlock audio on first user gesture
      window.addEventListener('click', unlockAudioOnce);
      window.addEventListener('keydown', unlockAudioOnce);
      window.addEventListener('touchstart', unlockAudioOnce);
      setInterval(pollAudioUnlock, 1000);
      // Create overlay after a short delay so it doesn't block immediate interactions
      setTimeout(function() { createAudioUnlockOverlay(); }, 500);
      function setCanvasDimensions(el, width, height) {
        if (!el) { return; }
        if (el.width !== width) { el.width = width; }
        if (el.height !== height) { el.height = height; }
        el.style.width = width + 'px';
        el.style.height = height + 'px';
      }

      function resizeLoveCanvases() {
        var width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 800;
        var height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 600;
        width = Math.max(1, width || 0);
        height = Math.max(1, height || 0);
        var canvas = document.getElementById('canvas');
        var loadingCanvasEl = document.getElementById('loadingCanvas');
        setCanvasDimensions(canvas, width, height);
        setCanvasDimensions(loadingCanvasEl, width, height);
        try {
          if (typeof Module !== 'undefined' && Module && Module.canvas === canvas) {
            if (typeof Module.setCanvasSize === 'function') {
              Module.setCanvasSize(width, height, false);
            } else if (Module.ctx && Module.ctx.canvas) {
              setCanvasDimensions(Module.ctx.canvas, width, height);
            }
          }
        } catch (err) {
          console.warn('resizeLoveCanvases: unable to propagate size', err);
        }
      }

      window.addEventListener('resize', resizeLoveCanvases);
      window.addEventListener('orientationchange', resizeLoveCanvases);
      document.addEventListener('fullscreenchange', onFullscreenChanged);
      document.addEventListener('webkitfullscreenchange', onFullscreenChanged);
      document.addEventListener('mozfullscreenchange', onFullscreenChanged);
      document.addEventListener('MSFullscreenChange', onFullscreenChanged);
      resizeLoveCanvases();
      var loadingContext = document.getElementById('loadingCanvas').getContext('2d');
      function drawLoadingText(text) {
        var canvas = loadingContext.canvas;

        loadingContext.fillStyle = "rgb(32, 32, 32)";
        loadingContext.fillRect(0, 0, canvas.scrollWidth, canvas.scrollHeight);

        loadingContext.font = '2em arial';
        loadingContext.textAlign = 'center'
        loadingContext.fillStyle = "rgb(255, 255, 255)";
        loadingContext.fillText(text, canvas.scrollWidth / 2, canvas.scrollHeight / 2);

        loadingContext.fillText("Powered By Emscripten.", canvas.scrollWidth / 2, canvas.scrollHeight / 4);
        loadingContext.fillText("Powered By LÖVE.", canvas.scrollWidth / 2, canvas.scrollHeight / 4 * 3);
      }

      window.onload = function () { window.focus(); };
      window.onclick = function () { window.focus(); };

      window.addEventListener("keydown", function(e) {
        // space and arrow keys
        if([32, 37, 38, 39, 40].indexOf(e.keyCode) > -1) {
          e.preventDefault();
        }
      }, false);

        var Module = {
      arguments: ["./game.data"],
        locateFile: function(path, scriptDir) {
          return (scriptDir || '') + path;
        },
        INITIAL_MEMORY: 134217728,
        printErr: console.error.bind(console),
        canvas: (function() {
          var canvas = document.getElementById('canvas');

          // As a default initial behavior, pop up an alert when webgl context is lost. To make your
          // application robust, you may want to override this behavior before shipping!
          // See http://www.khronos.org/registry/webgl/specs/latest/1.0/#5.15.2
          canvas.addEventListener("webglcontextlost", function(e) { alert('WebGL context lost. You will need to reload the page.'); e.preventDefault(); }, false);

          return canvas;
        })(),
        setStatus: function(text) {
          if (text) {
            drawLoadingText(text);
          } else if (Module.remainingDependencies === 0) {
            document.getElementById('loadingCanvas').style.display = 'none';
            document.getElementById('canvas').style.visibility = 'visible';
          }
        },
        totalDependencies: 0,
        remainingDependencies: 0,
        monitorRunDependencies: function(left) {
          this.remainingDependencies = left;
          this.totalDependencies = Math.max(this.totalDependencies, left);
          Module.setStatus(left ? 'Preparing... (' + (this.totalDependencies-left) + '/' + this.totalDependencies + ')' : 'All downloads complete.');
        }
      };
      Module.setStatus('Downloading...');
      window.onerror = function(event) {
        // TODO: do not warn on ok events like simulating an infinite loop or exitStatus
        Module.setStatus('Exception thrown, see JavaScript console');
        Module.setStatus = function(text) {
          if (text) Module.printErr('[post-exception status] ' + text);
        };
      };

      function ensureBalatroBridgeLoaded() {
        if (window.__balatroBridgeLoading) return;
        if (typeof Module === 'undefined' || !Module || (!Module.FS && !(typeof window !== 'undefined' && window.FS))) {
          setTimeout(ensureBalatroBridgeLoaded, 200);
          return;
        }
        if (Module.BalatroFS) return;
        window.__balatroBridgeLoading = true;
        var s = document.createElement('script');
        s.src = 'browser_fs.js';
        s.onload = function(){ window.__balatroBridgeLoading = false; };
        s.onerror = function(){ window.__balatroBridgeLoading = false; console.warn('BalatroFS: failed to load browser_fs.js'); };
        document.body.appendChild(s);
      }

      var applicationLoad = function(e) {
        var loveInstance = Love(Module);
        if (loveInstance && typeof loveInstance.then === 'function') {
          loveInstance.then(function(instance){
            if (instance) {
              Module = instance;
              window.Module = instance;
              if (instance.FS) { window.FS = instance.FS; }
            }
            ensureBalatroBridgeLoaded();
          }).catch(function(err){
            console.warn('Love init failed', err);
          });
        } else if (loveInstance) {
          Module = loveInstance;
          window.Module = loveInstance;
          if (loveInstance.FS) { window.FS = loveInstance.FS; }
          ensureBalatroBridgeLoaded();
        }
        resizeLoveCanvases();
        ensureBalatroBridgeLoaded();
        // Initialize virtual cursor after Love.js loads
        setTimeout(function() {
          resizeLoveCanvases();
          initVirtualCursor();
          ensureBalatroBridgeLoaded();
        }, 1000);
      }
  </script>
  <script type="text/javascript" src="browser_fs.js"></script>
  <script type="text/javascript" src="game.js"></script>
    <script async type="text/javascript" src="love.js" onload="applicationLoad(this)"></script>
  </body>
</html>
'@

# Ensure each build references a unique game.data URL so browser cache cannot serve stale Lua/assets.
$indexHtml = $indexHtml -replace '"\./game\.data"', ('"' + $gameDataUrl + '"')

# Canonical CSS content (from repository attachments)
$css = @'
* {
    box-sizing: border-box;
}

h1 {
    font-family: arial;
    color: rgb( 11, 86, 117 );
}

body {
    background-repeat: no-repeat;
    font-family: arial;
    margin: 0;
    padding: none;
    background-color: rgb(32, 32, 32);
    color: rgb(255, 255, 255);
}

footer {
    font-family: arial;
    font-size: 12px;
    padding-left: 10px;
    position:absolute;
    bottom: 0;
    width: 100%;
}

/* Links */
a {
    text-decoration: none;
}
a:link {
    color: rgb( 233, 73, 154 );
}
a:visited {
    color: rgb( 110, 30, 71 );
}
a:hover {
    color: rgb( 252, 207, 230 );
}

/* the canvas *must not* have any border or padding, or mouse coords will be wrong */
#canvas {
    padding-right: 0;
    display: block;
    border: 0px none;
    visibility: hidden;
    width: 100%;
    height: 100%;
}
'@

# Write files
Set-Content $htmlPath -Value $indexHtml -NoNewline
Set-Content $cssPath -Value $css -NoNewline

Write-Host "Wrote $htmlPath and $cssPath" -ForegroundColor Green

# Copy browser_fs.js into web output so the bridge code is available
if (Test-Path $browserFsSource) {
  Copy-Item $browserFsSource -Destination $browserFsDest -Force
  Write-Host "Copied $browserFsDest" -ForegroundColor Green
} else {
  Write-Host "browser_fs.js not found; web bridge will be unavailable." -ForegroundColor Yellow
}

# Copy coi-serviceworker.js so COOP/COEP (and thus SharedArrayBuffer/pthreads) works on GitHub Pages
$coiSource = "coi-serviceworker.js"
$coiDest = Join-Path "Balatro" "coi-serviceworker.js"
if (Test-Path $coiSource) {
  Copy-Item $coiSource -Destination $coiDest -Force
  Write-Host "Copied $coiDest" -ForegroundColor Green
} else {
  Write-Host "coi-serviceworker.js not found; release build may fail on SharedArrayBuffer." -ForegroundColor Yellow
}

# The release build needs love.wasm and love.worker.js next to love.js; restore them if the
# love.js launcher did not emit them.
$releaseSrcDir = Join-Path $PSScriptRoot "love.js\src\release"
foreach ($artifact in @('love.wasm', 'love.worker.js')) {
  $destPath = Join-Path "Balatro" $artifact
  if (-not (Test-Path $destPath)) {
    $srcPath = Join-Path $releaseSrcDir $artifact
    if (Test-Path $srcPath) {
      Copy-Item $srcPath -Destination $destPath -Force
      Write-Host "Restored missing $destPath from love.js release build" -ForegroundColor Yellow
    } else {
      Write-Host "Skipping $artifact restore: $srcPath not found" -ForegroundColor DarkYellow
    }
  }
}

# Split game.data into <100MB chunks so it fits GitHub's per-file limit. GitHub Pages serves
# them same-origin, and coi-serviceworker.js rebuilds the package from the chunks on the fly.
$gameDataSource = Join-Path "Balatro" "game.data"
if (Test-Path $gameDataSource) {
  $chunkLimit = 104857600  # 100 MiB (GitHub hard per-file limit)
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $gameDataSource))
  $count = [math]::Ceiling($bytes.Length / $chunkLimit)
  for ($i = 0; $i -lt $count; $i++) {
    $offset = $i * $chunkLimit
    $length = [math]::Min($chunkLimit, $bytes.Length - $offset)
    $part = New-Object byte[] $length
    [Array]::Copy($bytes, $offset, $part, 0, $length)
    [System.IO.File]::WriteAllBytes((Join-Path "Balatro" ("game.data." + $i)), $part)
  }
  Write-Host "Split game.data into $count chunk(s)" -ForegroundColor Green
} else {
  Write-Host "Balatro\game.data not found; skipping chunk split (deploy needs game.data.0/1)." -ForegroundColor DarkYellow
}

# Replace /game.love references with ./game.data in the generated game.js
$gameJsPath = Join-Path "Balatro" "game.js"
if (Test-Path $gameJsPath) {
  $gameJsContent = Get-Content $gameJsPath -Raw
  $newContent = $gameJsContent -replace '/game\.love', $gameDataUrl
  $newContent = $newContent -replace '\./game\.data(?:\?v=\d+)?', $gameDataUrl

  # Avoid copying game.data into WASM heap during startup. Large payloads can
  # throw "Uint8Array.set offset is out of bounds" in processPackageData.
  $heapCopyPattern = '(?s)var ptr = Module\[''getMemory''\]\(byteArray\.length\);\s*Module\[''HEAPU8''\]\.set\(byteArray, ptr\);\s*DataRequest\.prototype\.byteArray = Module\[''HEAPU8''\]\.subarray\(ptr, ptr\+byteArray\.length\);'
  $newContent = [regex]::Replace($newContent, $heapCopyPattern, 'DataRequest.prototype.byteArray = byteArray;', 1)

  if ($newContent -ne $gameJsContent) {
    Set-Content $gameJsPath -Value $newContent -NoNewline
    Write-Host "Patched $gameJsPath (cache URL + data heap-copy fix)" -ForegroundColor Yellow
  } else {
    Write-Host "No /game.love references found in $gameJsPath" -ForegroundColor Cyan
  }
} else {
  Write-Host "Skipping game.js patch: $gameJsPath not found" -ForegroundColor DarkYellow
}

# Expose FS on Module in the generated love.js so web bridge can read/write files
$loveJsPath = Join-Path "Balatro" "love.js"
if (Test-Path $loveJsPath) {
  $loveJsContent = Get-Content $loveJsPath -Raw
  if ($loveJsContent -match 'Module\["FS"\]=FS') {
    Write-Host "love.js already exposes Module.FS" -ForegroundColor Cyan
  } else {
    $patchedLoveJs = $loveJsContent -replace 'Module\["FS_unlink"\]=FS\.unlink;', 'Module["FS_unlink"]=FS.unlink;Module["FS"]=FS;'
    if ($patchedLoveJs -ne $loveJsContent) {
      Set-Content $loveJsPath -Value $patchedLoveJs -NoNewline
      Write-Host "Patched $loveJsPath to expose Module.FS" -ForegroundColor Yellow
    } else {
      Write-Host "Skipping love.js patch: FS_unlink export not found" -ForegroundColor DarkYellow
    }
  }

  # Fix OpenAL vector stop/pause/play handlers that pass source IDs instead of source objects.
  # This prevents runtime errors like:
  #   TypeError: Cannot read properties of undefined (reading 'length')
  # in AL.setSourceState when browsing large Joker collections.
  $loveJsContentAfterFs = Get-Content $loveJsPath -Raw
  $audioPatched = $loveJsContentAfterFs

  # compat variant (HEAP32)
  $audioPatched = $audioPatched -replace 'AL\.setSourceState\(HEAP32\[pSourceIds\+i\*4>>2\],4115\)', 'var src=AL.currentCtx.sources[HEAP32[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,4115)}'
  $audioPatched = $audioPatched -replace 'AL\.setSourceState\(HEAP32\[pSourceIds\+i\*4>>2\],4114\)', 'var src=AL.currentCtx.sources[HEAP32[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,4114)}'
  $audioPatched = $audioPatched -replace 'AL\.setSourceState\(HEAP32\[pSourceIds\+i\*4>>2\],4116\)', 'var src=AL.currentCtx.sources[HEAP32[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,4116)}'

  # release/sample variant (GROWABLE_HEAP_I32)
  $audioPatched = $audioPatched -replace 'AL\.setSourceState\(GROWABLE_HEAP_I32\(\)\[pSourceIds\+i\*4>>2\],4115\)', 'var src=AL.currentCtx.sources[GROWABLE_HEAP_I32()[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,4115)}'
  $audioPatched = $audioPatched -replace 'AL\.setSourceState\(GROWABLE_HEAP_I32\(\)\[pSourceIds\+i\*4>>2\],4114\)', 'var src=AL.currentCtx.sources[GROWABLE_HEAP_I32()[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,4114)}'
  $audioPatched = $audioPatched -replace 'AL\.setSourceState\(GROWABLE_HEAP_I32\(\)\[pSourceIds\+i\*4>>2\],4116\)', 'var src=AL.currentCtx.sources[GROWABLE_HEAP_I32()[pSourceIds+i*4>>2]];if(src){AL.setSourceState(src,4116)}'

  if ($audioPatched -ne $loveJsContentAfterFs) {
    Set-Content $loveJsPath -Value $audioPatched -NoNewline
    Write-Host "Patched $loveJsPath to fix OpenAL source vector handlers" -ForegroundColor Yellow
  } else {
    Write-Host "No OpenAL vector handler patch needed in $loveJsPath" -ForegroundColor Cyan
  }
} else {
  Write-Host "Skipping love.js patch: $loveJsPath not found" -ForegroundColor DarkYellow
}

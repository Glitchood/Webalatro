// Browser File System helper for Balatro
// Exposes Module.BalatroFS.saveFromPath(memPath, suggestedName)
// and Module.BalatroFS.openToPath(memPath) to interact with the
// browser File System Access API (with fallbacks to download/input).

(function(){
  if (typeof window !== 'undefined' && window.__BALATRO_FS_HELPER_INSTALLED__) {
    console.log('BalatroFS: helper already installed, skipping duplicate init');
    return;
  }
  if (typeof window !== 'undefined') {
    window.__BALATRO_FS_HELPER_INSTALLED__ = true;
  }

  function ready(cb){
    if (typeof Module !== 'undefined' && !Module['FS'] && typeof window !== 'undefined' && window.FS){
      Module['FS'] = window.FS;
    }
    if (typeof Module !== 'undefined' && !Module['FS'] && Module['module'] && Module['module']['FS']){
      Module['FS'] = Module['module']['FS'];
    }
    if (typeof Module !== 'undefined' && !Module['FS']){
      var discovered = findFsObject();
      if (discovered){
        Module['FS'] = discovered;
        console.log('BalatroFS: discovered FS object on Module/global');
      }
    }
    if (typeof Module !== 'undefined' && !Module['FS']){
      attachFsShim();
    }
    if (typeof Module !== 'undefined' && Module['FS']) return cb();
    // Try to wait for Module runtime initialized
    if (typeof Module !== 'undefined' && Module['onRuntimeInitialized']){
      var prev = Module.onRuntimeInitialized;
      Module.onRuntimeInitialized = function(){
        try{ prev(); }catch(e){}
        if (!Module['FS'] && typeof window !== 'undefined' && window.FS){
          Module['FS'] = window.FS;
        }
        if (!Module['FS'] && Module['module'] && Module['module']['FS']){
          Module['FS'] = Module['module']['FS'];
        }
        if (!Module['FS']){
          var discovered = findFsObject();
          if (discovered){
            Module['FS'] = discovered;
            console.log('BalatroFS: discovered FS object on Module/global');
          }
        }
        if (!Module['FS']){
          attachFsShim();
        }
        cb();
      };
      return;
    }
    // Last resort: poll
    var tries = 0;
    var warned = false;
    var iv = setInterval(function(){
      tries = tries + 1;
      if (typeof Module !== 'undefined' && !Module['FS'] && typeof window !== 'undefined' && window.FS){
        Module['FS'] = window.FS;
      }
      if (typeof Module !== 'undefined' && !Module['FS'] && Module['module'] && Module['module']['FS']){
        Module['FS'] = Module['module']['FS'];
      }
      if (typeof Module !== 'undefined' && !Module['FS']){
        var discovered = findFsObject();
        if (discovered){
          Module['FS'] = discovered;
          console.log('BalatroFS: discovered FS object on Module/global');
        }
      }
      if (typeof Module !== 'undefined' && !Module['FS']){
        attachFsShim();
      }
      if (typeof Module !== 'undefined' && Module['FS']){ clearInterval(iv); cb(); }
      if (tries > 200 && !warned){
        warned = true;
        console.warn('BalatroFS: Module.FS not ready');
      }
    }, 50);
  }

  function attachFsShim(){
    if (typeof Module === 'undefined' || Module['FS']) return;

    function pick(){
      for (var i = 0; i < arguments.length; i++){
        var name = arguments[i];
        if (Module[name]) return Module[name];
      }
      return null;
    }

    var fsRead = pick('FS_readFile', '_FS_readFile');
    var fsWrite = pick('FS_writeFile', '_FS_writeFile');
    var fsReaddir = pick('FS_readdir', '_FS_readdir');
    var fsUnlink = pick('FS_unlink', '_FS_unlink');
    var fsStat = pick('FS_stat', '_FS_stat');

    if (!fsRead || !fsWrite){
      var keys = [];
      for (var k in Module){
        if (k.indexOf('FS_') === 0 || k.indexOf('_FS_') === 0) keys.push(k);
      }
      if (keys.length){
        console.warn('BalatroFS: FS shim missing read/write. Available:', keys.slice(0, 40).join(', '));
      }
      return;
    }

    var fsShim = {
      readFile: function(path, opts){ return fsRead(path, opts); },
      writeFile: function(path, data, opts){ return fsWrite(path, data, opts); },
      readdir: function(path){ return fsReaddir ? fsReaddir(path) : []; },
      unlink: function(path){ if (fsUnlink) return fsUnlink(path); },
      analyzePath: function(path){
        if (fsStat){
          try{
            var st = fsStat(path);
            return { exists: true, object: { mode: st.mode } };
          }catch(e){
            return { exists: false };
          }
        }
        try{
          if (fsReaddir && fsReaddir(path)) return { exists: true, object: { mode: 0x4000 } };
        }catch(e){}
        try{
          fsRead(path, { encoding: 'binary' });
          return { exists: true, object: { mode: 0x8000 } };
        }catch(e){}
        return { exists: false };
      },
      isDir: function(mode){ return (mode & 0x4000) === 0x4000; }
    };

    Module['FS'] = fsShim;
    console.log('BalatroFS: attached FS shim from exported FS_* functions');
  }

  function findFsObject(){
    if (typeof globalThis !== 'undefined' && globalThis.FS && typeof globalThis.FS.readFile === 'function' && typeof globalThis.FS.writeFile === 'function'){
      return globalThis.FS;
    }
    if (typeof globalThis !== 'undefined' && globalThis.Module && globalThis.Module.FS && typeof globalThis.Module.FS.readFile === 'function'){
      return globalThis.Module.FS;
    }
    if (typeof Module === 'undefined') return null;
    for (var key in Module){
      if (!Object.prototype.hasOwnProperty.call(Module, key)) continue;
      var val = Module[key];
      if (val && typeof val.readFile === 'function' && typeof val.writeFile === 'function'){
        return val;
      }
    }
    return null;
  }

  function arrayBufferToUint8(ab){ return new Uint8Array(ab); }

  ready(function(){
    Module.BalatroFS = Module.BalatroFS || {};

    Module.BalatroFS.saveFromPath = async function(memPath, suggestedName){
      try{
        var data = Module.FS.readFile(memPath, { encoding: 'binary' });
        // data is a Uint8Array
        var blob = new Blob([data], { type: 'application/octet-stream' });
        var filename = suggestedName || (memPath && memPath.split('/').pop()) || 'save.jkr';

        if (window.showSaveFilePicker){
          try{
            var handle = await window.showSaveFilePicker({
              suggestedName: filename,
              types: [{description: 'Balatro save', accept: {'application/octet-stream': ['.jkr']}}]
            });
            var writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            console.log('BalatroFS: saved to user file', filename);
            return true;
          }catch(e){
            console.warn('BalatroFS.saveFromPath: saveFilePicker failed, falling back', e);
          }
        }

        // Fallback: create download link
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        console.log('BalatroFS: download triggered for', filename);
        return true;
      }catch(err){
        console.error('BalatroFS.saveFromPath error', err);
        return false;
      }
    };

    Module.BalatroFS.openToPath = async function(memPath){
      try{
        if (window.showOpenFilePicker){
          var [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: [{description: 'Balatro save', accept: {'application/octet-stream':['.jkr']}}]
          });
          var file = await handle.getFile();
          var ab = await file.arrayBuffer();
          var u8 = arrayBufferToUint8(ab);
          Module.FS.writeFile(memPath, u8, { encoding: 'binary' });
          console.log('BalatroFS: imported file to', memPath, 'name=', file.name);
          return { name: file.name, size: ab.byteLength };
        }

        // Fallback using hidden input
        return await new Promise(function(resolve, reject){
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = '.jkr,application/octet-stream';
          input.style.display = 'none';
          document.body.appendChild(input);
          input.onchange = async function(e){
            try{
              var file = input.files[0];
              var ab = await file.arrayBuffer();
              var u8 = arrayBufferToUint8(ab);
              Module.FS.writeFile(memPath, u8, { encoding: 'binary' });
              document.body.removeChild(input);
              resolve({ name: file.name, size: ab.byteLength });
            }catch(err){ document.body.removeChild(input); reject(err); }
          };
          input.click();
        });
      }catch(err){ console.error('BalatroFS.openToPath error', err); return null; }
    };

    console.log('BalatroFS: helper installed');
    Module.BalatroFS.dumpFsTree = function(root, maxDepth, maxEntries){
      return dumpFsTree(root, maxDepth, maxEntries);
    };
    window.dumpBalatroFsTree = function(root, maxDepth, maxEntries){
      if (Module && Module.BalatroFS && Module.BalatroFS.dumpFsTree){
        return Module.BalatroFS.dumpFsTree(root, maxDepth, maxEntries);
      }
      console.warn('BalatroFS: not ready yet, try again after the game loads');
      return null;
    };
    (function(){
      var BRIDGE_SUBDIR = 'webbridge';
      var EXPORT_REQUEST = 'export_request.txt';
      var EXPORT_RESULT = 'export_result.txt';
      var EXPORT_TEMP = 'export_temp.jkr';
      var EXPORT_DIRECT = 'export_direct.txt';
      var IMPORT_REQUEST = 'import_request.txt';
      var IMPORT_RESULT = 'import_result.txt';
      var IMPORT_TEMP = 'import_temp.jkr';
      var IMPORT_DIRECT = 'import_direct.txt';
      var IMPORT_CLIPBOARD = 'import_clipboard.txt';
      var IMPORT_MOD_REQUEST = 'import_mod_request.txt';
      var IMPORT_MOD_RESULT = 'import_mod_result.txt';
      var MOD_MENU_REQUEST = 'mod_menu_request.txt';
      var MOD_MENU_RESULT = 'mod_menu_result.txt';
      var MOD_CATALOG_REQUEST = 'mod_catalog_request.txt';
      var MOD_CATALOG_RESULT = 'mod_catalog_result.txt';
      var MOD_DOWNLOAD_REQUEST = 'mod_download_request.txt';
      var MOD_DOWNLOAD_RESULT = 'mod_download_result.txt';
      var POLL_MS = 200;
      var USE_DRAG_DROP_IMPORT = true;
      var EXPORT_DOWNLOAD_ONLY = true;
      var exportPending = false;
      var importPending = false;
      var exportAwaitingGesture = false;
      var importAwaitingGesture = false;
      var pendingGestureHandler = null;
      var pendingGestureData = null;
      var gestureLatchInstalled = false;
      var gestureConsumeInProgress = false;
      var pickerActive = false;
      var warnedMissingRoot = false;
      var warnedBridgeRootMissing = false;
      var lastBridgeRootMissingLogAt = 0;
      var BRIDGE_ROOT_MISSING_LOG_INTERVAL_MS = 10000;
      var allowBridgeCreate = true;
      var dragDropInstalled = false;
      var pendingDropFile = null;
      var clipboardInstalled = false;
      var pendingClipboardFile = null;
      var idbSyncTimer = null;
      var modImportPending = false;
      var modCatalogPending = false;
      var modDownloadPending = false;
      var modBrowserOpen = false;
      var modBrowserLoading = false;
      var modBrowserCache = [];
      var NEXUS_API_KEY = (window.BALATRO_NEXUS_API_KEY || 'VOdaQam9tB7cnmxk1zW/plGEWcjMwIxf5l2g1V8mJ0sFXtE=--poUvGNh3GoMQysDV--moyzAOPY4BrfTZLJb8ltOQ==');

      function modBridgeLog(){
        var args = Array.prototype.slice.call(arguments);
        args.unshift('BalatroFS[MOD]');
        console.log.apply(console, args);
      }

      function ensureModBrowserStyles(){
        if (document.getElementById('balatro-mod-browser-style')) return;
        var style = document.createElement('style');
        style.id = 'balatro-mod-browser-style';
        style.textContent = [
          '#balatro-mod-browser-overlay{position:fixed;inset:0;background:rgba(8,10,16,.78);z-index:99998;display:flex;align-items:center;justify-content:center;}',
          '#balatro-mod-browser-panel{width:min(980px,92vw);height:min(760px,86vh);background:#111521;border:2px solid #2d3d63;border-radius:14px;box-shadow:0 22px 64px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;color:#ecf2ff;font-family:inherit;}',
          '#balatro-mod-browser-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #2a3350;background:#171d2d;}',
          '#balatro-mod-browser-title{font-size:19px;font-weight:700;letter-spacing:.3px;color:#f6f8ff;}',
          '#balatro-mod-browser-sub{font-size:12px;opacity:.8;margin-top:2px;}',
          '#balatro-mod-browser-close{background:#2f3f68;border:1px solid #3b4f80;color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:700;}',
          '#balatro-mod-browser-close:hover{background:#395188;}',
          '#balatro-mod-browser-status{padding:8px 16px;border-bottom:1px solid #1f2740;font-size:12px;color:#cfd8ee;}',
          '#balatro-mod-browser-grid{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;overflow:auto;min-height:0;}',
          '#balatro-mod-browser-grid::-webkit-scrollbar{width:10px;height:10px;}',
          '#balatro-mod-browser-grid::-webkit-scrollbar-track{background:#0e121d;border-radius:12px;}',
          '#balatro-mod-browser-grid::-webkit-scrollbar-thumb{background:#3e4d74;border-radius:12px;border:2px solid #0e121d;}',
          '.balatro-mod-card{background:#070b13;border:1px solid #263252;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;min-height:260px;}',
          '.balatro-mod-card img{width:100%;height:116px;object-fit:cover;background:#0f1321;}',
          '.balatro-mod-meta{padding:8px 9px 10px;display:flex;flex-direction:column;gap:4px;}',
          '.balatro-mod-name{font-weight:700;font-size:14px;line-height:1.05;color:#fff;}',
          '.balatro-mod-author{font-size:12px;color:#d8deef;}',
          '.balatro-mod-desc{font-size:11px;color:#b6bfd8;line-height:1.2;min-height:30px;}',
          '.balatro-mod-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px;}',
          '.balatro-mod-tag{font-size:10px;background:#1d2845;border:1px solid #334770;border-radius:999px;padding:2px 7px;color:#dce6ff;}',
          '.balatro-mod-open{background:#2f7d48;border:1px solid #3ea35f;color:#fff;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-weight:700;}',
          '.balatro-mod-open:hover{background:#399b58;}',
          '.balatro-mod-empty{display:flex;align-items:center;justify-content:center;color:#d4dbea;font-size:13px;opacity:.9;min-height:120px;grid-column:1 / -1;background:#0b1019;border:1px dashed #344462;border-radius:10px;padding:14px;text-align:center;}'
        ].join('');
        document.head.appendChild(style);
      }

      function toSafeString(v){ return (v === null || v === undefined) ? '' : String(v); }

      function sanitizeModField(v, maxLen){
        var s = toSafeString(v).replace(/[\t\r\n]+/g, ' ').trim();
        if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
        return s;
      }

      function proxiedApiUrl(rawUrl){
        return 'https://dooble.lat/proxy?url=' + rawUrl;
      }

      function resolveAbsoluteUrl(baseUrl, maybeRelative){
        var raw = toSafeString(maybeRelative || '').trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        if (raw.charAt(0) === '/') return 'https://thunderstore.io' + raw;
        try{
          return String(new URL(raw, baseUrl || 'https://thunderstore.io/c/balatro/api/v1/package/'));
        }catch(e){
          return raw;
        }
      }

      function sanitizeFilePart(v, maxLen){
        var s = sanitizeModField(v || '', maxLen || 80).replace(/[^a-zA-Z0-9._-]+/g, '_');
        s = s.replace(/^_+/, '').replace(/_+$/, '');
        return s || 'icon';
      }

      function iconExtensionFromUrl(url){
        var u = toSafeString(url || '').toLowerCase();
        if (u.indexOf('.jpeg') >= 0) return '.jpeg';
        if (u.indexOf('.jpg') >= 0) return '.jpg';
        if (u.indexOf('.png') >= 0) return '.png';
        return '.png';
      }

      function thunderRequiresSteamodded(item, latest, versions){
        var depPools = [];
        if (latest && Array.isArray(latest.dependencies)) depPools.push(latest.dependencies);
        if (item && Array.isArray(item.dependencies)) depPools.push(item.dependencies);
        if (Array.isArray(versions)){
          for (var i = 0; i < versions.length; i++){
            var v = versions[i] || {};
            if (Array.isArray(v.dependencies)) depPools.push(v.dependencies);
          }
        }

        for (var p = 0; p < depPools.length; p++){
          var deps = depPools[p] || [];
          for (var d = 0; d < deps.length; d++){
            var dep = String(deps[d] || '').toLowerCase();
            if (dep.indexOf('steamodded') >= 0) return true;
          }
        }
        return false;
      }

      function normalizeThunderstoreItem(item){
        var versions = Array.isArray(item.versions) ? item.versions.slice() : [];
        versions.sort(function(a, b){
          var ad = Date.parse((a && a.date_created) || '') || 0;
          var bd = Date.parse((b && b.date_created) || '') || 0;
          return bd - ad;
        });
        var latest = versions.length ? (versions[0] || {}) : {};
        var owner = item.owner || item.author || item.package_owner || item.namespace || 'Unknown';
        var icon = latest.icon || item.icon || item.icon_url || item.image || item.thumbnail || item.cover_image_url || item.hero_image_url || item.background_image_url || '';
        var name = item.name || item.full_name || item.package_name || item.identifier || 'Unnamed Mod';
        var desc = latest.description || item.short_description || item.description || item.summary || '';
        var dl = latest.downloads || item.total_downloads || item.download_count || item.total_download_count || 0;
        var direct = latest.download_url || '';
        var url = item.package_url || item.url || item.website_url || (item.full_name ? ('https://thunderstore.io/c/balatro/p/' + item.full_name.replace('-', '/')) : 'https://thunderstore.io/c/balatro/');
        var requiresSteamodded = thunderRequiresSteamodded(item, latest, versions);
        return {
          id: 'ts:' + toSafeString(item.full_name || item.identifier || name),
          title: toSafeString(name),
          author: toSafeString(owner),
          description: toSafeString(desc),
          downloads: Number(dl) || 0,
          icon: toSafeString(icon),
          url: toSafeString(url),
          download_url: toSafeString(direct),
          requires_steamodded: requiresSteamodded,
          source: 'Thunderstore'
        };
      }

      function normalizeNexusItem(item){
        var name = item.name || item.mod_name || item.title || ('Nexus Mod #' + (item.mod_id || ''));
        var owner = item.author || item.user ? (item.user.name || item.user.member_name || item.user.username || item.author) : 'Unknown';
        var icon = item.picture_url || item.image || item.thumbnail || item.mod_picture || '';
        var url = item.mod_url || item.url || (item.mod_id ? ('https://www.nexusmods.com/balatro/mods/' + item.mod_id) : 'https://www.nexusmods.com/balatro/mods/');
        return {
          id: 'nx:' + toSafeString(item.mod_id || name),
          title: toSafeString(name),
          author: toSafeString(owner),
          description: toSafeString(item.summary || item.description || ''),
          downloads: Number(item.downloads || item.endorsement_count || 0) || 0,
          icon: toSafeString(icon),
          url: toSafeString(url),
          download_url: toSafeString(item.download_link || item.download_url || ''),
          source: 'Nexus'
        };
      }

      async function fetchThunderstoreMods(options){
        options = options || {};
        var requireSteamodded = !!options.requireSteamodded;
        var out = [];
        var nextUrl = 'https://thunderstore.io/c/balatro/api/v1/package/';
        var seenUrls = {};
        var guard = 0;

        while (nextUrl && !seenUrls[nextUrl] && guard < 80){
          seenUrls[nextUrl] = true;
          guard++;
          try{
            var response = await fetch(proxiedApiUrl(nextUrl), { method: 'GET', mode: 'cors' });
            if (!response.ok) break;
            var json = await response.json();
            var items = Array.isArray(json) ? json : (Array.isArray(json.results) ? json.results : []);
            if (items.length){
              for (var j = 0; j < items.length; j++){
                var normalized = normalizeThunderstoreItem(items[j] || {});
                if (!requireSteamodded || normalized.requires_steamodded){
                  out.push(normalized);
                }
              }
            }

            if (Array.isArray(json)){
              nextUrl = '';
            } else {
              nextUrl = resolveAbsoluteUrl(nextUrl, json.next || json.next_url || '');
            }
          }catch(e){
            console.warn('BalatroFS: thunderstore list fetch failed', nextUrl, e);
            break;
          }
        }

        return out;
      }

      async function fetchNexusMods(){
        var out = [];
        var endpoints = [
          'https://api.nexusmods.com/v1/games/balatro/mods/latest_added.json'
        ];

        for (var i = 0; i < endpoints.length; i++){
          try{
            var response = await fetch(proxiedApiUrl(endpoints[i]), {
              method: 'GET',
              mode: 'cors',
              headers: {
                'apikey': NEXUS_API_KEY,
                'application-name': 'Balatroe-WebModMenu'
              }
            });
            if (!response.ok) continue;
            var json = await response.json();
            var items = Array.isArray(json) ? json : (Array.isArray(json.results) ? json.results : []);
            if (!items.length) continue;
            for (var j = 0; j < items.length && out.length < 40; j++){
              out.push(normalizeNexusItem(items[j] || {}));
            }
            if (out.length) return out;
          }catch(e){
            console.warn('BalatroFS: nexus fetch failed', endpoints[i], e);
          }
        }

        return out;
      }

      function renderModBrowserCards(mods){
        var grid = document.getElementById('balatro-mod-browser-grid');
        if (!grid) return;
        grid.innerHTML = '';

        if (!mods || !mods.length){
          var empty = document.createElement('div');
          empty.className = 'balatro-mod-empty';
          empty.textContent = 'No mods found from Thunderstore/Nexus right now. Try again in a moment.';
          grid.appendChild(empty);
          return;
        }

        for (var i = 0; i < mods.length; i++){
          var mod = mods[i];
          var card = document.createElement('div');
          card.className = 'balatro-mod-card';

          var img = document.createElement('img');
          img.loading = 'lazy';
          img.referrerPolicy = 'no-referrer';
          img.src = mod.icon || '';
          img.alt = mod.title || 'Mod';
          img.onerror = function(){ this.src = ''; };
          card.appendChild(img);

          var meta = document.createElement('div');
          meta.className = 'balatro-mod-meta';

          var name = document.createElement('div');
          name.className = 'balatro-mod-name';
          name.textContent = mod.title || 'Unnamed Mod';
          meta.appendChild(name);

          var author = document.createElement('div');
          author.className = 'balatro-mod-author';
          author.textContent = 'By ' + (mod.author || 'Unknown');
          meta.appendChild(author);

          var desc = document.createElement('div');
          desc.className = 'balatro-mod-desc';
          desc.textContent = mod.description || 'No description';
          meta.appendChild(desc);

          var row = document.createElement('div');
          row.className = 'balatro-mod-row';

          var tag = document.createElement('span');
          tag.className = 'balatro-mod-tag';
          tag.textContent = (mod.source || 'Web') + ((mod.downloads > 0) ? (' • ' + mod.downloads.toLocaleString()) : '');
          row.appendChild(tag);

          var openBtn = document.createElement('button');
          openBtn.className = 'balatro-mod-open';
          openBtn.textContent = 'Open';
          openBtn.onclick = (function(url){
            return function(){
              try{ window.open(url || 'https://thunderstore.io/c/balatro/', '_blank', 'noopener,noreferrer'); }catch(e){}
            };
          })(mod.url);
          row.appendChild(openBtn);

          meta.appendChild(row);
          card.appendChild(meta);
          grid.appendChild(card);
        }
      }

      function closeModBrowser(){
        var existing = document.getElementById('balatro-mod-browser-overlay');
        if (existing && existing.parentNode){ existing.parentNode.removeChild(existing); }
        modBrowserOpen = false;
      }

      async function refreshModBrowserData(){
        var status = document.getElementById('balatro-mod-browser-status');
        if (status){ status.textContent = 'Loading mods from Thunderstore and Nexus...'; }

        var thunder = [];
        var nexus = [];
        try{ thunder = await fetchThunderstoreMods(); }catch(e){}
        try{ nexus = await fetchNexusMods(); }catch(e){}

        var byId = {};
        var merged = [];
        var all = thunder.concat(nexus);
        for (var i = 0; i < all.length; i++){
          var m = all[i];
          if (!m || !m.id || byId[m.id]) continue;
          byId[m.id] = true;
          merged.push(m);
        }

        merged.sort(function(a, b){ return (Number(b.downloads) || 0) - (Number(a.downloads) || 0); });
        modBrowserCache = merged;
        renderModBrowserCards(merged);

        if (status){
          status.textContent = 'Thunderstore: ' + thunder.length + ' • Nexus: ' + nexus.length + ' • Total: ' + merged.length;
        }
      }

      function showModBrowser(){
        modBridgeLog('showModBrowser called');
        ensureModBrowserStyles();
        closeModBrowser();

        var overlay = document.createElement('div');
        overlay.id = 'balatro-mod-browser-overlay';
        overlay.addEventListener('click', function(e){
          if (e.target === overlay){ closeModBrowser(); }
        });

        var panel = document.createElement('div');
        panel.id = 'balatro-mod-browser-panel';
        overlay.appendChild(panel);

        var header = document.createElement('div');
        header.id = 'balatro-mod-browser-head';
        header.innerHTML = '<div><div id="balatro-mod-browser-title">Mod Browser</div><div id="balatro-mod-browser-sub">Thunderstore + Nexus (Balatro)</div></div>';

        var closeBtn = document.createElement('button');
        closeBtn.id = 'balatro-mod-browser-close';
        closeBtn.textContent = 'Close';
        closeBtn.onclick = closeModBrowser;
        header.appendChild(closeBtn);
        panel.appendChild(header);

        var status = document.createElement('div');
        status.id = 'balatro-mod-browser-status';
        status.textContent = 'Loading mods...';
        panel.appendChild(status);

        var grid = document.createElement('div');
        grid.id = 'balatro-mod-browser-grid';
        panel.appendChild(grid);

        document.body.appendChild(overlay);
        modBrowserOpen = true;
        modBrowserLoading = true;

        if (modBrowserCache.length){
          renderModBrowserCards(modBrowserCache);
          status.textContent = 'Showing cached results...';
        }

        refreshModBrowserData().finally(function(){ modBrowserLoading = false; });
      }

      Module.BalatroFS.openModBrowser = function(){
        showModBrowser();
        return true;
      };

      function scheduleIdbSync(){
        if (!Module.FS || !Module.FS.syncfs) return;
        if (idbSyncTimer) return;
        idbSyncTimer = setTimeout(function(){
          idbSyncTimer = null;
          try{
            Module.FS.syncfs(false, function(err){
              if (err){
                console.warn('BalatroFS: IDB sync failed', err);
              }
            });
          }catch(syncErr){
            console.warn('BalatroFS: IDB sync exception', syncErr);
          }
        }, 250);
      }

          function getIdentityGuess(){
            try{
              var title = (typeof document !== 'undefined' && document && document.title) ? document.title : '';
              if (title && typeof title === 'string') return title.trim();
            }catch(e){}
            return 'Balatro';
          }

          function getIdentityGuesses(){
            var out = [];
            function push(v){
              v = (typeof v === 'string') ? v.trim() : '';
              if (!v) return;
              if (out.indexOf(v) === -1) out.push(v);
            }
            push(getIdentityGuess());
            push('game');
            push('Balatro');
            push('balatro');
            return out;
          }

          function tryCreateBridgeRoot(root){
            if (!Module.FS_createPath) return false;
            try{
              var parent = root.replace(/\\/g,'/').replace(/\/+$/, '');
              var parts = parent.split('/');
              parts.pop();
              parent = parts.join('/') || '/';
              if (!pathExists(parent)) return false;
              Module.FS_createPath('/', root.replace(/^\/+/, ''), true, true);
              return pathExists(root);
            }catch(e){ return false; }
          }

      function joinPath(base, child){
        if (!base){ base = '/'; }
        if (!child){ return base; }
        if (child.charAt(0) === '/') return child;
        if (base === '/' || base === '') return '/' + child.replace(/^\/+/,'');
        return base.replace(/\/+$/, '') + '/' + child.replace(/^\/+/,'');
      }

      function pathExists(path){
        try{
          return Module.FS.analyzePath(path).exists;
        }catch(e){ return false; }
      }

      function isDirectory(path){
        try{
          var info = Module.FS.analyzePath(path);
          return info.exists && info.object && Module.FS.isDir(info.object.mode);
        }catch(e){ return false; }
      }

      function safeReaddir(path){
        try{ return Module.FS.readdir(path); }catch(e){ return []; }
      }

      function dumpFsTree(root, maxDepth, maxEntries){
        maxDepth = (typeof maxDepth === 'number') ? maxDepth : 4;
        maxEntries = (typeof maxEntries === 'number') ? maxEntries : 200;
        var lines = [];
        var count = 0;

        function walk(dir, depth){
          if (count >= maxEntries || depth > maxDepth) return;
          var entries = safeReaddir(dir);
          for (var i = 0; i < entries.length; i++){
            if (count >= maxEntries) break;
            var name = entries[i];
            if (name === '.' || name === '..') continue;
            var full = joinPath(dir, name);
            var isDir = isDirectory(full);
            lines.push(new Array(depth + 1).join('  ') + (isDir ? '[D] ' : '[F] ') + full);
            count++;
            if (isDir) walk(full, depth + 1);
          }
        }

        walk(root || '/', 0);
        console.log('BalatroFS: FS tree dump (root=' + (root || '/') + ', maxDepth=' + maxDepth + ', maxEntries=' + maxEntries + ')\n' + lines.join('\n'));
        return lines;
      }

      function ensureBridgeRoot(){
        if (Module.BalatroFS._bridgeRoot && pathExists(Module.BalatroFS._bridgeRoot)){
          return Module.BalatroFS._bridgeRoot;
        }

        var identityGuesses = getIdentityGuesses();
        var explicitRoots = [
          '/webbridge',
          '/persistent/webbridge',
          '/home/web_user/love/' + BRIDGE_SUBDIR,
          '/home/web_user/.local/share/love/' + BRIDGE_SUBDIR,
          '/home/web_user/.config/love/' + BRIDGE_SUBDIR
        ];
        for (var ig = 0; ig < identityGuesses.length; ig++){
          var identityGuess = identityGuesses[ig];
          explicitRoots.push('/home/web_user/love/' + identityGuess + '/' + BRIDGE_SUBDIR);
          explicitRoots.push('/home/web_user/.local/share/love/' + identityGuess + '/' + BRIDGE_SUBDIR);
          explicitRoots.push('/home/web_user/.config/love/' + identityGuess + '/' + BRIDGE_SUBDIR);
        }

        for (var r = 0; r < explicitRoots.length; r++){
          var rootCandidate = explicitRoots[r];
          if (pathExists(rootCandidate)){
            Module.BalatroFS._bridgeRoot = rootCandidate;
            console.log('BalatroFS: bridge root set to', rootCandidate);
            return rootCandidate;
          }
        }

        if (allowBridgeCreate){
          for (var rc = 0; rc < explicitRoots.length; rc++){
            var createCandidate = explicitRoots[rc];
            if (tryCreateBridgeRoot(createCandidate)){
              Module.BalatroFS._bridgeRoot = createCandidate;
              console.log('BalatroFS: bridge root created', createCandidate);
              return createCandidate;
            }
          }
        }

        var baseGuesses = [
          '/home/web_user/love',
          '/home/web_user/.config/love',
          '/home/web_user/.local/share/love',
          '/home/web_user/.local/share',
          '/home/web_user/.local',
          '/home/web_user'
        ];

        for (var g = 0; g < baseGuesses.length; g++){
          var base = baseGuesses[g];
          if (!pathExists(base)){ continue; }
          var dirs = safeReaddir(base);
          for (var d = 0; d < dirs.length; d++){
            var entry = dirs[d];
            if (entry === '.' || entry === '..'){ continue; }
            if (entry === BRIDGE_SUBDIR){
              var directRoot = joinPath(base, entry);
              if (pathExists(directRoot)){
                Module.BalatroFS._bridgeRoot = directRoot;
                console.log('BalatroFS: bridge root discovered (direct)', directRoot);
                return directRoot;
              }
            }
            var candidate = joinPath(joinPath(base, entry), BRIDGE_SUBDIR);
            if (pathExists(candidate)){
              Module.BalatroFS._bridgeRoot = candidate;
              warnedBridgeRootMissing = false;
              warnedMissingRoot = false;
              console.log('BalatroFS: bridge root discovered (direct)', candidate);
              return candidate;
            }
          }
        }

        var visited = {};
        var queue = baseGuesses.slice();
        queue.push('/persistent');
        queue.push('/');
        var processed = 0;
        var maxNodes = 1024;

        while(queue.length && processed < maxNodes){
          var current = queue.shift();
          if (!current || visited[current]){ continue; }
          visited[current] = true;
          processed++;

          var candidate = joinPath(current, BRIDGE_SUBDIR);
          if (pathExists(candidate)){
            Module.BalatroFS._bridgeRoot = candidate;
            warnedBridgeRootMissing = false;
            warnedMissingRoot = false;
            console.log('BalatroFS: bridge root set to', candidate);
            return candidate;
          }

          var entries = safeReaddir(current);
          for (var i = 0; i < entries.length; i++){
            var name = entries[i];
            if (name === '.' || name === '..') continue;
            if (name === 'bridge_hint.txt'){
              Module.BalatroFS._bridgeRoot = current;
              warnedBridgeRootMissing = false;
              warnedMissingRoot = false;
              console.log('BalatroFS: bridge root discovered (hint)', current);
              return current;
            }
            var full = joinPath(current, name);
            if (!visited[full] && isDirectory(full)){
              queue.push(full);
            }
          }
        }

        if (!Module.BalatroFS._bridgeRoot){
          var now = Date.now ? Date.now() : 0;
          if (!warnedBridgeRootMissing || (now - lastBridgeRootMissingLogAt) > BRIDGE_ROOT_MISSING_LOG_INTERVAL_MS){
            console.warn('BalatroFS: bridge root not found yet');
            warnedBridgeRootMissing = true;
            lastBridgeRootMissingLogAt = now;
          }
        }

        return Module.BalatroFS._bridgeRoot || null;
      }


      function findRequestPath(rel){
        var bases = [
          '/home/web_user/love',
          '/home/web_user/.local/share/love',
          '/home/web_user/.config/love'
        ];

        for (var b = 0; b < bases.length; b++){
          var base = bases[b];
          if (!pathExists(base)) continue;

          var direct = joinPath(joinPath(base, BRIDGE_SUBDIR), rel);
          if (pathExists(direct)) return direct;

          var entries = safeReaddir(base);
          for (var i = 0; i < entries.length; i++){
            var name = entries[i];
            if (name === '.' || name === '..') continue;
            var candidate = joinPath(joinPath(joinPath(base, name), BRIDGE_SUBDIR), rel);
            if (pathExists(candidate)) return candidate;
          }
        }
        return null;
      }

      function resolveBridgeRootFor(rel){
        var root = ensureBridgeRoot();
        if (root) return root;
        var found = findRequestPath(rel);
        if (found){
          setBridgeRootFromPath(found);
          return Module.BalatroFS._bridgeRoot || null;
        }
        return null;
      }

      function bridgePath(rel){
        var root = resolveBridgeRootFor(rel);
        if (root) return joinPath(root, rel);
        if (!warnedMissingRoot){
          console.warn('BalatroFS: bridge root unresolved, using fallback for', rel);
          warnedMissingRoot = true;
        }
        return '/' + rel.replace(/^\/+/,'');
      }

      function setBridgeRootFromPath(path){
        if (!path || typeof path !== 'string') return;
        var normalized = path.replace(/\\/g, '/');
        var idx = normalized.lastIndexOf('/' + BRIDGE_SUBDIR + '/');
        if (idx !== -1){
          Module.BalatroFS._bridgeRoot = normalized.substring(0, idx + 1 + BRIDGE_SUBDIR.length).replace(/\/+$/, '') || '/' + BRIDGE_SUBDIR;
          return;
        }
        if (normalized === BRIDGE_SUBDIR || normalized.endsWith('/' + BRIDGE_SUBDIR)){
          Module.BalatroFS._bridgeRoot = normalized.replace(/\/+$/, '');
          return;
        }
        if (normalized.indexOf(BRIDGE_SUBDIR + '/') === 0){
          Module.BalatroFS._bridgeRoot = BRIDGE_SUBDIR;
        }
      }

      function readBridgeText(rel){
        var primary = bridgePath(rel);
        if (!primary || primary === '/' + rel.replace(/^\/+/, '')){
          var discovered = findRequestPath(rel);
          if (discovered){
            setBridgeRootFromPath(discovered);
            primary = discovered;
          }
        }
        try{ return Module.FS.readFile(primary, { encoding: 'utf8' }); }catch(e){ }
        if (primary !== '/' + rel){
          try{ return Module.FS.readFile('/' + rel, { encoding: 'utf8' }); }catch(err){}
        }
        return null;
      }

      function readBridgeBinary(rel){
        var primary = bridgePath(rel);
        if (!Module.FS && Module.FS_createDataFile){
          console.warn('BalatroFS: readBridgeBinary unavailable without FS.readFile');
          return null;
        }
        if (!primary || primary === '/' + rel.replace(/^\/+/, '')){
          var discovered = findRequestPath(rel);
          if (discovered){
            setBridgeRootFromPath(discovered);
            primary = discovered;
          }
        }
        try{ return Module.FS.readFile(primary, { encoding: 'binary' }); }catch(e){ }
        if (primary !== '/' + rel){
          try{ return Module.FS.readFile('/' + rel, { encoding: 'binary' }); }catch(err){}
        }
        return null;
      }

      function writeBridgeText(rel, data){
        var primary = bridgePath(rel);
        try{
          Module.FS.writeFile(primary, data, { encoding: 'utf8' });
          return true;
        }catch(e){
          console.error('BalatroFS: failed to write text', primary, e);
          return false;
        }
      }

      function writeBridgeBinary(rel, data){
        var primary = bridgePath(rel);
        try{
          var prefix = Array.prototype.slice.call(data||[], 0, 8).map(function(x){ return ('0' + x.toString(16)).slice(-2); }).join(' ');
          console.log('BalatroFS: writeBridgeBinary', primary, 'bytes=', data && data.length, 'prefix=', prefix);
        }catch(_e){ }
        if (!Module.FS && Module.FS_createDataFile){
          try{
            var parts = primary.split('/');
            var name = parts.pop();
            var parent = parts.join('/') || '/';
            if (Module.FS_createPath){
              Module.FS_createPath('/', parent.replace(/^\/+/, ''), true, true);
            }
            if (Module.FS_unlink){
              try{ Module.FS_unlink(primary); }catch(e){}
            }
            Module.FS_createDataFile(parent, name, data, true, true);
            return true;
          }catch(e){
            console.error('BalatroFS: failed to write binary (createDataFile)', primary, e);
            return false;
          }
        }
        try{
          Module.FS.writeFile(primary, data, { encoding: 'binary' });
          return true;
        }catch(e){
          console.error('BalatroFS: failed to write binary', primary, e);
          return false;
        }
      }

      function removeBridgeFile(rel){
        var primary = bridgePath(rel);
        try{ Module.FS.unlink(primary); }catch(e){}
        var fallback = '/' + rel.replace(/^\/+/,'');
        if (fallback !== primary){ try{ Module.FS.unlink(fallback); }catch(err){} }
      }

      function normalizeBridgeRel(input, fallbackRel){
        if (!input) return fallbackRel;
        var normalized = ('' + input).replace(/\\/g, '/');
        var marker = '/' + BRIDGE_SUBDIR + '/';
        var idx = normalized.lastIndexOf(marker);
        if (idx >= 0){
          setBridgeRootFromPath(normalized);
          return normalized.substring(idx + marker.length);
        }
        if (normalized.indexOf(BRIDGE_SUBDIR + '/') === 0){
          return normalized.substring(BRIDGE_SUBDIR.length + 1);
        }
        if (normalized.indexOf('/' + BRIDGE_SUBDIR + '/') === 0){
          return normalized.substring(BRIDGE_SUBDIR.length + 2);
        }
        return normalized.replace(/^\/+/, '') || fallbackRel;
      }

      function writeResult(type, ok, detail){
        var target = (type === 'export') ? EXPORT_RESULT : IMPORT_RESULT;
        var payload = (ok ? 'OK' : 'ERR') + '\n' + (detail || '');
        if (!writeBridgeText(target, payload)){
          console.error('BalatroFS: failed writing result for', type, 'payload=', payload);
        }
      }

      function writeModImportResult(ok, detail){
        var payload = (ok ? 'OK' : 'ERR') + '\n' + (detail || '');
        if (!writeBridgeText(IMPORT_MOD_RESULT, payload)){
          console.error('BalatroFS: failed writing mod import result', payload);
        }
      }

      function writeModDownloadResult(ok, detail){
        var payload = (ok ? 'OK' : 'ERR') + '\n' + (detail || '');
        if (!writeBridgeText(MOD_DOWNLOAD_RESULT, payload)){
          console.error('BalatroFS: failed writing mod download result', payload);
        }
      }

      function ensureDirectory(path){
        try{
          if (pathExists(path)) return true;
          var parts = (path || '').replace(/^\/+/, '').split('/');
          var current = '';
          for (var i = 0; i < parts.length; i++){
            if (!parts[i]) continue;
            current += '/' + parts[i];
            if (!pathExists(current)){
              Module.FS.mkdir(current);
            }
          }
          return pathExists(path);
        }catch(e){
          console.warn('BalatroFS: ensureDirectory failed', path, e);
          return false;
        }
      }

      function getModsRootPath(){
        var bridgeRoot = ensureBridgeRoot() || Module.BalatroFS._bridgeRoot;
        if (bridgeRoot){
          var normalized = bridgeRoot.replace(/\\/g,'/').replace(/\/+$/, '');
          if (normalized.endsWith('/' + BRIDGE_SUBDIR)){
            return normalized.substring(0, normalized.length - BRIDGE_SUBDIR.length - 1) + '/Mods';
          }
        }
        return '/Mods';
      }

      async function cacheModIconToBridge(mod){
        try{
          if (!mod || !mod.id || !mod.icon) return '';
          var bridgeRoot = ensureBridgeRoot() || Module.BalatroFS._bridgeRoot;
          if (!bridgeRoot) return '';

          var iconDirAbs = joinPath(bridgeRoot, 'mod_icons');
          if (!ensureDirectory(iconDirAbs)) return '';

          var ext = iconExtensionFromUrl(mod.icon);
          var rel = 'mod_icons/' + sanitizeFilePart(mod.id, 70) + ext;
          var abs = bridgePath(rel);
          if (pathExists(abs)) return rel;

          var response = await fetch(proxiedApiUrl(mod.icon), { method: 'GET', mode: 'cors' });
          if (!response.ok) return '';
          var ab = await response.arrayBuffer();
          if (!ab || !ab.byteLength) return '';

          if (!writeBridgeBinary(rel, new Uint8Array(ab))) return '';
          scheduleIdbSync();
          return rel;
        }catch(e){
          return '';
        }
      }

      async function pickModFile(){
        if (window.showOpenFilePicker){
          try{
            var handles = await window.showOpenFilePicker({
              multiple: false,
              types: [{ description: 'Balatro mod archive', accept: { 'application/zip': ['.zip'], 'application/octet-stream': ['.zip'] } }]
            });
            if (handles && handles[0]) return await handles[0].getFile();
          }catch(err){
            if (err && err.name === 'AbortError') return null;
          }
        }

        return await new Promise(function(resolve){
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = '.zip,application/zip,application/octet-stream';
          input.style.display = 'none';
          document.body.appendChild(input);

          var done = false;
          function finish(file){
            if (done) return;
            done = true;
            try{ document.body.removeChild(input); }catch(e){}
            resolve(file || null);
          }

          input.addEventListener('change', function(){
            finish(input.files && input.files[0] ? input.files[0] : null);
          });
          input.addEventListener('cancel', function(){ finish(null); });
          input.click();
          setTimeout(function(){ finish(null); }, 60000);
        });
      }

      async function handleModImportRequest(){
        if (modImportPending){
          modBridgeLog('import request ignored (already pending)');
          return;
        }
        modImportPending = true;
        modBridgeLog('handleModImportRequest begin');
        try{
          var file = await pickModFile();
          if (!file){
            modBridgeLog('import cancelled');
            writeModImportResult(false, 'cancelled');
            return;
          }

          var modsRoot = getModsRootPath();
          if (!ensureDirectory(modsRoot)){
            modBridgeLog('import failed, Mods directory missing', modsRoot);
            writeModImportResult(false, 'failed to create Mods directory');
            return;
          }

          var safeName = (file.name || 'mod.zip').replace(/[\\/]/g, '_');
          var targetPath = joinPath(modsRoot, safeName);
          var ab = await file.arrayBuffer();
          Module.FS.writeFile(targetPath, new Uint8Array(ab), { encoding: 'binary' });
          scheduleIdbSync();
          writeModImportResult(true, safeName);
          modBridgeLog('mod imported to', targetPath, 'bytes=', ab.byteLength);
        }catch(err){
          modBridgeLog('mod import exception', err && err.message ? err.message : String(err));
          writeModImportResult(false, err && err.message ? err.message : String(err));
        }finally{
          removeBridgeFile(IMPORT_MOD_REQUEST);
          modImportPending = false;
          modBridgeLog('handleModImportRequest end');
        }
      }

      async function handleModDownloadRequest(){
        if (modDownloadPending){
          removeBridgeFile(MOD_DOWNLOAD_REQUEST);
          return;
        }
        modDownloadPending = true;
        try{
          var raw = readBridgeText(MOD_DOWNLOAD_REQUEST) || '';
          var parts = String(raw || '').split(/\r?\n/);
          var downloadUrl = (parts[0] || '').trim();
          var suggestedName = (parts[1] || '').trim();
          if (!downloadUrl){
            writeModDownloadResult(false, 'missing download url');
            return;
          }

          var modsRoot = getModsRootPath();
          if (!ensureDirectory(modsRoot)){
            writeModDownloadResult(false, 'failed to create Mods directory');
            return;
          }

          var response = await fetch(proxiedApiUrl(downloadUrl), { method: 'GET', mode: 'cors' });
          if (!response.ok){
            writeModDownloadResult(false, 'download failed (' + response.status + ')');
            return;
          }

          var ab = await response.arrayBuffer();
          var base = sanitizeModField(suggestedName || 'mod', 80).replace(/[^a-zA-Z0-9._-]+/g, '_');
          if (!base) base = 'mod';
          if (!/\.zip$/i.test(base)) base += '.zip';
          var targetPath = joinPath(modsRoot, base);
          Module.FS.writeFile(targetPath, new Uint8Array(ab), { encoding: 'binary' });
          scheduleIdbSync();
          writeModDownloadResult(true, base);
          modBridgeLog('mod download installed', targetPath, 'bytes=', ab.byteLength);
        }catch(err){
          var message = err && err.message ? err.message : String(err);
          writeModDownloadResult(false, message);
          modBridgeLog('mod download exception', message);
        }finally{
          removeBridgeFile(MOD_DOWNLOAD_REQUEST);
          modDownloadPending = false;
        }
      }

      function triggerModImportOnce(tag){
        if (modImportPending){
          removeBridgeFile(IMPORT_MOD_REQUEST);
          return;
        }
        removeBridgeFile(IMPORT_MOD_REQUEST);
        modBridgeLog('mod import request trigger', tag || 'unknown');
        handleModImportRequest();
      }

      async function handleModCatalogRequest(requestRawOverride){
        if (modCatalogPending){
          return;
        }
        modCatalogPending = true;
        try{
          var requestRaw = (typeof requestRawOverride === 'string' && requestRawOverride.length) ? requestRawOverride : (readBridgeText(MOD_CATALOG_REQUEST) || 'all');
          removeBridgeFile(MOD_CATALOG_REQUEST);
          var source = 'thunderstore_steamodded';
          var thunderSteamoddedOnly = true;

          modBridgeLog('catalog request begin', source);

          var thunder = [];
          var nexus = [];
          if (thunderSteamoddedOnly){
            try{ thunder = await fetchThunderstoreMods({requireSteamodded: thunderSteamoddedOnly}); }catch(e){ modBridgeLog('thunderstore fetch failed', e && e.message ? e.message : String(e)); }
          }
          if (false){
            try{ nexus = await fetchNexusMods(); }catch(e2){ modBridgeLog('nexus fetch failed', e2 && e2.message ? e2.message : String(e2)); }
          }

          var byId = {};
          var merged = [];
          var all = thunder.concat(nexus);
          for (var i = 0; i < all.length; i++){
            var m = all[i];
            if (!m || !m.id || byId[m.id]) continue;
            byId[m.id] = true;
            merged.push(m);
          }

          merged.sort(function(a, b){ return (Number(b.downloads) || 0) - (Number(a.downloads) || 0); });

          var iconCacheCount = merged.length > 0 ? 1 : 0;
          for (var c = 0; c < iconCacheCount; c++){
            if (String(merged[c].source || '').toLowerCase() === 'thunderstore'){
              merged[c].icon_cache = await cacheModIconToBridge(merged[c]);
            }
          }

          var lines = [];
          for (var j = 0; j < merged.length; j++){
            var it = merged[j] || {};
            lines.push([
              sanitizeModField(it.title || 'Unnamed Mod', 120),
              sanitizeModField(it.author || 'Unknown', 80),
              sanitizeModField(it.description || '', 220),
              sanitizeModField(it.url || '', 260),
              sanitizeModField(it.source || 'Web', 30),
              String(Number(it.downloads) || 0),
              sanitizeModField(it.icon || '', 320),
              sanitizeModField(it.download_url || '', 420),
              sanitizeModField(it.icon_cache || '', 180)
            ].join('\t'));
          }

          writeBridgeText(MOD_CATALOG_RESULT, 'OK\n' + lines.join('\n'));
          modBridgeLog('catalog request success', 'items=', merged.length, 'source=', source);
        }catch(err){
          var message = err && err.message ? err.message : String(err);
          writeBridgeText(MOD_CATALOG_RESULT, 'ERR\n' + message);
          modBridgeLog('catalog request failed', message);
        }finally{
          removeBridgeFile(MOD_CATALOG_REQUEST);
          modCatalogPending = false;
        }
      }

      async function handleExport(requestRaw, tempOverrideRel){
        var suggested = (requestRaw || '').trim() || 'save.jkr';
        var tempRel = normalizeBridgeRel(tempOverrideRel, EXPORT_TEMP);
        try{
          var data = readBridgeBinary(tempRel);
          if (!data || !data.length){
            throw new Error('export data missing or FS read unavailable');
          }
          console.log('BalatroFS: export payload bytes', data.length);

          var blob = new Blob([data], { type: 'application/octet-stream' });
          var saved = false;
          var usedName = suggested;

          if (!EXPORT_DOWNLOAD_ONLY && window.showSaveFilePicker){
            try{
              var handle = await window.showSaveFilePicker({
                suggestedName: suggested,
                types: [{ description: 'Balatro save', accept: { 'application/octet-stream': ['.jkr'] } }]
              });
              var writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
              saved = true;
              if (handle && handle.name){ usedName = handle.name; }
            }catch(e){
              if (e && e.name === 'AbortError'){
                writeResult('export', false, 'cancelled');
                return;
              }
              console.warn('BalatroFS: save picker fallback', e);
            }
          }

          if (!saved){
            var url = null;
            try{
              if (window.navigator && typeof window.navigator.msSaveOrOpenBlob === 'function'){
                window.navigator.msSaveOrOpenBlob(blob, suggested);
                saved = true;
              } else {
                url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.href = url;
                link.download = suggested;
                link.rel = 'noopener';
                link.style.display = 'none';
                document.body.appendChild(link);

                // Trigger with multiple methods for stricter browser gesture policies.
                try{ link.click(); }catch(_e1){ }
                try{ link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); }catch(_e2){ }

                link.remove();
                saved = true;

                setTimeout(function(){
                  try{ if (url) URL.revokeObjectURL(url); }catch(_revokeErr){ }
                }, 30000);
              }
            }catch(downloadErr){
              if (url){
                try{ URL.revokeObjectURL(url); }catch(_revokeErr){ }
              }
              throw downloadErr;
            }
          }

          if (saved){
            console.log('BalatroFS: export succeeded with file name', usedName);
            writeResult('export', true, usedName);
          }
        }catch(err){
          writeResult('export', false, err && err.message ? err.message : String(err));
        }finally{
          removeBridgeFile(EXPORT_REQUEST);
        }
      }

      function installDragDrop(){
        if (dragDropInstalled) return;
        dragDropInstalled = true;
        document.addEventListener('dragover', function(e){ e.preventDefault(); }, false);
        document.addEventListener('drop', function(e){
          e.preventDefault();
          var dt = e.dataTransfer;
          if (!dt || !dt.files || !dt.files[0]) return;
          handleDroppedFile(dt.files[0]);
        }, false);
      }

      function installClipboardPaste(){
        if (clipboardInstalled) return;
        clipboardInstalled = true;
        document.addEventListener('paste', function(e){
          try{
            var cd = e.clipboardData;
            if (!cd || !cd.items) return;
            for (var i = 0; i < cd.items.length; i++){
              var item = cd.items[i];
              if (item && item.kind === 'file'){
                var file = item.getAsFile();
                if (file){
                  pendingClipboardFile = file;
                  return;
                }
              }
            }
          }catch(err){
            console.warn('BalatroFS: paste handler failed', err);
          }
        }, false);
      }

      function handleDroppedFile(file){
        if (!file) return;
        pendingDropFile = file;
        consumeDroppedFileIfPending();
      }

      function consumeDroppedFileIfPending(){
        if (!pendingDropFile) return;
        if (!importPending && !importAwaitingGesture && !readBridgeText(IMPORT_REQUEST) && !readBridgeText(IMPORT_DIRECT)){
          return;
        }
        var file = pendingDropFile;
        pendingDropFile = null;
        var tempRel = IMPORT_TEMP;
        file.arrayBuffer().then(function(ab){
          if (!writeBridgeBinary(tempRel, new Uint8Array(ab))){
            importPending = false;
            importAwaitingGesture = false;
            writeResult('import', false, 'write failed');
            return;
          }
          importPending = false;
          importAwaitingGesture = false;
          writeResult('import', true, file.name || 'import.jkr');
          removeBridgeFile(IMPORT_REQUEST);
          removeBridgeFile(IMPORT_DIRECT);
        }).catch(function(err){
          importPending = false;
          importAwaitingGesture = false;
          writeResult('import', false, err && err.message ? err.message : String(err));
        });
      }

      function consumeClipboardFileIfPending(fromTrigger){
        if (!pendingClipboardFile){
          if (fromTrigger){
            writeResult('import', false, 'clipboard empty');
          }
          return;
        }
        var file = pendingClipboardFile;
        pendingClipboardFile = null;
        var tempRel = IMPORT_TEMP;
        file.arrayBuffer().then(function(ab){
          if (!writeBridgeBinary(tempRel, new Uint8Array(ab))){
            importPending = false;
            importAwaitingGesture = false;
            writeResult('import', false, 'write failed');
            return;
          }
          importPending = false;
          importAwaitingGesture = false;
          writeResult('import', true, file.name || 'import.jkr');
          removeBridgeFile(IMPORT_REQUEST);
          removeBridgeFile(IMPORT_DIRECT);
          removeBridgeFile(IMPORT_CLIPBOARD);
        }).catch(function(err){
          importPending = false;
          importAwaitingGesture = false;
          writeResult('import', false, err && err.message ? err.message : String(err));
        });
      }

      function pickFileWithInput(){
        return new Promise(function(resolve){
          if (!isUserActivationActive()){
            var err = new Error('user activation required');
            err.name = 'NotAllowedError';
            resolve(Promise.reject(err));
            return;
          }
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = '.jkr,application/octet-stream';
          input.style.display = 'none';
          document.body.appendChild(input);
          var done = false;

          function finish(value){
            if (!done){
              done = true;
              resolve(value || null);
              document.body.removeChild(input);
            }
          }

          input.addEventListener('change', function(){
            if (input.files && input.files[0]){
              finish(input.files[0]);
            }else{
              finish(null);
            }
          });

          input.addEventListener('cancel', function(){ finish(null); });
          input.click();
          setTimeout(function(){ finish(null); }, 60000);
        });
      }

      async function pickImportFile(){
        if (pickerActive){
          var errActive = new Error('picker already active');
          errActive.name = 'NotAllowedError';
          throw errActive;
        }
        if (window.showOpenFilePicker){
          try{
            pickerActive = true;
            var handles = await window.showOpenFilePicker({
              multiple: false,
              types: [{ description: 'Balatro save', accept: { 'application/octet-stream': ['.jkr'] } }]
            });
            if (handles && handles[0]){
              return await handles[0].getFile();
            }
          }catch(err){
            if (err && err.name === 'AbortError'){
              return null;
            }
            console.warn('BalatroFS: open picker fallback', err);
            if (isActivationError(err)){
              throw err;
            }
          }finally{
            pickerActive = false;
          }
        }
        return await pickFileWithInput();
      }

      function forcePicker(tempOverrideRel){
        if (pickerActive){
          writeResult('import', false, 'picker already active');
          return;
        }
        if (!isUserActivationActive()){
          importPending = true;
          importAwaitingGesture = true;
          requestUserGesture('import', 'direct', tempOverrideRel || IMPORT_TEMP, IMPORT_DIRECT);
          return;
        }
        pickerActive = true;
        var tempRel = normalizeBridgeRel(tempOverrideRel, IMPORT_TEMP);
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.jkr,application/octet-stream';
        input.style.display = 'none';
        document.body.appendChild(input);

        var finished = false;
        function finish(ok, detail){
          if (finished) return;
          finished = true;
          pickerActive = false;
          importPending = false;
          importAwaitingGesture = false;
          try{ document.body.removeChild(input); }catch(e){}
          if (ok){
            writeResult('import', true, detail || 'import.jkr');
          }else{
            writeResult('import', false, detail || 'cancelled');
          }
        }

        input.addEventListener('change', function(){
          try{
            if (!input.files || !input.files[0]){
              finish(false, 'cancelled');
              return;
            }
            var file = input.files[0];
            var reader = new FileReader();
            reader.onload = function(){
              try{
                var ab = reader.result;
                if (!ab){
                  finish(false, 'read failed');
                  return;
                }
                if (!writeBridgeBinary(tempRel, new Uint8Array(ab))){
                  finish(false, 'write failed');
                  return;
                }
                finish(true, file.name || 'import.jkr');
              }catch(err){
                finish(false, err && err.message ? err.message : String(err));
              }
            };
            reader.onerror = function(){
              finish(false, 'read failed');
            };
            reader.readAsArrayBuffer(file);
          }catch(err){
            finish(false, err && err.message ? err.message : String(err));
          }
        });

        input.addEventListener('cancel', function(){ finish(false, 'cancelled'); });
        input.click();
      }

      function isActivationError(err){
        if (!err) return false;
        var name = err.name || '';
        var msg = err.message || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') return true;
        if (msg.indexOf('user activation') !== -1) return true;
        if (msg.indexOf('not granted') !== -1) return true;
        if (msg.indexOf('picker already active') !== -1) return true;
        return false;
      }

      async function handleImport(requestRaw, tempOverrideRel){
        var tempRel = normalizeBridgeRel(tempOverrideRel, IMPORT_TEMP);
        try {
          var file = await pickImportFile();
          if (!file){
            writeResult('import', false, 'cancelled');
            return;
          }

          var ab = await file.arrayBuffer();
          if (!writeBridgeBinary(tempRel, new Uint8Array(ab))){
            writeResult('import', false, 'write failed');
            return;
          }
          console.log('BalatroFS: import payload bytes', ab.byteLength, 'name=', file.name);

          writeResult('import', true, file.name || 'import.jkr');
        }catch(err){
          if (isActivationError(err)){
            requestUserGesture('import', requestRaw || '', tempRel, '');
            return;
          }
          writeResult('import', false, err && err.message ? err.message : String(err));
        }finally{
          removeBridgeFile(IMPORT_REQUEST);
        }
      }

      function queueBridgeExport(){
        if (exportPending) return;
        exportPending = true;
        (async function(){
          try{
            var requestRaw = readBridgeText(EXPORT_REQUEST);
            if (!requestRaw){ return; }
            if (!isUserActivationActive()){
              exportAwaitingGesture = true;
              requestUserGesture('export', requestRaw, EXPORT_TEMP, EXPORT_REQUEST);
              return;
            }
            detachUserGesture();
            await handleExport(requestRaw);
          }catch(queueErr){
            console.error('BalatroFS: export queue error', queueErr);
          }finally{
            if (!exportAwaitingGesture){
              exportPending = false;
            }
          }
        })();
      }

      function queueBridgeImport(){
        if (importPending) return;
        importPending = true;
        (async function(){
          try{
            var requestRaw = readBridgeText(IMPORT_REQUEST);
            if (!requestRaw){ return; }
            if (!isUserActivationActive()){
              importAwaitingGesture = true;
              requestUserGesture('import', requestRaw);
              return;
            }
            detachUserGesture();
            await handleImport(requestRaw);
          }catch(queueErr){
            console.error('BalatroFS: import queue error', queueErr);
          }finally{
            if (!importAwaitingGesture){
              importPending = false;
            }
          }
        })();
      }

      Module.BalatroFS.directExport = function(tempPath, suggestedName){
        try{
          if (!isUserActivationActive()){
            console.warn('BalatroFS: directExport called without user activation');
          }
          detachUserGesture();
          handleExport(suggestedName || '', tempPath);
          return true;
        }catch(err){
          writeResult('export', false, err && err.message ? err.message : String(err));
          return false;
        }
      };

      Module.BalatroFS.directImport = function(tempPath){
        try{
          if (!isUserActivationActive()){
            console.warn('BalatroFS: directImport called without user activation');
          }
          detachUserGesture();
          handleImport('direct', tempPath);
          return true;
        }catch(err){
          writeResult('import', false, err && err.message ? err.message : String(err));
          return false;
        }
      };

      function isUserActivationActive(){
        try{
          return !!(typeof navigator !== 'undefined' && navigator.userActivation && navigator.userActivation.isActive);
        }catch(e){}
        return false;
      }

      function requestUserGesture(kind, requestRaw, tempOverrideRel, removePath){
        pendingGestureData = {
          kind: kind,
          requestRaw: requestRaw || '',
          tempOverrideRel: tempOverrideRel || '',
          removePath: removePath || ''
        };
        installGestureLatch();
        if (pendingGestureHandler) return;
        pendingGestureHandler = async function(){
          var data = pendingGestureData || {};
          pendingGestureData = null;
          try{
            if (data.kind === 'import'){
              importAwaitingGesture = false;
              await handleImport(data.requestRaw || '', data.tempOverrideRel || undefined);
              importPending = false;
              if (data.removePath){ removeBridgeFile(data.removePath); }
            } else if (data.kind === 'export'){
              exportAwaitingGesture = false;
              await handleExport(data.requestRaw || '', data.tempOverrideRel || undefined);
              exportPending = false;
              if (data.removePath){ removeBridgeFile(data.removePath); }
            }
          }catch(err){
            console.error('BalatroFS: gesture action failed', err);
            if (data && data.removePath){ removeBridgeFile(data.removePath); }
          }finally{
            detachUserGesture();
          }
        };
        attachUserGesture();
      }

      function consumePendingGesture(){
        if (!pendingGestureData) return;
        if (!isUserActivationActive()) return;
        if (gestureConsumeInProgress) return;
        gestureConsumeInProgress = true;
        var data = pendingGestureData || {};
        pendingGestureData = null;
        detachUserGesture();
        if (data.kind === 'import'){
          importAwaitingGesture = false;
          importPending = true;
          handleImport(data.requestRaw || '', data.tempOverrideRel || undefined).then(function(){
            importPending = false;
            if (data.removePath){ removeBridgeFile(data.removePath); }
            gestureConsumeInProgress = false;
          }).catch(function(){
            importPending = false;
            if (data.removePath){ removeBridgeFile(data.removePath); }
            gestureConsumeInProgress = false;
          });
        } else if (data.kind === 'export'){
          exportAwaitingGesture = false;
          exportPending = true;
          handleExport(data.requestRaw || '', data.tempOverrideRel || undefined).then(function(){
            exportPending = false;
            if (data.removePath){ removeBridgeFile(data.removePath); }
            gestureConsumeInProgress = false;
          }).catch(function(){
            exportPending = false;
            if (data.removePath){ removeBridgeFile(data.removePath); }
            gestureConsumeInProgress = false;
          });
        }
      }

      function installGestureLatch(){
        if (gestureLatchInstalled) return;
        gestureLatchInstalled = true;
        var latch = function(){
          if (typeof queueMicrotask === 'function'){
            queueMicrotask(consumePendingGesture);
          }else{
            Promise.resolve().then(consumePendingGesture);
          }
        };
        document.addEventListener('pointerup', latch, true);
        document.addEventListener('mouseup', latch, true);
        document.addEventListener('click', latch, true);
        document.addEventListener('keydown', latch, true);
        document.addEventListener('touchend', latch, true);
      }

      function attachUserGesture(){
        if (!pendingGestureHandler) return;
        document.addEventListener('pointerup', pendingGestureHandler, { once: true, capture: true });
        document.addEventListener('mouseup', pendingGestureHandler, { once: true, capture: true });
        document.addEventListener('click', pendingGestureHandler, { once: true, capture: true });
        document.addEventListener('keydown', pendingGestureHandler, { once: true, capture: true });
        document.addEventListener('touchend', pendingGestureHandler, { once: true, capture: true });
      }

      function detachUserGesture(){
        if (!pendingGestureHandler) return;
        document.removeEventListener('pointerup', pendingGestureHandler, { capture: true });
        document.removeEventListener('mouseup', pendingGestureHandler, { capture: true });
        document.removeEventListener('click', pendingGestureHandler, { capture: true });
        document.removeEventListener('keydown', pendingGestureHandler, { capture: true });
        document.removeEventListener('touchend', pendingGestureHandler, { capture: true });
        pendingGestureHandler = null;
      }



      (function installBridgeWriteHook(){
        if (!Module.FS || !Module.FS.writeFile) return;
        var origWriteFile = Module.FS.writeFile;
        Module.FS.writeFile = function(path){
          var result = origWriteFile.apply(this, arguments);
          if (typeof path === 'string'){
            var normalized = path.replace(/\\/g,'/');
            if (/(^|\/)\d+\/(profile\.jkr|meta\.jkr|save\.jkr)$/.test(normalized) || /(^|\/)settings\.jkr$/.test(normalized)){
              scheduleIdbSync();
            }
            if (normalized.indexOf(BRIDGE_SUBDIR + '/') !== -1 || normalized === BRIDGE_SUBDIR){
              setBridgeRootFromPath(normalized);
              allowBridgeCreate = true;
            }
            if (normalized.endsWith('/' + EXPORT_DIRECT) || normalized === EXPORT_DIRECT){
              var suggested = '';
              try{ suggested = Module.FS.readFile(normalized, { encoding: 'utf8' }) || ''; }catch(e){}
              if (isUserActivationActive()){
                detachUserGesture();
                exportAwaitingGesture = false;
                if (!exportPending){ exportPending = true; }
                handleExport(suggested, EXPORT_TEMP).then(function(){
                  exportPending = false;
                  removeBridgeFile(EXPORT_DIRECT);
                }).catch(function(){
                  exportPending = false;
                  removeBridgeFile(EXPORT_DIRECT);
                });
              }else{
                exportPending = true;
                exportAwaitingGesture = true;
                requestUserGesture('export', suggested, EXPORT_TEMP, EXPORT_DIRECT);
              }
              return result;
            }
            if (normalized.endsWith('/' + IMPORT_DIRECT) || normalized === IMPORT_DIRECT){
              if (!isUserActivationActive()){
                importPending = true;
                importAwaitingGesture = true;
                if (USE_DRAG_DROP_IMPORT){
                  installDragDrop();
                  consumeDroppedFileIfPending();
                }
                requestUserGesture('import', 'direct', IMPORT_TEMP, '');
                return result;
              }
              importPending = true;
              importAwaitingGesture = false;
              removeBridgeFile(IMPORT_DIRECT);
              forcePicker(IMPORT_TEMP);
              return result;
            }
            if (normalized.endsWith('/' + IMPORT_CLIPBOARD) || normalized === IMPORT_CLIPBOARD){
              if (!isUserActivationActive()){
                importPending = true;
                importAwaitingGesture = false;
                installClipboardPaste();
                return result;
              }
              importPending = true;
              importAwaitingGesture = false;
              installClipboardPaste();
              consumeClipboardFileIfPending(true);
              removeBridgeFile(IMPORT_CLIPBOARD);
              return result;
            }
            if (normalized.endsWith('/' + EXPORT_REQUEST) || normalized === EXPORT_REQUEST){
              console.log('BalatroFS: export request write detected', normalized);
              dumpFsTree(Module.BalatroFS._bridgeRoot || '/', 4, 250);
              queueBridgeExport();
            } else if (normalized.endsWith('/' + MOD_MENU_REQUEST) || normalized === MOD_MENU_REQUEST){
              modBridgeLog('mod menu request write detected', normalized);
              writeBridgeText(MOD_MENU_RESULT, 'OK\nlua');
              removeBridgeFile(MOD_MENU_REQUEST);
            } else if (normalized.endsWith('/' + MOD_CATALOG_REQUEST) || normalized === MOD_CATALOG_REQUEST){
              if (!modCatalogPending){
                modBridgeLog('mod catalog request write detected', normalized);
                var reqPayload = '';
                try{ reqPayload = Module.FS.readFile(normalized, { encoding: 'utf8' }) || ''; }catch(e){ }
                removeBridgeFile(MOD_CATALOG_REQUEST);
                handleModCatalogRequest(reqPayload);
              } else {
                removeBridgeFile(MOD_CATALOG_REQUEST);
              }
            } else if (normalized.endsWith('/' + MOD_DOWNLOAD_REQUEST) || normalized === MOD_DOWNLOAD_REQUEST){
              modBridgeLog('mod download request write detected', normalized);
              handleModDownloadRequest();
            } else if (normalized.endsWith('/' + IMPORT_MOD_REQUEST) || normalized === IMPORT_MOD_REQUEST){
              triggerModImportOnce('write');
            } else if (normalized.endsWith('/' + IMPORT_REQUEST) || normalized === IMPORT_REQUEST){
              console.log('BalatroFS: import request write detected', normalized);
              dumpFsTree(Module.BalatroFS._bridgeRoot || '/', 4, 250);
              if (USE_DRAG_DROP_IMPORT){
                if (isUserActivationActive()){
                  importPending = true;
                  importAwaitingGesture = false;
                  removeBridgeFile(IMPORT_REQUEST);
                  forcePicker(IMPORT_TEMP);
                } else {
                  importPending = true;
                  importAwaitingGesture = true;
                  installDragDrop();
                  consumeDroppedFileIfPending();
                  requestUserGesture('import', 'request', IMPORT_TEMP, '');
                }
              }else{
                queueBridgeImport();
              }
            }
          }
          return result;
        };
      })();

      installClipboardPaste();

      setInterval(async function(){
        try{
          ensureBridgeRoot();

          if (!exportPending){
            var exportReq = readBridgeText(EXPORT_REQUEST);
            if (exportReq){
              console.log('BalatroFS: export request detected', exportReq.trim());
              if (!isUserActivationActive()){
                exportPending = true;
                exportAwaitingGesture = true;
                requestUserGesture('export', exportReq, EXPORT_TEMP, EXPORT_REQUEST);
              }else{
                exportPending = true;
                detachUserGesture();
                await handleExport(exportReq);
                console.log('BalatroFS: export cycle finished');
                exportPending = false;
                exportAwaitingGesture = false;
              }
            }
          }

          if (!importPending){
            var modMenuReq = readBridgeText(MOD_MENU_REQUEST);
            if (modMenuReq){
              modBridgeLog('mod menu request detected in poll');
              writeBridgeText(MOD_MENU_RESULT, 'OK\nlua');
              removeBridgeFile(MOD_MENU_REQUEST);
            }

            var modCatalogReq = readBridgeText(MOD_CATALOG_REQUEST);
            if (modCatalogReq && !modCatalogPending){
              modBridgeLog('mod catalog request detected in poll');
              removeBridgeFile(MOD_CATALOG_REQUEST);
              await handleModCatalogRequest(modCatalogReq);
            } else if (modCatalogReq && modCatalogPending){
              removeBridgeFile(MOD_CATALOG_REQUEST);
            }

            var modDownloadReq = readBridgeText(MOD_DOWNLOAD_REQUEST);
            if (modDownloadReq && !modDownloadPending){
              modBridgeLog('mod download request detected in poll');
              await handleModDownloadRequest();
            } else if (modDownloadReq && modDownloadPending){
              removeBridgeFile(MOD_DOWNLOAD_REQUEST);
            }

            var modImportReq = readBridgeText(IMPORT_MOD_REQUEST);
            if (modImportReq){
              triggerModImportOnce('poll');
            }

            var importReq = readBridgeText(IMPORT_REQUEST);
            if (importReq){
              console.log('BalatroFS: import request detected');
              importPending = true;
              if (!isUserActivationActive()){
                importAwaitingGesture = true;
                requestUserGesture('import', importReq);
              } else {
                detachUserGesture();
                await handleImport(importReq);
                console.log('BalatroFS: import cycle finished');
                importPending = false;
              }
            }
          }
        }catch(loopErr){
          console.error('BalatroFS: bridge loop error', loopErr);
          exportPending = false;
          importPending = false;
        }
      }, POLL_MS);
    })();
  });
})();

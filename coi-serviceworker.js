/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then(clients => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        // Do not intercept cross-origin requests. Rewrapping the response as a new
        // Response() here strips Access-Control-Allow-Origin, which breaks CORS fetches
        // such as game.data loaded from Google Drive. Let those go straight to the network.
        let requestOrigin = null;
        try {
            requestOrigin = new URL(r.url).origin;
        } catch (e) { }
        if (requestOrigin !== self.location.origin) {
            return;
        }

        // Serve the game data package from chunked parts committed to the repo.
        // Google Drive cannot serve game.data to browsers (403 anti-hotlink), so we
        // keep the file as two <100MB chunks and rebuild it on the fly here.
        let path = null;
        try {
            path = new URL(r.url).pathname;
        } catch (e) { }
        if (path && path.substring(path.length - "game.data".length) === "game.data") {
            event.respondWith(serveGameData(r));
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!coepCredentialless) {
                        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
                    }
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });

    let gameDataBlobPromise = null;
    function loadGameDataBlob() {
        if (!gameDataBlobPromise) {
            gameDataBlobPromise = Promise.all([
                fetch("game.data.0").then((r) => r.arrayBuffer()),
                fetch("game.data.1").then((r) => r.arrayBuffer()),
            ]).then((parts) => new Blob(parts, { type: "application/octet-stream" }));
        }
        return gameDataBlobPromise;
    }

    async function serveGameData(request) {
        try {
            const blob = await loadGameDataBlob();
            const range = request.headers.get("range");
            const total = blob.size;
            if (range) {
                const m = /^bytes=(\d*)-(\d*)$/.exec(range);
                let start, end;
                if (m && m[1] !== "" && m[2] !== "") {
                    start = parseInt(m[1], 10);
                    end = parseInt(m[2], 10);
                } else if (m && m[1] !== "") {
                    start = parseInt(m[1], 10);
                    end = total - 1;
                } else if (m && m[2] !== "") {
                    start = total - parseInt(m[2], 10);
                    end = total - 1;
                }
                if (start === undefined || start > end || end >= total) {
                    return new Response(null, {
                        status: 416,
                        headers: { "content-range": "bytes */" + total },
                    });
                }
                return new Response(blob.slice(start, end + 1), {
                    status: 206,
                    headers: {
                        "content-type": "application/octet-stream",
                        "content-range": "bytes " + start + "-" + end + "/" + total,
                        "content-length": String(end - start + 1),
                        "accept-ranges": "bytes",
                    },
                });
            }
            return new Response(blob, {
                status: 200,
                headers: {
                    "content-type": "application/octet-stream",
                    "content-length": String(total),
                    "accept-ranges": "bytes",
                    "content-disposition": 'attachment; filename="game.data"',
                },
            });
        } catch (e) {
            console.error("serveGameData failed:", e);
            return new Response("failed to load game data", { status: 500 });
        }
    }

} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = (reloadedBySelf == "coepdegrade");

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        const controlling = n.serviceWorker && n.serviceWorker.controller;

        // Record the failure if the page is served by serviceWorker.
        if (controlling && !window.crossOriginIsolated) {
            window.sessionStorage.setItem("coiCoepHasFailed", "true");
        }
        const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

        if (controlling) {
            // Reload only on the first failure.
            const reloadToDegrade = coi.coepDegrade() && !(
                coepDegrading || window.crossOriginIsolated
            );
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: (reloadToDegrade || coepHasFailed && coi.coepDegrade())
                    ? false
                    : coi.coepCredentialless(),
            });
            if (reloadToDegrade) {
                !coi.quiet && console.log("Reloading page to degrade COEP.");
                window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
                coi.doReload("coepdegrade");
            }

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // If we're already coi: do nothing. Perhaps it's due to this script doing its job, or COOP/COEP are
        // already set from the origin server. Also if the browser has no notion of crossOriginIsolated, just give up here.
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Firefox private mode) this won't be available
        if (!n.serviceWorker) {
            !coi.quiet && console.error("COOP/COEP Service Worker not registered, perhaps due to private mode.");
            return;
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                    coi.doReload();
                });

                // If the registration is active, but it's not controlling the page
                if (registration.active && !n.serviceWorker.controller) {
                    !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                    coi.doReload();
                }
            },
            (err) => {
                !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
            }
        );
    })();
}
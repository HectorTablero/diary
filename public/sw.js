function fetchWithTimeout(request, timeout = 1000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("Request timed out")), timeout);
        fetch(request)
            .then((response) => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open("offline").then((cache) => {
            return cache.addAll([
                "/_offline/nointernet/en.html",
                "/_offline/nointernet/es.html",
                "/_offline/noserver/en.html",
                "/_offline/noserver/es.html",
                "/js/offlineRefresh.js",
                "/js/theme.js",
                "/css/offline.css",
                "/images/favicon.png",
                "/images/qed.svg"
            ]);
        })
    );
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (url.pathname === "/endpoints/health") {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    return response;
                })
                .catch(() => {
                    return new Response("Network error or resource unavailable", { status: 503 });
                })
        );
    } else if (url.origin === location.origin) {
        event.respondWith(
            caches.match(event.request).then((response) => {
                if (response) {
                    return response;
                }
                return fetchWithTimeout(event.request)
                    .then((response) => {
                        return response;
                    })
                    .catch(() => {
                        const availableLocales = ["es", "en"];
                        let locale = url.searchParams.get("lang");

                        if (!availableLocales.includes(locale)) {
                            const acceptedLocales = navigator.languages.map(
                                (lang) => lang.split("-")[0]
                            );
                            locale = acceptedLocales.find((lang) =>
                                availableLocales.includes(lang)
                            );
                        }

                        if (!availableLocales.includes(locale)) locale = "es";

                        return handleOfflineError(locale);
                    });
            })
        );
    }
});

async function handleOfflineError(locale) {
    return fetchWithTimeout("https://httpstat.us/204")
        .then((response) => {
            if (response.ok) {
                return caches.match(`/_offline/noserver/${locale}.html`);
            } else {
                return caches.match(`/_offline/nointernet/${locale}.html`);
            }
        })
        .catch(() => {
            caches.match(`/_offline/nointernet/${locale}.html`);
        });
}

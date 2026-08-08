/**
 * Service worker de Eclipse 2026 — vanilla, sin workbox ni next-pwa
 * (compatibilidad con Turbopack: nada de plugins de build).
 *
 * Objetivo: el 12-08-2026 las redes de la franja estarán saturadas; una vez
 * visitada, la app instalada debe funcionar entera sin conexión (todo el
 * cálculo astronómico es cliente). Estrategias por recurso:
 *
 * - Precache en install: app shell (`/`, `/info`), manifest, iconos y los
 *   3 ficheros de `public/geodata/`.
 * - Navegaciones y estáticos de `/_next/` → stale-while-revalidate (la caché
 *   dinámica va recogiendo los chunks que Next descubre en runtime).
 * - Chunk de municipios (~620 KB, inmutable por hash) → cache-first.
 * - api.open-meteo.com → network-first con fallback al último dato cacheado.
 * - basemaps.cartocdn.com (estilo, teselas, glifos) → cache-first con límite
 *   de ~200 entradas y purga simple de las más antiguas.
 *
 * Versionado: subir VERSION invalida todas las cachés viejas en activate.
 */

const VERSION = "v1";
const PREFIJO = "eclipse-";
const CACHE_SHELL = `${PREFIJO}shell-${VERSION}`;
const CACHE_DINAMICA = `${PREFIJO}dinamica-${VERSION}`;
const CACHE_METEO = `${PREFIJO}meteo-${VERSION}`;
const CACHE_TESELAS = `${PREFIJO}teselas-${VERSION}`;
const CACHES_ACTUALES = [CACHE_SHELL, CACHE_DINAMICA, CACHE_METEO, CACHE_TESELAS];

const LIMITE_TESELAS = 200;

const PRECACHE = [
  "/",
  "/info",
  "/manifest.webmanifest",
  "/iconos/icono-192.png",
  "/iconos/icono-512.png",
  "/geodata/banda-totalidad.geojson",
  "/geodata/isolineas.geojson",
  "/geodata/umbra.json",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter(
              (nombre) =>
                nombre.startsWith(PREFIJO) && !CACHES_ACTUALES.includes(nombre),
            )
            .map((nombre) => caches.delete(nombre)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Stale-while-revalidate: responde de caché al instante si hay copia y
 * refresca en segundo plano; si no hay copia, va a la red y cachea.
 */
async function staleWhileRevalidate(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const cacheada = await cache.match(peticion);
  const refresco = fetch(peticion)
    .then((respuesta) => {
      if (respuesta.ok) cache.put(peticion, respuesta.clone());
      return respuesta;
    })
    .catch(() => undefined);
  return cacheada ?? (await refresco) ?? Response.error();
}

/** Cache-first: para recursos inmutables (chunks con hash, teselas). */
async function cacheFirst(peticion, nombreCache, limite) {
  const cache = await caches.open(nombreCache);
  const cacheada = await cache.match(peticion);
  if (cacheada) return cacheada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) {
    await cache.put(peticion, respuesta.clone());
    if (limite) await purgarExceso(cache, limite);
  }
  return respuesta;
}

/** Network-first: datos frescos si hay red; si no, el último cacheado. */
async function networkFirst(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch {
    const cacheada = await cache.match(peticion);
    if (cacheada) return cacheada;
    throw new Error(`Sin red y sin caché para ${peticion.url}`);
  }
}

/**
 * Purga simple: si la caché supera el límite, borra las entradas más
 * antiguas (keys() conserva el orden de inserción).
 */
async function purgarExceso(cache, limite) {
  const claves = await cache.keys();
  const exceso = claves.length - limite;
  for (let i = 0; i < exceso; i++) {
    await cache.delete(claves[i]);
  }
}

/**
 * Navegación: stale-while-revalidate con fallback al shell raíz precacheado
 * para rutas nunca visitadas estando sin conexión.
 */
async function responderNavegacion(peticion) {
  const respuesta = await staleWhileRevalidate(peticion, CACHE_SHELL);
  if (respuesta && respuesta.type !== "error") return respuesta;
  const shell = await caches.match("/");
  return shell ?? Response.error();
}

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;

  const url = new URL(peticion.url);

  if (peticion.mode === "navigate") {
    evento.respondWith(responderNavegacion(peticion));
    return;
  }

  if (url.origin === self.location.origin) {
    // Chunk del Nomenclátor (~620 KB, con hash en el nombre): cache-first.
    if (url.pathname.startsWith("/_next/") && url.pathname.includes("municipios")) {
      evento.respondWith(cacheFirst(peticion, CACHE_DINAMICA));
      return;
    }
    // Resto de estáticos de Next descubiertos en runtime.
    if (url.pathname.startsWith("/_next/")) {
      evento.respondWith(staleWhileRevalidate(peticion, CACHE_DINAMICA));
      return;
    }
    // Geodata, iconos, manifest y demás estáticos propios.
    evento.respondWith(staleWhileRevalidate(peticion, CACHE_SHELL));
    return;
  }

  if (url.hostname === "api.open-meteo.com") {
    evento.respondWith(networkFirst(peticion, CACHE_METEO));
    return;
  }

  if (url.hostname.endsWith("cartocdn.com")) {
    evento.respondWith(cacheFirst(peticion, CACHE_TESELAS, LIMITE_TESELAS));
    return;
  }
});

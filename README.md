# PS5 Price Tracker (Amazon, Facebook Marketplace, Mercado Libre)

Este repo, originalmente un tracker de precios de Amazon/ML por producto, ahora incluye un
**tracker de consolas PS5** que busca avisos de la **PS5 Pro** y la **PS5 comun (estandar/slim)**,
los clasifica por titulo, deduplica y calcula **promedio / minimo / maximo / cantidad** por modelo,
por sitio y en total. Cada corrida se guarda en una base local (historial).

## Uso rapido (PS5)

Requisitos: Node >= 22.12, pnpm y un Chromium/Chrome instalado (se detecta en rutas estandar o via
`CHROMIUM_PATH`). No hacen falta tokens ni cuentas.

```bash
pnpm install
pnpm ps5                      # corre todo, imprime resumen y guarda la corrida en data/ps5.db
pnpm ps5 --sites=facebook     # solo algunos sitios: amazon,facebook,mercadolibre
pnpm ps5 --no-save --json     # sin guardar, con avisos en JSON
pnpm ps5:history              # historial de corridas (agregar --last para el detalle de la ultima)
pnpm dev                      # UI: http://localhost:4321/ps5 (resumen, historial y avisos)
```

Una corrida tarda ~1 minuto (navegador headless con perfil efimero).

### Como funciona

- `src/ps5/sources/*`: un scraper por sitio (Playwright + Chromium headless).
- `src/ps5/classify.ts`: distingue Pro vs comun por titulo y descarta accesorios, controles, juegos,
  "PS5 Pro Enhanced", Portal, repuestos/rotas, "busco/alquilo" y avisos con precio fuera de rango de consola.
- `src/ps5/pipeline.ts`: deduplica (mismo ID/URL o mismo sitio+titulo+precio) y calcula estadisticas.
- `src/ps5/store.ts`: historial en SQLite local (`file:data/ps5.db`, ignorado por git) con `@libsql/client`;
  tambien soporta Turso via `PS5_DB_URL`/`PS5_DB_TOKEN`.
- Las monedas **no se mezclan**: las estadisticas y el total se calculan por moneda (USD, ARS...).

### Ejecucion programada (GitHub Actions)

`.github/workflows/track-ps5-prices.yml` corre `pnpm ps5` cada 6 horas (`0 */6 * * *`) y a pedido
(`workflow_dispatch`): instala Chromium con `playwright-core install --with-deps chromium`, ejecuta un
diagnostico de Mercado Libre (`pnpm ps5:probe-ml`, status HTTP de cada via) y luego el tracker. El resumen
queda en el "Job summary" de la corrida.

**Historial persistente:** en Actions la corrida escribe en Turso reutilizando los secrets que ya usa el
repo (`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`, mapeados a `PS5_DB_URL` / `PS5_DB_TOKEN`) en tablas propias
(`ps5_runs`, `ps5_listings`), sin tocar las del tracker original. Para verlo: poner esas mismas variables
(`PS5_DB_URL`, `PS5_DB_TOKEN`) en `.env` y correr `pnpm dev` -> `/ps5` (grafico de evolucion del promedio por
modelo y moneda, tabla de historial y avisos de la ultima corrida). `pnpm build` genera la pagina con los datos
del momento del build.

Secrets usados: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (ya existen), `ML_APP_ID`, `ML_APP_SECRET`,
`DECODO_AUTH_TOKEN` (ya existen, opcionales) y **`ML_STORAGE_STATE`** (nuevo, opcional: JSON de sesion de
Playwright de una cuenta de ML, exportado por vos; es la salida si ML sigue pidiendo verificacion).

### Mercado Libre: vias probadas (evidencia de GitHub Actions, 2026-11-23)

`pnpm ps5:probe-ml` imprime el status de cada via. Resultados reales desde el runner de Actions:

| Via | Respuesta |
| --- | --- |
| `oauth/token` client_credentials (`ML_APP_ID`/`ML_APP_SECRET`) | 200, token OK |
| `api/sites/MLA/search` (anonimo y con token) | 403 |
| `api/items/{id}`, `sites/MLA/search?product_id=` | 403 |
| `api/products/search?site_id=MLA&q=ps5` con token | 200: devuelve catalogo (57 productos de `MLA-GAME_CONSOLES` encontrados) |
| `api/products/{id}` | 200, pero `buy_box_winner = null` (sin precio) |
| `api/products/{id}/items` | 403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` |
| `listado/articulo/jm` en `.com.ar`, `.com.mx`, `.cl` | redirigen a `/gz/account-verification` |
| Navegador headless (runner e IP local) | `/gz/account-verification` |
| Decodo (`DECODO_AUTH_TOKEN`) | 429 de limite de uso en los 3 reintentos |

Conclusion: el token de app solo permite leer el **catalogo** (nombres, sin precios). No hay forma de obtener
precios de ML sin una sesion de usuario. Camino pendiente: cargar el secret **`ML_STORAGE_STATE`** (JSON de
`storageState` de Playwright de una sesion propia de ML; ver abajo) o resolver el limite de Decodo. El workflow
ya los usa si existen; mientras tanto ML se informa como BLOQUEADO sin romper la corrida.

Como generar `ML_STORAGE_STATE` (en tu PC, nunca se commitea): abrir un Chromium con Playwright, loguearte en
mercadolibre.com.ar, ejecutar `context.storageState({ path: "ml-state.json" })` y pegar el contenido en el
secret (`gh secret set ML_STORAGE_STATE < ml-state.json`). Los selectores de listado de ML estan escritos de
memoria y no se pudieron probar con sesion.

### Actions: Amazon y Facebook desde el runner

En el runner de GitHub (IP de datacenter) **Amazon** devolvio "Sorry! Something went wrong!" (0 resultados) y
**Facebook Marketplace** redirigio a `/login/` (0 tarjetas); ambos funcionan desde una IP residencial. Por eso
la corrida de Actions termina OK pero sin avisos validos y no guarda corridas vacias. Para usar el tracker
programado con datos reales hay que correrlo desde un runner self-hosted / IP residencial o con proxy.

### Estado por sitio y limitaciones

| Sitio | Estado | Detalle |
| --- | --- | --- |
| Facebook Marketplace | Funciona sin login | Se leen ~24-30 avisos por busqueda (3 busquedas, con scroll) para la ubicacion `FB_MARKETPLACE_LOCATION`. La tarjeta no indica moneda: se asume USD si el precio es < 20000 y ARS si no (heuristica). Si FB muestra el muro de login se informa `BLOQUEADO`. |
| Amazon | Funciona parcialmente | Con captchas esporadicos. amazon.com geolocaliza por IP (desde Argentina muestra ARS y oculta consolas), por eso se fija un ZIP de EEUU (`AMAZON_ZIP`) para ver USD. Amazon **oculta el precio** de las consolas vendidas por Sony/Amazon ("Click to see price" / "See options"), asi que solo cuentan los avisos con precio visible (renovadas / terceros). Los avisos sin precio se descartan y se cuentan. Precios de EEUU = referencia, no incluyen envio/impuestos a Argentina. |
| Mercado Libre | **Bloqueado** | ML redirige los listados a `/gz/account-verification` (exige sesion) para navegadores automatizados y su API publica devuelve 403. Se informa `BLOQUEADO` sin romper la corrida. Opciones: `ML_STORAGE_STATE` (sesion propia exportada con Playwright; nunca se commitea) o `DECODO_AUTH_TOKEN` (HTML via Decodo). Ambos caminos estan implementados pero **no se probaron** (los selectores de ML estan escritos de memoria). |

La clasificacion es por heuristica de texto: puede haber falsos positivos/negativos. Los rangos de
precio plausible estan en `PRICE_RANGE` de `src/ps5/classify.ts`.

### Variables de entorno (opcionales)

Ver `.env.example`: `AMAZON_STORES`, `AMAZON_ZIP`, `FB_MARKETPLACE_LOCATION`, `CHROMIUM_PATH`,
`PS5_DB_URL`, `PS5_DB_TOKEN`, `ML_STORAGE_STATE`.

---

# Tracker original por producto (Amazon / ML)

## Amazon Price Tracker (original)

Tracker de precios de Amazon con:

- scraping (vía Decodo API o modo manual),
- persistencia en Turso (libSQL),
- dashboard web en Astro para visualizar evolución de precios,
- workflow de GitHub Actions para ejecuciones automáticas.

## Requisitos

- Node.js >= 22.12.0
- pnpm
- Base de datos Turso creada (URL + auth token)
- Token de Decodo para el scraping por API

## Instalación

```bash
pnpm install
```

## Configuración

1. Crea tu archivo de entorno:

```bash
cp .env.example .env
```

2. Rellena variables en `.env`:

```env
DECODO_AUTH_TOKEN=tu_token

TURSO_DATABASE_URL=tu_database_url
TURSO_AUTH_TOKEN=tu_auth_token

AMAZON_ASINS=B0XXXXXXXX,B0YYYYYYYY
AMAZON_STORE=es
```

Notas:

- `AMAZON_ASINS` acepta una lista separada por comas.
- `AMAZON_STORE` define el dominio (`es` -> `amazon.es`, `com` -> `amazon.com`, etc.).

## Uso

### 1) Ejecutar tracking por API (recomendado)

```bash
pnpm track
```

Esto:

- inicializa la tabla `price_snapshots` si no existe,
- scrapea cada ASIN,
- guarda un snapshot por producto en Turso.

### 2) Ejecutar scraping manual (sin API de Decodo)

```bash
pnpm track:manual
```

Este modo hace fetch directo contra Amazon y puede fallar por CAPTCHA o bloqueo.

### 2.1) Ejecutar scraping manual usando Proxy + Decodo

```bash
pnpm track:manual:proxy
```

Este modo reutiliza el scraper por API (Decodo) y muestra logs manuales por ASIN indicando que la solicitud se realiza por proxy.

### 3) Ver dashboard local

```bash
pnpm dev
```

Abre la URL que muestra Astro (normalmente `http://localhost:4321`) para ver:

- tarjetas por producto,
- precio actual y variación,
- histórico de precios con gráfico.

## Scripts

- `pnpm dev`: arranca la app en desarrollo
- `pnpm build`: build de producción
- `pnpm preview`: sirve el build local
- `pnpm track`: ejecuta scraper API + persistencia
- `pnpm track:manual`: ejecuta scraper manual + persistencia
- `pnpm track:manual:proxy`: ejecuta scraper manual de consola usando Decodo (proxy)

## Automatización con GitHub Actions

Existe un workflow en `.github/workflows/track-amazon-prices.yml` que se ejecuta:

- cada día a las 07:00 UTC,
- y manualmente con `workflow_dispatch`.

Debes configurar estos secretos en GitHub:

- `DECODO_AUTH_TOKEN`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `AMAZON_ASINS`

## Estructura del proyecto

```text
src/
  db/
    client.ts      # cliente Turso
    schema.ts      # creación de tabla e índice
    queries.ts     # inserts y consultas
  tracker/
    index.ts       # entrypoint del tracking por API
    scraper.ts     # scraping con Decodo
    manual-scraper.ts
    utils.ts
    types.ts
  pages/
    index.astro    # dashboard
```

## Cambiar proveedor de scraping

La parte intercambiable está en `src/tracker/scraper.ts`.

Mientras `scrapeProduct(asin)` devuelva la estructura `ProductSnapshot`, el resto del sistema no necesita cambios.

## Consideraciones

- El HTML y las estructuras de Amazon pueden cambiar sin previo aviso.
- Respeta términos de uso y límites del proveedor de scraping.
- Este proyecto está orientado a aprendizaje y monitorización técnica.
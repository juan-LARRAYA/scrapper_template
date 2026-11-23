import { loadEnvFileIfPresent } from "../tracker/load-env.js"

loadEnvFileIfPresent()

/** Prueba varias vias de Mercado Libre e imprime el status HTTP de cada una (diagnostico). */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

const token = async (): Promise<string | null> => {
  const id = process.env.ML_APP_ID, secret = process.env.ML_APP_SECRET
  if (!id || !secret) return null
  const r = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  })
  console.log(`oauth client_credentials -> ${r.status}`)
  return r.ok ? ((await r.json()) as { access_token?: string }).access_token ?? null : null
}

const tk = await token()
const auth = tk ? { Authorization: `Bearer ${tk}` } : {}
const urls = [
  "https://api.mercadolibre.com/sites/MLA/search?q=ps5&limit=5",
  "https://api.mercadolibre.com/sites/MLA/search?category=MLA438566&q=ps5&limit=5",
  "https://api.mercadolibre.com/products/search?status=active&site_id=MLA&q=ps5",
  "https://api.mercadolibre.com/sites/MLA/domain_discovery/search?q=consola+ps5",
  "https://listado.mercadolibre.com.ar/consola-ps5",
  "https://www.mercadolibre.com.ar/jm/search?as_word=ps5",
  "https://articulo.mercadolibre.com.ar/MLA-1389091840",
  "https://api.mercadolibre.com/items/MLA1389091840",
  "https://listado.mercadolibre.com.mx/ps5",
  "https://listado.mercadolibre.cl/ps5",
]
for (const withAuth of tk ? [false, true] : [false]) {
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json,text/html", "Accept-Language": "es-AR,es;q=0.9", ...(withAuth ? auth : {}) }, redirect: "follow" })
      const body = await r.text()
      const hasItems = /"results":\s*\[\s*\{|poly-card|ui-search-layout/.test(body)
      console.log(`${withAuth ? "[token]" : "[anon] "} ${r.status} items=${hasItems} final=${r.url.slice(0, 90)} <- ${u.slice(8, 70)}`)
    } catch (e) {
      console.log(`${u} -> error ${e instanceof Error ? e.message : e}`)
    }
  }
}

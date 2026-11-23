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

// Catalogo de productos (con token): buscar PS5 y ver si hay ofertas con precio
if (tk) {
  const get = async (u: string) => {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tk}`, Accept: "application/json" } })
    const t = await r.text()
    let j: any = null
    try { j = JSON.parse(t) } catch { /* no json */ }
    return { status: r.status, j, t }
  }
  const s = await get("https://api.mercadolibre.com/products/search?status=active&site_id=MLA&q=playstation%205%20consola&limit=10")
  console.log(`products/search -> ${s.status} keys=${Object.keys(s.j ?? {}).join(",")} n=${s.j?.results?.length}`)
  for (const p of (s.j?.results ?? []).slice(0, 6)) console.log(`  product ${p.id} | ${p.name} | domain=${p.domain_id}`)
  const id = s.j?.results?.[0]?.id
  if (id) {
    for (const path of [`products/${id}`, `products/${id}/items`, `products/${id}/items?limit=10`]) {
      const r = await get(`https://api.mercadolibre.com/${path}`)
      console.log(`${path} -> ${r.status} ${r.t.slice(0, 400).replace(/\s+/g, " ")}`)
    }
    const m = await get(`https://api.mercadolibre.com/sites/MLA/search?product_id=${id}&limit=5`)
    console.log(`sites/MLA/search?product_id -> ${m.status} ${m.t.slice(0, 200)}`)
  }
}

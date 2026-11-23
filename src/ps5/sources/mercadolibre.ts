import { existsSync } from "node:fs"
import type { Browser, Page } from "playwright-core"
import { newContext } from "../browser.js"
import { parseMoney } from "../money.js"
import type { RawListing } from "../types.js"

/**
 * Mercado Libre Argentina redirige los listados a /gz/account-verification (exige
 * sesion) cuando detecta navegador automatizado / IP de datacenter, y su API publica
 * de busqueda responde 403. Por eso este scraper degrada con elegancia:
 *
 *  1. Si existe ML_STORAGE_STATE (JSON de sesion de Playwright que el propio usuario
 *     exporta; NUNCA se commitea), se usa esa sesion.
 *  2. Si no, se intenta anonimo; si hay verificacion => estado "bloqueado".
 *  3. Si hay DECODO_AUTH_TOKEN, se pide el HTML del listado via Decodo (sin probar
 *     en esta rama por falta de token) y se extrae con el mismo parser.
 */
export type MlResult = { listings: RawListing[]; blocked: boolean; message: string }

const QUERIES = ["consola ps5", "ps5 pro", "playstation 5 slim"]

const extract = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("li.ui-search-layout__item, div.poly-card")].map((el) => {
      const a = el.querySelector("a.poly-component__title, h2 a, h3 a, a.ui-search-link") as HTMLAnchorElement | null
      const frac = el.querySelector(".poly-price__current .andes-money-amount__fraction, .andes-money-amount__fraction")
      const cents = el.querySelector(".poly-price__current .andes-money-amount__cents, .andes-money-amount__cents")
      const sym = el.querySelector(".andes-money-amount__currency-symbol")?.textContent ?? ""
      return {
        title: (a?.textContent ?? "").trim(),
        href: a?.href ?? "",
        price: frac ? `${frac.textContent}${cents ? "," + cents.textContent : ""}` : null,
        sym,
      }
    }),
  )

const toListings = (cards: Awaited<ReturnType<typeof extract>>): RawListing[] =>
  cards
    .filter((c) => c.title)
    .map((c) => ({
      site: "mercadolibre" as const,
      source: "mercadolibre.com.ar",
      title: c.title,
      price: c.price ? parseMoney(c.price) : null,
      currency: /u\$s|us\$/i.test(c.sym) ? "USD" : "ARS",
      url: c.href.split("#")[0].split("?")[0] || null,
      externalId: c.href.match(/MLA-?(\d+)/)?.[1] ? `MLA${c.href.match(/MLA-?(\d+)/)![1]}` : null,
    }))

const listUrl = (q: string) => `https://listado.mercadolibre.com.ar/${q.trim().replace(/\s+/g, "-")}`

type ApiItem = { id?: string; title?: string; price?: number; currency_id?: string; permalink?: string }

/** Log de diagnostico de cada intento (status HTTP), util para ver que via funciona en CI. */
export const mlDiagnostics: string[] = []

const getAppToken = async (): Promise<string | null> => {
  const id = process.env.ML_APP_ID, secret = process.env.ML_APP_SECRET
  if (!id || !secret) return null
  try {
    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(30_000),
    })
    mlDiagnostics.push(`oauth client_credentials -> ${res.status}`)
    return res.ok ? ((await res.json()) as { access_token?: string }).access_token ?? null : null
  } catch (e) {
    mlDiagnostics.push(`oauth error ${e instanceof Error ? e.message : e}`)
    return null
  }
}

/** API publica de busqueda (con token de app si hay ML_APP_ID/ML_APP_SECRET, y anonima si no). */
type CatalogProduct = {
  id?: string; name?: string; domain_id?: string
  buy_box_winner?: { item_id?: string; price?: number; currency_id?: string } | null
}

/**
 * Via catalogo: con token de app, `products/search` responde 200 (sites/MLA/search da 403).
 * Cada producto de catalogo trae `buy_box_winner` (oferta ganadora con precio). Da UN precio
 * por producto de catalogo (no todos los avisos), pero es precio real publicado.
 */
const scrapeCatalog = async (token: string): Promise<RawListing[]> => {
  const out: RawListing[] = []
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` }
  const seen = new Set<string>()
  let withPrice = 0, consoles = 0
  for (const q of ["consola playstation 5", "ps5 pro", "playstation 5 slim", "ps5 digital"]) {
    try {
      const res = await fetch(`https://api.mercadolibre.com/products/search?status=active&site_id=MLA&q=${encodeURIComponent(q)}&limit=50`, { headers, signal: AbortSignal.timeout(30_000) })
      mlDiagnostics.push(`catalogo "${q}" -> ${res.status}`)
      if (!res.ok) continue
      const results = ((await res.json()) as { results?: CatalogProduct[] }).results ?? []
      for (const p of results) {
        if (!p.id || !p.name || seen.has(p.id) || p.domain_id !== "MLA-GAME_CONSOLES") continue
        seen.add(p.id)
        consoles++
        let bb = p.buy_box_winner
        if (!bb) {
          const r = await fetch(`https://api.mercadolibre.com/products/${p.id}`, { headers, signal: AbortSignal.timeout(30_000) })
          if (r.ok) {
            const full = (await r.json()) as CatalogProduct & Record<string, unknown>
            bb = full.buy_box_winner
            if (consoles <= 3) mlDiagnostics.push(`producto ${p.id} keys=${Object.keys(full).join("|")} bb=${JSON.stringify(bb ?? null).slice(0, 120)}`)
          } else if (consoles <= 3) mlDiagnostics.push(`producto ${p.id} -> ${r.status}`)
        }
        if (!bb || typeof bb.price !== "number") continue
        withPrice++
        out.push({
          site: "mercadolibre", source: "api MLA catalogo", title: p.name, price: bb.price,
          currency: bb.currency_id ?? "ARS", url: `https://www.mercadolibre.com.ar/p/${p.id}`,
          externalId: bb.item_id ?? p.id,
        })
      }
    } catch (e) {
      mlDiagnostics.push(`catalogo error ${e instanceof Error ? e.message : e}`)
    }
  }
  mlDiagnostics.push(`catalogo: ${consoles} consolas, ${withPrice} con buy_box_winner con precio`)
  return out
}

const scrapeApi = async (): Promise<RawListing[]> => {
  const token = await getAppToken()
  const out: RawListing[] = []
  for (const q of QUERIES) {
    for (const offset of [0, 50]) {
      const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(q)}&limit=50&offset=${offset}`
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: AbortSignal.timeout(30_000),
        })
        mlDiagnostics.push(`search "${q}" off=${offset} ${token ? "con token" : "anonimo"} -> ${res.status}`)
        if (!res.ok) {
          if (token && res.status === 403 && out.length === 0) return scrapeCatalog(token)
          break
        }
        const data = (await res.json()) as { results?: ApiItem[] }
        for (const it of data.results ?? []) {
          if (!it.title) continue
          out.push({
            site: "mercadolibre", source: "api MLA", title: it.title,
            price: typeof it.price === "number" ? it.price : null,
            currency: it.currency_id ?? "ARS", url: it.permalink ?? null, externalId: it.id ?? null,
          })
        }
      } catch (e) {
        mlDiagnostics.push(`search error ${e instanceof Error ? e.message : e}`)
        break
      }
    }
  }
  return out
}

export const scrapeMercadoLibre = async (browser: Browser): Promise<MlResult> => {
  const api = await scrapeApi()
  if (api.length > 0) return { listings: api, blocked: false, message: "via API oficial" }

  const storage = process.env.ML_STORAGE_STATE
  const storageState = storage && existsSync(storage) ? storage : undefined
  const ctx = await newContext(browser, { storageState })
  const page = await ctx.newPage()
  const listings: RawListing[] = []
  let blocked = false

  for (const q of QUERIES) {
    try {
      await page.goto(listUrl(q), { waitUntil: "domcontentloaded", timeout: 45_000 })
      await page.waitForTimeout(2500)
      if (/account-verification|login/.test(page.url())) { blocked = true; break }
      listings.push(...toListings(await extract(page)))
    } catch {
      blocked = true
      break
    }
  }
  await ctx.close()
  if (listings.length > 0) return { listings, blocked: false, message: storageState ? "con sesion ML_STORAGE_STATE" : "anonimo" }

  const token = process.env.DECODO_AUTH_TOKEN
  if (blocked && token) {
    const ctx2 = await newContext(browser)
    const p2 = await ctx2.newPage()
    try {
      for (const q of QUERIES) {
        let res!: Response
        for (let attempt = 0; attempt < 3; attempt++) {
          res = await fetch("https://scraper-api.decodo.com/v2/scrape", {
            method: "POST",
            body: JSON.stringify({ target: "universal", url: listUrl(q), parse: false, headless: "html" }),
            headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
            signal: AbortSignal.timeout(150_000),
          })
          mlDiagnostics.push(`decodo "${q}" try${attempt + 1} -> ${res.status}${res.ok ? "" : " " + (await res.text()).slice(0, 120)}`)
          if (res.status !== 429) break
          await new Promise((r) => setTimeout(r, 20_000))
        }
        if (!res.ok) continue
        const html: string = (await res.json()).results?.[0]?.content ?? ""
        mlDiagnostics.push(`decodo html=${html.length}B ${/account-verification|Soy nuevo/.test(html) ? "login-wall" : ""}`)
        await p2.setContent(html, { waitUntil: "domcontentloaded" })
        listings.push(...toListings(await extract(p2)))
      }
    } finally {
      await ctx2.close()
    }
    if (listings.length > 0) return { listings, blocked: false, message: "via Decodo" }
  }

  return {
    listings,
    blocked: true,
    message:
      `[${mlDiagnostics.join("; ")}] ` +
      "ML exige verificacion de cuenta (/gz/account-verification) y su API devuelve 403. " +
      "Opciones: exportar una sesion propia en ML_STORAGE_STATE o definir DECODO_AUTH_TOKEN.",
  }
}

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

export const scrapeMercadoLibre = async (browser: Browser): Promise<MlResult> => {
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
        const res = await fetch("https://scraper-api.decodo.com/v2/scrape", {
          method: "POST",
          body: JSON.stringify({ target: "universal", url: listUrl(q), parse: false, headless: "html" }),
          headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
          signal: AbortSignal.timeout(150_000),
        })
        if (!res.ok) continue
        const html: string = (await res.json()).results?.[0]?.content ?? ""
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
      "ML exige verificacion de cuenta (/gz/account-verification) y su API devuelve 403. " +
      "Opciones: exportar una sesion propia en ML_STORAGE_STATE o definir DECODO_AUTH_TOKEN.",
  }
}

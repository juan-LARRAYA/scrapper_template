import type { Browser, Page } from "playwright-core"
import { newContext } from "../browser.js"
import { parseMoney } from "../money.js"
import type { RawListing } from "../types.js"

const STORES: Record<string, { host: string; currency: string; locale: string }> = {
  com: { host: "www.amazon.com", currency: "USD", locale: "en-US" },
  mx: { host: "www.amazon.com.mx", currency: "MXN", locale: "es-MX" },
  es: { host: "www.amazon.es", currency: "EUR", locale: "es-ES" },
  br: { host: "www.amazon.com.br", currency: "BRL", locale: "pt-BR" },
}

const QUERIES: Record<string, string[]> = {
  com: ["playstation 5 console", "playstation 5 pro console", "ps5 slim digital console", "ps5 console renewed"],
  mx: ["playstation 5 consola", "playstation 5 pro consola"],
  es: ["playstation 5 consola", "playstation 5 pro consola"],
  br: ["playstation 5 console", "playstation 5 pro console"],
}

/**
 * Amazon geolocaliza por IP: desde Argentina amazon.com muestra precios en ARS y oculta
 * muchas consolas. Para tener precios comparables (USD) se fija un ZIP de EEUU (AMAZON_ZIP,
 * default 10001). Solo aplica a amazon.com; si falla, se sigue con lo que muestre el sitio.
 */
const setDeliveryZip = async (page: Page, host: string, store: string) => {
  if (store !== "com") return
  try {
    await page.goto(`https://${host}/`, { waitUntil: "domcontentloaded", timeout: 45_000 })
    await page.click("#nav-global-location-popover-link", { timeout: 8000 })
    await page.fill("#GLUXZipUpdateInput", process.env.AMAZON_ZIP ?? "10001", { timeout: 8000 })
    await page.click("#GLUXZipUpdate input, #GLUXZipUpdate", { timeout: 8000 })
    await page.waitForTimeout(2500)
  } catch { /* se sigue sin ZIP */ }
}

const CURRENCY_CODE = /^(ARS|USD|MXN|EUR|BRL|CLP)\b/

export type AmazonResult = { listings: RawListing[]; blocked: number; errors: string[] }

export const scrapeAmazon = async (browser: Browser, stores: string[], pages = 2): Promise<AmazonResult> => {
  const listings: RawListing[] = []
  const errors: string[] = []
  let blocked = 0

  for (const store of stores) {
    const cfg = STORES[store]
    if (!cfg) { errors.push(`tienda Amazon desconocida: ${store}`); continue }
    const ctx = await newContext(browser, { locale: cfg.locale })
    const page = await ctx.newPage()
    await setDeliveryZip(page, cfg.host, store)
    for (const q of QUERIES[store] ?? []) {
      for (let n = 1; n <= pages; n++) {
        const url = `https://${cfg.host}/s?k=${encodeURIComponent(q)}&page=${n}`
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
          await page.waitForTimeout(1500)
          const isCaptcha = await page.locator('form[action*="validateCaptcha"], #captchacharacters').count()
          if (isCaptcha) { blocked++; continue }
          const cards = await page.evaluate(() =>
            [...document.querySelectorAll('div[data-component-type="s-search-result"]')].map((el) => ({
              asin: el.getAttribute("data-asin"),
              title: [...el.querySelectorAll("h2")]
                .map((h) => (h.getAttribute("aria-label") ?? h.textContent ?? "").replace(/^Sponsored Ad - /, "").trim())
                .sort((a, b) => b.length - a.length)[0] ?? "",
              price: el.querySelector(".a-price:not(.a-text-price) .a-offscreen")?.textContent ?? null,
              href: el.querySelector("h2 a, a.a-link-normal.s-no-outline")?.getAttribute("href") ?? null,
            })),
          )
          if (cards.length === 0) {
            errors.push(`${cfg.host} "${q}" p${n}: 0 resultados (titulo="${(await page.title()).slice(0, 60)}")`)
          }
          for (const c of cards) {
            if (!c.asin || !c.title) continue
            listings.push({
              site: "amazon",
              source: cfg.host.replace("www.", ""),
              title: c.title,
              price: c.price ? parseMoney(c.price) : null,
              currency: c.price?.match(CURRENCY_CODE)?.[1] ?? cfg.currency,
              url: `https://${cfg.host}/dp/${c.asin}`,
              externalId: `${store}:${c.asin}`,
            })
          }
        } catch (e) {
          errors.push(`${cfg.host} "${q}" p${n}: ${e instanceof Error ? e.message.split("\n")[0] : e}`)
        }
      }
    }
    await ctx.close()
  }
  return { listings, blocked, errors }
}

import type { Browser } from "playwright-core"
import { newContext } from "../browser.js"
import { parseMoney } from "../money.js"
import type { RawListing } from "../types.js"

const PRICE_LINE = /^(US\$|USD|AR\$|ARS|\$)\s?[\d.,]+$/i
const LOCATION_LINE = /,\s?[A-Z]{1,3}$/

/**
 * Marketplace de FB se puede ver sin login (con un cartel de "Iniciar sesion") para
 * una ubicacion y busqueda. Se extraen las ~24-60 tarjetas que se cargan al hacer scroll.
 * Si FB muestra el muro de login, se informa como "bloqueado".
 *
 * Moneda: FB no la indica en la tarjeta. Heuristica: precio < 20000 => USD, si no ARS.
 */
export type FacebookResult = { listings: RawListing[]; blocked: boolean; errors: string[] }

export const scrapeFacebook = async (
  browser: Browser,
  location: string,
  scrolls = 6,
): Promise<FacebookResult> => {
  const listings: RawListing[] = []
  const errors: string[] = []
  let blocked = false
  const ctx = await newContext(browser)
  const page = await ctx.newPage()

  for (const q of ["ps5", "ps5 pro", "playstation 5 slim"]) {
    const url = `https://www.facebook.com/marketplace/${encodeURIComponent(location)}/search?query=${encodeURIComponent(q)}`
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await page.waitForTimeout(4000)
      for (let i = 0; i < scrolls; i++) {
        await page.mouse.wheel(0, 3000)
        await page.waitForTimeout(1200)
      }
      const cards = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/marketplace/item/"]')].map((a) => ({
          href: (a as HTMLAnchorElement).getAttribute("href") ?? "",
          text: (a as HTMLElement).innerText ?? "",
        })),
      )
      if (cards.length === 0) {
        blocked = true
        errors.push(`FB "${q}": 0 tarjetas (titulo="${(await page.title()).slice(0, 40)}", url=${page.url().slice(0, 60)})`)
        continue
      }
      for (const c of cards) {
        const id = c.href.match(/\/marketplace\/item\/(\d+)/)?.[1]
        if (!id) continue
        const lines = c.text.split("\n").map((l) => l.trim()).filter(Boolean)
        const priceLines = lines.filter((l) => PRICE_LINE.test(l))
        const rest = lines.filter((l) => !PRICE_LINE.test(l) && l !== "Gratis" && !/^(Recién publicado|Nuevo|Usado)/i.test(l))
        const loc = rest.find((l) => LOCATION_LINE.test(l)) ?? null
        const title = rest.find((l) => l !== loc)
        if (!title) continue
        const price = priceLines[0] ? parseMoney(priceLines[0]) : null
        listings.push({
          site: "facebook",
          source: `marketplace/${location}`,
          title,
          price,
          currency: price === null ? null : /^(US\$|USD)/i.test(priceLines[0]) || price < 20_000 ? "USD" : "ARS",
          url: `https://www.facebook.com/marketplace/item/${id}/`,
          externalId: id,
          location: loc,
        })
      }
    } catch (e) {
      errors.push(`FB "${q}": ${e instanceof Error ? e.message.split("\n")[0] : e}`)
    }
  }
  await ctx.close()
  return { listings, blocked, errors }
}

import { loadEnvFileIfPresent } from "../tracker/load-env.js"

loadEnvFileIfPresent()

import { launchBrowser } from "./browser.js"
import { renderSummary } from "./format.js"
import { computeStats, process as processListings } from "./pipeline.js"
import { initPs5Db, saveRun } from "./store.js"
import { scrapeAmazon } from "./sources/amazon.js"
import { scrapeFacebook } from "./sources/facebook.js"
import { scrapeMercadoLibre } from "./sources/mercadolibre.js"
import type { RawListing, RunSummary, Site, SiteStatus } from "./types.js"

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]
const flag = (name: string) => process.argv.includes(`--${name}`)

const main = async () => {
  const sites = (arg("sites") ?? "amazon,facebook,mercadolibre").split(",") as Site[]
  const save = !flag("no-save")
  const startedAt = new Date().toISOString()
  const raw: RawListing[] = []
  const statuses: SiteStatus[] = []
  const skip = (site: Site) => !sites.includes(site) && statuses.push({ site, status: "omitido", message: "(--sites)", rawCount: 0 })

  const browser = await launchBrowser()
  try {
    if (!skip("amazon")) {
      const stores = (process.env.AMAZON_STORES ?? "com").split(",").map((s) => s.trim()).filter(Boolean)
      const r = await scrapeAmazon(browser, stores)
      raw.push(...r.listings)
      statuses.push({
        site: "amazon",
        status: r.listings.length ? "ok" : r.blocked ? "bloqueado" : "error",
        message: [
          r.blocked ? `${r.blocked} pagina(s) con captcha` : "",
          r.listings.length && !r.listings.some((l) => l.price !== null) ? "ningun aviso muestra precio" : "",
          ...r.errors.slice(0, 2),
        ].filter(Boolean).join("; "),
        rawCount: r.listings.length,
      })
    }
    if (!skip("facebook")) {
      const r = await scrapeFacebook(browser, process.env.FB_MARKETPLACE_LOCATION ?? "buenosaires")
      raw.push(...r.listings)
      statuses.push({
        site: "facebook",
        status: r.listings.length ? "ok" : r.blocked ? "bloqueado" : "error",
        message: r.errors.slice(0, 2).join("; ") || (r.blocked ? "muro de login / sin resultados" : ""),
        rawCount: r.listings.length,
      })
    }
    if (!skip("mercadolibre")) {
      const r = await scrapeMercadoLibre(browser)
      raw.push(...r.listings)
      statuses.push({
        site: "mercadolibre",
        status: r.listings.length ? "ok" : "bloqueado",
        message: r.message,
        rawCount: r.listings.length,
      })
    }
  } finally {
    await browser.close()
  }

  const { kept, duplicates, discarded } = processListings(raw)
  const summary: RunSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    statuses,
    rawTotal: raw.length,
    duplicates,
    discarded,
    kept: kept.length,
    stats: computeStats(kept),
  }
  console.log(renderSummary(summary))

  if (flag("json")) console.log(JSON.stringify({ summary, listings: kept }, null, 2))
  if (save && kept.length === 0) console.log("\nSin avisos validos: no se guarda la corrida (para no ensuciar el historial).")
  else if (save) {
    await initPs5Db()
    const id = await saveRun(summary, kept)
    console.log(`\nCorrida #${id} guardada en ${process.env.PS5_DB_URL ?? "data/ps5.db"}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

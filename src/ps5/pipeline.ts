import { classifyTitle, norm, priceInRange } from "./classify.js"
import type { Listing, Model, RawListing, Site, StatRow, Stats } from "./types.js"

const canonUrl = (l: RawListing): string | null => {
  if (l.externalId) return `${l.site}:${l.externalId}`
  if (!l.url) return null
  try {
    const u = new URL(l.url)
    return `${l.site}:${u.host}${u.pathname}`
  } catch {
    return `${l.site}:${l.url}`
  }
}

export type Processed = {
  kept: Listing[]
  duplicates: number
  discarded: Record<string, number>
}

/** Clasifica, filtra por rango de precio y deduplica (mismo ID/URL, o mismo sitio+titulo+precio). */
export const process = (raw: RawListing[]): Processed => {
  const discarded: Record<string, number> = {}
  const drop = (r: string) => (discarded[r] = (discarded[r] ?? 0) + 1)
  const seenKeys = new Set<string>()
  const seenText = new Set<string>()
  const kept: Listing[] = []
  let duplicates = 0

  for (const l of raw) {
    const key = canonUrl(l)
    const textKey = `${l.site}|${norm(l.title)}|${l.price}|${l.currency}`
    if ((key && seenKeys.has(key)) || seenText.has(textKey)) { duplicates++; continue }
    if (key) seenKeys.add(key)
    seenText.add(textKey)

    const c = classifyTitle(l.title)
    if (!c.ok) { drop(c.reason); continue }
    if (l.price === null) { drop("sin precio visible"); continue }
    if (!priceInRange(l.price, l.currency)) { drop("precio fuera de rango de consola"); continue }
    kept.push({ ...l, model: c.model, price: l.price })
  }
  return { kept, duplicates, discarded }
}

const stats = (xs: number[]): Stats => ({
  count: xs.length,
  avg: xs.reduce((a, b) => a + b, 0) / xs.length,
  min: Math.min(...xs),
  max: Math.max(...xs),
})

/** Estadisticas por modelo x sitio x moneda, mas total por modelo x moneda (site = null). */
export const computeStats = (kept: Listing[]): StatRow[] => {
  const groups = new Map<string, { model: Model; site: Site | null; currency: string; prices: number[] }>()
  const add = (model: Model, site: Site | null, currency: string, price: number) => {
    const k = `${model}|${site}|${currency}`
    if (!groups.has(k)) groups.set(k, { model, site, currency, prices: [] })
    groups.get(k)!.prices.push(price)
  }
  for (const l of kept) {
    const cur = l.currency ?? "?"
    add(l.model, l.site, cur, l.price)
    add(l.model, null, cur, l.price)
  }
  return [...groups.values()]
    .map((g) => ({ model: g.model, site: g.site, currency: g.currency, ...stats(g.prices) }))
    .sort((a, b) =>
      a.model.localeCompare(b.model) ||
      (a.site === null ? 1 : 0) - (b.site === null ? 1 : 0) ||
      (a.site ?? "").localeCompare(b.site ?? "") ||
      a.currency.localeCompare(b.currency),
    )
}

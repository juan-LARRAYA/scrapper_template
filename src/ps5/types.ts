export type Site = "amazon" | "facebook" | "mercadolibre"
export type Model = "pro" | "standard"

/** Aviso tal como lo devuelve un scraper (todavia sin clasificar). */
export type RawListing = {
  site: Site
  /** Sub-tienda/region (p. ej. "amazon.com", "buenosaires"). */
  source: string
  title: string
  price: number | null
  currency: string | null
  url: string | null
  /** ID estable del aviso si existe (ASIN, id de FB, MLA...). */
  externalId: string | null
  location?: string | null
}

export type Listing = RawListing & {
  model: Model
  price: number
}

export type SiteStatus = {
  site: Site
  status: "ok" | "bloqueado" | "error" | "omitido"
  message: string
  rawCount: number
}

export type Stats = { count: number; avg: number; min: number; max: number }

export type StatRow = {
  model: Model
  /** null = total de todos los sitios */
  site: Site | null
  currency: string
} & Stats

export type RunSummary = {
  startedAt: string
  finishedAt: string
  statuses: SiteStatus[]
  rawTotal: number
  duplicates: number
  discarded: Record<string, number>
  kept: number
  stats: StatRow[]
}

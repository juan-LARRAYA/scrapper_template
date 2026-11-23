import type { RunSummary, StatRow } from "./types.js"

export const MODEL_LABEL = { pro: "PS5 Pro", standard: "PS5 comun (estandar/slim)" } as const
export const SITE_LABEL = { amazon: "Amazon", facebook: "Facebook Marketplace", mercadolibre: "Mercado Libre" } as const

export const fmt = (n: number, cur: string) =>
  `${cur} ${n.toLocaleString("es-AR", { maximumFractionDigits: cur === "USD" ? 2 : 0 })}`

export const statLine = (s: StatRow) =>
  `${s.count} avisos | prom ${fmt(s.avg, s.currency)} | min ${fmt(s.min, s.currency)} | max ${fmt(s.max, s.currency)}`

export const renderSummary = (s: RunSummary): string => {
  const out: string[] = []
  out.push(`\n=== Resumen de corrida (${s.startedAt}) ===`)
  out.push("Sitios:")
  for (const st of s.statuses) out.push(`  - ${SITE_LABEL[st.site]}: ${st.status.toUpperCase()} (${st.rawCount} crudos) ${st.message}`)
  out.push(
    `Crudos: ${s.rawTotal} | duplicados: ${s.duplicates} | descartados: ${Object.values(s.discarded).reduce((a, b) => a + b, 0)} | validos: ${s.kept}`,
  )
  const disc = Object.entries(s.discarded)
  if (disc.length) out.push(`  descartes: ${disc.map(([k, v]) => `${k}=${v}`).join(", ")}`)
  for (const model of ["pro", "standard"] as const) {
    out.push(`\n${MODEL_LABEL[model]}`)
    const rows = s.stats.filter((r) => r.model === model)
    if (!rows.length) out.push("  (sin avisos validos)")
    for (const r of rows) out.push(`  ${r.site ? SITE_LABEL[r.site] : "TOTAL"} [${r.currency}]: ${statLine(r)}`)
  }
  out.push("\nNota: las monedas no se mezclan; el total es por moneda.")
  return out.join("\n")
}

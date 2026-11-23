import { loadEnvFileIfPresent } from "../tracker/load-env.js"

loadEnvFileIfPresent()

import { MODEL_LABEL, fmt, renderSummary } from "./format.js"
import { getRuns, initPs5Db } from "./store.js"

await initPs5Db()
const runs = await getRuns(Number(process.argv[2] ?? 10))
if (!runs.length) console.log("Sin corridas guardadas. Ejecuta: pnpm ps5")
console.log("Historial (total por moneda, promedio):")
for (const { id, summary } of runs) {
  const tot = summary.stats
    .filter((s) => s.site === null)
    .map((s) => `${MODEL_LABEL[s.model].split(" (")[0]} ${s.currency} n=${s.count} prom ${fmt(s.avg, s.currency)}`)
    .join(" | ")
  console.log(`#${id} ${summary.startedAt} -> ${tot || "sin datos"}`)
}
if (process.argv.includes("--last") && runs[0]) console.log(renderSummary(runs[0].summary))

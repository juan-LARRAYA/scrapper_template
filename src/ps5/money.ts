/** Parsea "$1.200.000", "$499.00", "1.299,00 €", "US$ 1,299" -> numero. */
export const parseMoney = (text: string): number | null => {
  const s = text.replace(/[^\d.,]/g, "")
  if (!/\d/.test(s)) return null
  const lastDot = s.lastIndexOf(".")
  const lastComma = s.lastIndexOf(",")
  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ","
    const thou = dec === "." ? "," : "."
    normalized = s.split(thou).join("").replace(dec, ".")
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : ""
    if (!sep) normalized = s
    else {
      const parts = s.split(sep)
      const lastLen = parts[parts.length - 1].length
      // un solo separador seguido de 3 digitos, o varios separadores = miles
      normalized = parts.length > 2 || lastLen === 3 ? parts.join("") : parts.join(".")
    }
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

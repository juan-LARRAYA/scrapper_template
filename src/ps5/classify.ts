import type { Model } from "./types.js"

export const norm = (s: string): string =>
  s.replace(/[®™©]/g, "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()

const PS5 = /\b(ps ?-?5|play ?station ?-?5)\b/
const CFI = /\bcfi-?[127]\d{3}\b/

// Frases que identifican con claridad una consola.
const STRONG =
  /\b(consola|console|sony ps ?5|sony playstation ?5|(ps ?5|playstation ?5) (slim|digital|fisica|physical|standard|estandar|pro|1 ?tb|2 ?tb|825|disc|edition|con lector|con lectora|lectora|lector)|825 ?gb|1 ?tb|2 ?tb)\b/

const REJECTS: Array<[string, RegExp]> = [
  ["busco/alquiler", /\b(busco|compro|alquilo|alquiler|se alquila|wanted)\b/],
  [
    "repuesto/roto",
    /\b(repuestos?|para reparar|reparacion|no (enciende|prende|funciona|lee)|defectuos[oa]|averiad[oa]|roto|rota|placa (madre|base)|motherboard|despiece|para piezas|for parts|broken|sin funcionar)\b/,
  ],
  ["pro-enhanced (juego)", /\b(pro enhanced|enhanced for (the )?ps5 ?pro|mejorado para ps5 ?pro)\b/],
  ["portal/handheld", /\b(portal|streaming handheld)\b/],
]

const ACCESSORY =
  /\b(controles?|controllers?|joysticks?|mandos?|dualsense|dual ?sense|dualshock|gamepad|auriculares?|headsets?|pulse (3d|elite|explore)|base de carga|estacion de carga|charging|cargador|soportes?|stand|base vertical|base para|vertical stand|funda|cover|skin|vinilo|sticker|carcasa|faceplate|placas? (frontal|lateral)|case|cables?|ssd|nvme|disco duro|memoria|camara|camera|teclado|volante|steering|vr2?|gift ?card|tarjeta|suscripcion|subscription|membresia|ps ?plus|dock|ventilador|cooler|fan|bateria|protector|bolso|mochila|maletin|mouse|monitor|adaptador|hdmi|filtro|antipolvo|dust)\b/

const GAME = /\b(juegos?|videojuegos?|games?|steelbook|dlc|expansion)\b/
const FOR_PS5 = /\b(para|for|compatible( con| with)?|funciona con|works with)\s+(la\s+|el\s+|the\s+|sony\s+)*(ps ?-?5|play ?station ?-?5)/

export type Classification = { ok: true; model: Model } | { ok: false; reason: string }

export const classifyTitle = (title: string): Classification => {
  const t = norm(title)
  const ps5Match = PS5.exec(t)
  const hasPs5 = !!ps5Match || CFI.test(t)
  if (!hasPs5) return { ok: false, reason: "no menciona PS5" }

  for (const [reason, re] of REJECTS) if (re.test(t)) return { ok: false, reason }

  const strong = STRONG.test(t) || CFI.test(t)
  const acc = ACCESSORY.exec(t)
  const ps5Idx = ps5Match?.index ?? 0

  if (FOR_PS5.test(t) && !/\bconsola|console\b/.test(t.replace(FOR_PS5, ""))) {
    return { ok: false, reason: "accesorio/juego (para PS5)" }
  }
  if (acc && (!strong || acc.index < ps5Idx)) return { ok: false, reason: "accesorio" }
  if (!strong) {
    if (GAME.test(t)) return { ok: false, reason: "juego" }
    // Titulo corto que solo dice "PS5": se acepta y lo termina de validar el rango de precio.
    if (t.split(" ").length > 8) return { ok: false, reason: "sin senal de consola" }
  }

  const isPro = /\bcfi-?7\d{3}\b/.test(t) || (/\bpro\b/.test(t) && !/\b(no|not|sin)\s+(es\s+)?pro\b/.test(t))
  return { ok: true, model: isPro ? "pro" : "standard" }
}

// Rangos plausibles de una consola (nueva o usada). Fuera de rango = juego/accesorio/error.
const PRICE_RANGE: Record<string, [number, number]> = {
  USD: [250, 2000],
  ARS: [300_000, 5_000_000],
  MXN: [5_000, 30_000],
  EUR: [250, 1500],
  BRL: [2_000, 10_000],
  CLP: [250_000, 1_500_000],
}

export const priceInRange = (price: number, currency: string | null): boolean => {
  const r = currency ? PRICE_RANGE[currency] : undefined
  return r ? price >= r[0] && price <= r[1] : price > 0
}

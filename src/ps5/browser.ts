import { existsSync } from "node:fs"
import { chromium, type Browser, type BrowserContext } from "playwright-core"

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/usr/local/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
].filter((p): p is string => !!p)

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

/** Lanza Chromium headless con perfil efimero (nunca toca perfiles reales). */
export const launchBrowser = async (): Promise<Browser> => {
  // PS5_PLAYWRIGHT_CHROMIUM=1 (CI): usar el Chromium que instala `playwright install`
  const executablePath = process.env.PS5_PLAYWRIGHT_CHROMIUM ? undefined : CANDIDATES.find((p) => existsSync(p))
  return chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  })
}

export const newContext = async (
  browser: Browser,
  opts: { locale?: string; timezoneId?: string; storageState?: string } = {},
): Promise<BrowserContext> => {
  const ctx = await browser.newContext({
    locale: opts.locale ?? "es-AR",
    timezoneId: opts.timezoneId ?? "America/Argentina/Buenos_Aires",
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    storageState: opts.storageState,
  })
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false })
  })
  return ctx
}

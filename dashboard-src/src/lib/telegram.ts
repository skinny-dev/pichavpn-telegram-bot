// The same panel opened as a Telegram Mini App.
// Telegram puts the signed launch data in the URL hash (#tgWebAppData=…), which is also where the router keeps its
// path; captureTelegramLaunch() runs before the router mounts, keeps the data and resets the hash to the panel's home.

const KEY_INIT = 'picha-tg-init'
const KEY_SID = 'picha-tg-session'

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void; disableVerticalSwipes?: () => void; isExpanded?: boolean } }
  }
}

function store(k: string, v: string | null) {
  try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v) } catch { /* private mode */ }
}
function load(k: string): string {
  try { return sessionStorage.getItem(k) ?? '' } catch { return '' }
}

/** Call once before rendering. */
export function captureTelegramLaunch(): void {
  const h = window.location.hash
  if (h.includes('tgWebAppData=')) {
    const data = new URLSearchParams(h.slice(1)).get('tgWebAppData') ?? ''
    if (data) store(KEY_INIT, data)
    history.replaceState(null, '', window.location.pathname + window.location.search + '#/')
  }
  const wa = window.Telegram?.WebApp
  if (wa?.initData) store(KEY_INIT, wa.initData)
  try { wa?.ready?.(); wa?.expand?.(); wa?.disableVerticalSwipes?.() } catch { /* older Telegram */ }
}

/** Signed launch data when the panel runs inside Telegram, else ''. */
export const telegramInitData = (): string => load(KEY_INIT)
export const inTelegram = (): boolean => telegramInitData() !== ''

/** The Mini App session id (sent as a header: inside Telegram Web cookies are not available). */
export const telegramSession = (): string => load(KEY_SID)
export const setTelegramSession = (sid: string | null) => store(KEY_SID, sid)

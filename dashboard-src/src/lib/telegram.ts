// The same panel opened as a Telegram Mini App.
// Telegram puts the signed launch data in the URL hash (#tgWebAppData=…), which is also where the router keeps its
// path; captureTelegramLaunch() runs before the router mounts, keeps the data and resets the hash to the panel's home.

interface TgWebApp {
  initData?: string
  colorScheme?: 'light' | 'dark'
  ready?: () => void
  expand?: () => void
  close?: () => void
  disableVerticalSwipes?: () => void
  isExpanded?: boolean
  isVersionAtLeast?: (v: string) => boolean
  setHeaderColor?: (c: string) => void
  setBackgroundColor?: (c: string) => void
  setBottomBarColor?: (c: string) => void
  onEvent?: (e: string, cb: () => void) => void
  /** present when the Mini App is hosted on Telegram Serverless: calls the bot's endpoints */
  Serverless?: { call: (name: string, input: unknown, cb: (err: any, result: any) => void) => void }
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void }
  HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void }
}

const KEY_INIT = 'picha-tg-init'
const KEY_SID = 'picha-tg-session'

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
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

const wa = (): TgWebApp | undefined => (inTelegram() ? window.Telegram?.WebApp : undefined)
const at = (v: string) => { try { return !!wa()?.isVersionAtLeast?.(v) } catch { return false } }

/** Inside Telegram: follow its light/dark theme and paint its header/background in the panel's colours. */
export function tgSyncTheme(): void {
  const w = wa()
  if (!w) return
  const apply = () => {
    const dark = w.colorScheme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    const bg = getComputedStyle(document.body).backgroundColor || (dark ? '#0c111b' : '#ffffff')
    try {
      if (at('6.1')) { w.setHeaderColor?.(bg); w.setBackgroundColor?.(bg) }
      if (at('7.10')) w.setBottomBarColor?.(bg)
    } catch { /* older clients */ }
  }
  apply()
  w.onEvent?.('themeChanged', () => requestAnimationFrame(apply))
}

/** Telegram's own back button while a sheet is open; returns the cleanup. */
export function tgBackButton(onBack: (() => void) | null): (() => void) | undefined {
  const b = at('6.1') ? wa()?.BackButton : undefined
  if (!b) return undefined
  if (!onBack) { b.hide(); return undefined }
  b.onClick(onBack); b.show()
  return () => { b.offClick(onBack); b.hide() }
}

export function tgHaptic(kind: 'light' | 'success' | 'error'): void {
  const h = at('6.1') ? wa()?.HapticFeedback : undefined
  try { kind === 'light' ? h?.impactOccurred('light') : h?.notificationOccurred(kind) } catch { /* not available */ }
}

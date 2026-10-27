export type ColType = 'int' | 'text' | 'ts' | 'str' | 'enum' | 'dt'
export interface Col {
  key: string
  label: string
  type: ColType
  edit?: boolean
  req?: boolean
  options?: Record<string, string>
  /** badge colour per enum value */
  tones?: Record<string, 'default' | 'secondary' | 'success' | 'destructive' | 'warning'>
}
export interface Resource {
  title: string
  pk: string
  create: boolean
  delete: boolean
  import: boolean
  cols: Col[]
}
export type Row = Record<string, string | number | null>

export class ApiError extends Error {
  status: number
  extra?: Record<string, unknown>
  constructor(message: string, status: number, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

import { telegramSession } from './telegram'

/** Telegram Serverless: the panel is hosted by the bot itself and talks to its `panel` endpoint (no cookies, no CSRF: Telegram signs every call) */
const serverless = () => { try { const w = window.Telegram?.WebApp; return w && typeof w.Serverless?.call === 'function' ? w.Serverless : null } catch { return null } }
export const isServerless = () => serverless() !== null

const ENDPOINT = import.meta.env.DEV ? '/dashboard/api.php' : 'api.php'
/** inside the Telegram Mini App the session goes in a header (cookies may be unavailable there) */
const sessionHeader = (): Record<string, string> => { const s = telegramSession(); return s ? { 'X-Picha-Session': s } : {} }
let csrf = ''
export const setCsrf = (t: string) => (csrf = t)
let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn)

function cleanQuery(q: Record<string, any> = {}) {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'object') { const o: Record<string, string> = {}; for (const [fk, fv] of Object.entries(v)) if (fv !== '' && fv != null) o[fk] = String(fv); out[k] = o } else out[k] = String(v)
  }
  return out
}

function serverlessCall<T>(route: string, opts: { body?: unknown; query?: Record<string, any> }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    serverless()!.call('panel', { r: route, query: cleanQuery(opts.query), body: opts.body }, (err: any, res: any) => {
      if (err || !res) return reject(new ApiError(err?.message ?? 'اتصال به سرور برقرار نشد', 0))
      const { status = 200, body } = res
      if (status === 401 && route !== 'me') onUnauthorized?.()
      if (status >= 400 || (body && body.ok === false)) return reject(new ApiError(body?.error ?? `خطای سرور (${status})`, status, body ?? undefined))
      resolve(body as T)
    })
  })
}

export async function api<T = any>(route: string, opts: { body?: unknown; query?: Record<string, any> } = {}): Promise<T> {
  if (isServerless()) return serverlessCall<T>(route, opts)
  const params = new URLSearchParams({ r: route })
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'object') for (const [fk, fv] of Object.entries(v)) { if (fv !== '' && fv != null) params.set(`${k}[${fk}]`, String(fv)) }
    else params.set(k, String(v))
  }
  const hasBody = opts.body !== undefined
  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?${params}`, {
      method: hasBody ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(hasBody ? { 'X-CSRF-Token': csrf } : {}), ...sessionHeader() },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد', 0)
  }
  let data: any = null
  try { data = await res.json() } catch { /* non-JSON */ }
  if (res.status === 401 && route !== 'login' && route !== 'me') onUnauthorized?.()
  if (!res.ok || (data && data.ok === false && res.status >= 400)) {
    throw new ApiError(data?.error ?? `خطای سرور (${res.status})`, res.status, data ?? undefined)
  }
  return data as T
}

/** multipart upload (e.g. a support attachment); same CSRF + error handling as api() */
async function toBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export async function apiForm<T = any>(route: string, form: FormData): Promise<T> {
  if (isServerless()) { // Serverless endpoints take JSON: a file goes as base64 (the panel limits it to 5 MB)
    const body: Record<string, any> = {}
    for (const [k, v] of form.entries()) body[k] = v instanceof File ? { name: v.name, mime: v.type || 'application/octet-stream', data: await toBase64(v) } : v
    return serverlessCall<T>(route, { body })
  }
  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?${new URLSearchParams({ r: route })}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, ...sessionHeader() }, body: form })
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد', 0)
  }
  let data: any = null
  try { data = await res.json() } catch { /* non-JSON */ }
  if (res.status === 401) onUnauthorized?.()
  if (!res.ok || (data && data.ok === false)) throw new ApiError(data?.error ?? `خطای سرور (${res.status})`, res.status, data ?? undefined)
  return data as T
}

/** URL of a support attachment (streamed by the server from Telegram) */
export const supportFileUrl = (row: number, side: 'c' | 's') => `${ENDPOINT}?r=support_file&row=${row}&side=${side}${telegramSession() ? `&sid=${encodeURIComponent(telegramSession())}` : ''}`

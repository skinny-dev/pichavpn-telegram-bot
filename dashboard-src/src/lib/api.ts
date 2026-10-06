export type ColType = 'int' | 'text' | 'ts' | 'str' | 'enum' | 'dt'
export interface Col {
  key: string
  label: string
  type: ColType
  edit?: boolean
  req?: boolean
  options?: Record<string, string>
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

const ENDPOINT = import.meta.env.DEV ? '/dashboard/api.php' : 'api.php'
let csrf = ''
export const setCsrf = (t: string) => (csrf = t)
let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn)

export async function api<T = any>(route: string, opts: { body?: unknown; query?: Record<string, any> } = {}): Promise<T> {
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
      headers: { 'Content-Type': 'application/json', ...(hasBody ? { 'X-CSRF-Token': csrf } : {}) },
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

/**
 * Cliente HTTP centralizado.
 *
 * - The base URL comes from VITE_API_BASE_URL (empty = same origin + Vite proxy).
 * - Session cookies travel with `credentials: "include"`.
 * - The CSRF token is kept in memory (never in localStorage).
 */

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
export const API_BASE_URL = RAW_BASE.replace(/\/$/, '')

const DEFAULT_TIMEOUT_MS = 15000

let csrfToken: string | null = null
let unauthorizedHandler: (() => void) | null = null

export class ApiError extends Error {
  status: number
  code: string
  requestId?: string

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function setCsrfToken(token: string | null) {
  csrfToken = token
}

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?af_csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export async function ensureCsrf(force = false, timeoutMs?: number): Promise<string> {
  if (!force) {
    if (csrfToken) return csrfToken
    const fromCookie = readCsrfCookie()
    if (fromCookie) {
      csrfToken = fromCookie
      return fromCookie
    }
  }
  const response = await request<{ csrf_token: string }>('/api/v1/auth/csrf', { method: 'GET', skipCsrf: true, timeoutMs })
  csrfToken = response.csrf_token
  return response.csrf_token
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  skipCsrf?: boolean
  signal?: AbortSignal
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await send<T>(path, options)
  } catch (error) {
    // The token in memory can go stale (another tab asked for a new one, or the cookie
    // expired). Ask for a fresh token once and repeat the request.
    const mutating = (options.method ?? 'GET') !== 'GET'
    if (!mutating || options.skipCsrf || !(error instanceof ApiError) || error.code !== 'csrf_failed') throw error
    await ensureCsrf(true, options.timeoutMs)
    return send<T>(path, options)
  }
}

async function send<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const mutating = method !== 'GET'

  const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (mutating && !options.skipCsrf) headers['X-CSRF-Token'] = await ensureCsrf()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    throw new ApiError(
      0,
      aborted ? 'timeout' : 'network_error',
      aborted
        ? 'The request took too long. Check your connection.'
        : 'Could not connect to the server.',
    )
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 401) {
    unauthorizedHandler?.()
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    if (!response.ok) {
      throw new ApiError(response.status, 'http_error', 'The operation could not be completed.')
    }
    return undefined as T
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; request_id?: string } } | null)?.error
    throw new ApiError(
      response.status,
      err?.code ?? 'http_error',
      err?.message ?? `Error HTTP ${response.status}`,
      err?.request_id,
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

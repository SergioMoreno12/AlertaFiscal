import { api, ApiError, ensureCsrf, request, setCsrfToken } from './client'

export type SessionUser = {
  id: number
  email: string
  full_name: string
  companies: Array<{ id: number; name: string; nit: string; role: string }>
}

type LoginResponse = { user: SessionUser; csrf_token: string }

// The free hosting plan stops the backend when idle and the first request can take
// close to a minute while it starts, so signing in waits longer than other calls.
const COLD_START_TIMEOUT_MS = 75000

export async function login(email: string, password: string): Promise<SessionUser> {
  await ensureCsrf(true, COLD_START_TIMEOUT_MS)
  const response = await request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    timeoutMs: COLD_START_TIMEOUT_MS,
  })
  setCsrfToken(response.csrf_token)
  return response.user
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/v1/auth/logout')
  } catch (error) {
    // The token in memory may be stale (for example after the CSRF cookie expired):
    // ask for a fresh one and try once more so the server session is really revoked.
    if (!(error instanceof ApiError) || error.code !== 'csrf_failed') throw error
    await ensureCsrf(true)
    await api.post('/api/v1/auth/logout')
  } finally {
    setCsrfToken(null)
  }
}

export async function me(): Promise<SessionUser | null> {
  try {
    const response = await api.get<{ user: SessionUser }>('/api/v1/auth/me')
    return response.user
  } catch {
    return null
  }
}

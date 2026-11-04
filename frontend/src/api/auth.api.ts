import { api, ensureCsrf, request, setCsrfToken } from './client'

export type SessionUser = {
  id: number
  email: string
  full_name: string
  companies: Array<{ id: number; name: string; nit: string; role: string }>
}

type LoginResponse = { user: SessionUser; csrf_token: string }

export async function login(email: string, password: string): Promise<SessionUser> {
  await ensureCsrf(true)
  const response = await request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  setCsrfToken(response.csrf_token)
  return response.user
}

export async function logout(): Promise<void> {
  try {
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

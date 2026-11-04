import { api, request } from './client'

export type HealthLive = { status: string; service: string }
export type HealthReady = { status: string; database: string; demo?: boolean }

export async function checkLive(timeoutMs = 75000): Promise<HealthLive | null> {
  try {
    // Long timeout: on the free hosting plan the first request also starts the server.
    return await request<HealthLive>('/health/live', { timeoutMs })
  } catch {
    return null
  }
}

export async function checkReady(): Promise<HealthReady | null> {
  try {
    return await api.get<HealthReady>('/health/ready')
  } catch {
    return null
  }
}

export async function backendStatus(): Promise<{
  online: boolean
  database: string | null
}> {
  const live = await checkLive()
  if (!live) return { online: false, database: null }
  const ready = await checkReady()
  return {
    online: true,
    database: ready?.database ?? null,
  }
}

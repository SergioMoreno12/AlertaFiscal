import { api } from './client'

export type HealthLive = { status: string; service: string }
export type HealthReady = { status: string; database: string; demo?: boolean }

export async function checkLive(): Promise<HealthLive | null> {
  try {
    return await api.get<HealthLive>('/health/live')
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

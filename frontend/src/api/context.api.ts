import { api } from './client'

/**
 * Contexto externo de solo lectura.
 *
 * Estas cifras son agregados públicos (DIAN, Supersociedades). No son
 * obligaciones de la empresa, no se unen por NIT y no alimentan el pronóstico
 * ni las alertas.
 */

export type ContextLicense = {
  name: string
  id: string | null
  url: string | null
  status: 'verified' | 'uncertain' | 'restricted'
  evidence_path: string | null
}

export type ContextVersion = {
  id: number
  version_label: string
  identity_sha256: string
  acquired_at: string | null
  cutoff_date: string | null
  period_start: string | null
  period_end: string | null
  is_partial: boolean
  is_preliminary: boolean
  status: string
  row_count: number
  file_name: string | null
  source_updated_at: string | null
  is_current: boolean
  notes: string
}

export type ContextSource = {
  code: string
  name: string
  publisher: string
  dataset_id: string | null
  source_url: string
  metadata_url: string | null
  attribution: string
  attribution_url: string | null
  license: ContextLicense
  cadence: string
  description: string
  is_active: boolean
  version_count: number
  current_version: ContextVersion | null
}

export type ContextSourceDetail = ContextSource & {
  versions: ContextVersion[]
  disclaimer: string
}

export type ContextTaxSummary = {
  version_label: string
  annual: { year: number; total_cop: string; is_preliminary: boolean }
  monthly: null | { year: number; month: number; total_cop: string; is_preliminary: boolean }
  departments: { year: number; total_cop: string }
}

export type ContextBenchmark = {
  year: number
  metric: string
  metric_label: string
  sample_size: number
  total_cop: string
  median_cop: string
  mean_cop: string
  zero_count: number
  negative_count: number
}

export type ContextSummary = {
  sources: ContextSource[]
  tax: ContextTaxSummary | Record<string, never>
  benchmarks: ContextBenchmark[]
  disclaimer: string
}

export type TaxCollectionRow = {
  scope: 'national' | 'department'
  frequency: 'annual' | 'monthly'
  period_year: number
  period_month: number | null
  department_name: string | null
  series_code: string
  series_label: string
  value_cop: string
  is_preliminary: boolean
}

export type SectorBenchmarkRow = {
  year: number
  metric: string
  metric_label: string
  sector: string
  sample_size: number
  total_cop: string
  mean_cop: string
  median_cop: string
  p25_cop: string
  p75_cop: string
  min_cop: string
  max_cop: string
  zero_count: number
  negative_count: number
}

type PaginatedContext<T> = {
  items: T[]
  meta: {
    source: string
    version_label: string | null
    license_status?: ContextLicense['status']
    total: number
    page: number
    page_size: number
  }
  disclaimer: string
}

function toQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  })
  const rendered = query.toString()
  return rendered ? `?${rendered}` : ''
}

export const getContextSummary = () => api.get<ContextSummary>('/api/v1/context/summary')

export const getContextSources = () =>
  api.get<{ items: ContextSource[]; disclaimer: string }>('/api/v1/context/sources')

export const getContextSource = (code: string) =>
  api.get<ContextSourceDetail>(`/api/v1/context/sources/${encodeURIComponent(code)}`)

export const listTaxCollections = (
  params: {
    source?: string
    scope?: string
    frequency?: string
    year?: number
    month?: number
    department?: string
    series?: string
  } = {},
) => api.get<PaginatedContext<TaxCollectionRow>>(`/api/v1/context/tax-collections${toQuery(params)}`)

export const listSectorBenchmarks = (
  params: {
    source?: string
    year?: number
    metric?: string
    sector?: string
  } = {},
) => api.get<PaginatedContext<SectorBenchmarkRow>>(`/api/v1/context/sector-benchmarks${toQuery(params)}`)

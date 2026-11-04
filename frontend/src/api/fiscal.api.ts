import { api } from './client'

export type Company = {
  id: number
  name: string
  nit: string
  sector: string
  size: string
  role: string
}

type ListResponse<T> = { items: T[] }
type PaginatedResponse<T> = { items: T[]; pagination: { page: number; page_size: number; total: number; pages: number } }

export type MonthlyPoint = { month: string; income: string; expenses: string }

export type ForecastMetric = {
  mae: number
  rmse: number
  mape_percent: number | null
}

export type ForecastModelInfo = {
  selected_model: string
  label: string
  metrics: ForecastMetric
  all_metrics: Record<string, ForecastMetric>
}

export type ForecastMonthPoint = {
  month: string
  projected_income: string
  projected_expenses: string
}

export type ForecastAssumptions = {
  source?: string
  artifact_kind?: string
  schema_version?: number
  model_version?: string
  trained_at?: string
  feature_spec?: { features: string[]; lags: number; season_length: number }
  models?: Record<string, ForecastModelInfo>
  history_signature?: string
  artifact_history_signature?: string | null
  inputs_changed_since_training?: boolean
  history_months?: number
  history_period?: { from: string; to: string }
  monthly?: ForecastMonthPoint[]
  data_provenance?: { kind?: string; is_demo?: boolean; warning?: string }
  evaluation?: {
    method?: string
    test_months?: number
    train_rows?: number
    selection_metric?: string
  }
}

export type ReviewNowItem = {
  id: number
  title: string
  priority: 'alta' | 'media' | 'baja'
  origin: Alert['origin']
  origin_label: string
  status: Alert['status']
  action: { label: string; screen: string }
}

export type Dashboard = {
  period: { from: string; to: string }
  totals: {
    income: string
    expenses: string
    result: string
    pending_income: string
    pending_expenses: string
  }
  monthly: MonthlyPoint[]
  alerts: { open: number }
  obligations: Array<{
    id: number
    name: string
    period: string
    due_date: string | null
    status: string
    estimated_amount: string | null
  }>
  latest_forecast: null | {
    id: number
    method: string
    method_label: string
    horizon_months: number
    cutoff_date: string
    projected_income: string
    projected_expenses: string
    projected_result: string
    model_version: string | null
    created_at: string
    trained_at?: string | null
    stale_inputs: boolean
    is_demo: boolean
    monthly: ForecastMonthPoint[]
    models: Record<string, ForecastModelInfo>
  }
  reserve: {
    target: string
    reserved: string
    pending: string
    coverage_percent: string
    has_target: boolean
    plan_period: string | null
  }
  review_now: ReviewNowItem[]
  plan: null | {
    id: number
    name: string
    period: string
    version: number
    status: string
    projected_income: string
    projected_expenses: string
    estimated_reserve: string
    reserved: string
    coverage_percent: string
  }
}

export type Income = {
  id: number
  doc_number: string
  issue_date: string
  description: string
  counterparty_id: number | null
  subtotal: string
  tax_amount: string
  total: string
  status: 'pending' | 'collected' | 'void'
}

export type Expense = {
  id: number
  doc_number: string
  issue_date: string
  category: string
  description: string
  counterparty_id: number | null
  subtotal: string
  tax_amount: string
  total: string
  status: 'pending' | 'paid' | 'void'
  reviewed: boolean
}

export type Counterparty = { id: number; name: string; nit: string | null; kind: 'client' | 'supplier' }

export type Alert = {
  id: number
  title: string
  description: string
  priority: 'alta' | 'media' | 'baja'
  origin: 'erp' | 'plan' | 'proyeccion' | 'configuracion'
  origin_label?: string
  status: 'pending' | 'in_review' | 'reviewed'
  due_date: string | null
  created_at: string
  action?: { label: string; screen: string }
  comments?: Array<{ id: number; body: string; user_id: number | null; created_at: string }>
}

export type Obligation = {
  id: number
  name: string
  period: string
  due_date: string
  estimated_amount: string | null
  status: 'pending' | 'filed' | 'paid' | 'void'
  notes: string
}

export type PlanVersion = {
  id: number
  version: number
  status: 'draft' | 'reviewed' | 'archived'
  assumptions: Record<string, unknown>
  projected_income: string
  projected_expenses: string
  estimated_reserve: string
  notes: string
  created_at: string
}

export type Plan = {
  id: number
  name: string
  period: string
  status: 'draft' | 'reviewed' | 'archived'
  current_version: number
  created_at: string
  version?: PlanVersion
  versions?: PlanVersion[]
}

export type PlanDetail = Plan & { versions: PlanVersion[] }

export type FiscalParameter = {
  id: number
  key: string
  label: string
  value: string
  unit: 'percent' | 'cop' | 'months' | 'count'
  source: string
  reviewed: boolean
  valid_from: string | null
  valid_to: string | null
}

export type ForecastRun = {
  id: number
  method: string
  method_label?: string
  horizon_months: number
  cutoff_date: string
  projected_income: string
  projected_expenses: string
  projected_result?: string
  model_version: string | null
  created_at: string
  assumptions?: ForecastAssumptions
  monthly?: ForecastMonthPoint[]
  models?: Record<string, ForecastModelInfo>
  history_months?: number
  history_period?: { from: string; to: string }
  trained_at?: string | null
  stale_inputs?: boolean
  is_demo?: boolean
  scope?: string | null
  artifact_sha256?: string | null
  data_provenance?: { kind?: string; is_demo?: boolean; warning?: string }
}

export type ReserveEntry = {
  id: number
  amount: string
  reserved_on: string
  note: string
  plan_version_id: number | null
}

export type ForecastResult = {
  available: boolean
  code?: string
  reason?: string
  manual_available?: boolean
  details?: Record<string, unknown>
  months_with_history?: number
  id?: number
  method?: string
  method_label?: string
  horizon_months?: number
  cutoff_date?: string
  estimated?: boolean
  disclaimer?: string
  projected_income?: string
  projected_expenses?: string
  projected_result?: string
  model_version?: string | null
  created_at?: string
  assumptions?: ForecastAssumptions
  monthly?: ForecastMonthPoint[]
  models?: Record<string, ForecastModelInfo>
  history_months?: number
  history_period?: { from: string; to: string }
  trained_at?: string | null
  stale_inputs?: boolean
  is_demo?: boolean
  scope?: string | null
  artifact_sha256?: string | null
  data_provenance?: { kind?: string; is_demo?: boolean; warning?: string }
}

export type AuditEvent = {
  id: number
  action: string
  resource: string
  detail: Record<string, unknown>
  actor_id: number | null
  request_id: string | null
  created_at: string
}

export const getCompanies = () => api.get<ListResponse<Company>>('/api/v1/companies')

export const getDashboard = (companyId: number) => api.get<Dashboard>(`/api/v1/companies/${companyId}/dashboard`)

export const listIncome = (companyId: number) =>
  api.get<PaginatedResponse<Income>>(`/api/v1/companies/${companyId}/income`)

export const createIncome = (
  companyId: number,
  payload: {
    doc_number: string
    issue_date: string
    description?: string
    counterparty_id?: number | null
    subtotal: string
    tax_amount: string
    total?: string
    status?: 'pending' | 'collected'
  },
) => api.post<Income>(`/api/v1/companies/${companyId}/income`, payload)

export const listExpenses = (companyId: number) =>
  api.get<PaginatedResponse<Expense>>(`/api/v1/companies/${companyId}/expenses`)

export const createExpense = (
  companyId: number,
  payload: {
    doc_number: string
    issue_date: string
    category?: string
    description?: string
    counterparty_id?: number | null
    subtotal: string
    tax_amount: string
    total?: string
    status?: 'pending' | 'paid'
  },
) => api.post<Expense>(`/api/v1/companies/${companyId}/expenses`, payload)

export const updateExpense = (companyId: number, expenseId: number, payload: { reviewed?: boolean; category?: string; description?: string }) =>
  api.patch<Expense>(`/api/v1/companies/${companyId}/expenses/${expenseId}`, payload)

export const listCounterparties = (companyId: number) =>
  api.get<ListResponse<Counterparty>>(`/api/v1/companies/${companyId}/counterparties`)

export const createCounterparty = (companyId: number, payload: { name: string; nit?: string; kind: 'client' | 'supplier' }) =>
  api.post<Counterparty>(`/api/v1/companies/${companyId}/counterparties`, payload)

export const listAlerts = (companyId: number) => api.get<ListResponse<Alert>>(`/api/v1/companies/${companyId}/alerts`)

export const evaluateAlerts = (companyId: number) =>
  api.post<{ created: number; updated: number; items: Array<{ id: number; title: string; origin: string; priority: string; status: string; action: { label: string; screen: string } }> }>(
    `/api/v1/companies/${companyId}/alerts/evaluate`,
    {},
  )

export const createAlert = (
  companyId: number,
  payload: { title: string; description?: string; priority: Alert['priority']; origin: Alert['origin'] },
) => api.post<Alert>(`/api/v1/companies/${companyId}/alerts`, payload)

export const getAlert = (companyId: number, alertId: number) =>
  api.get<Alert>(`/api/v1/companies/${companyId}/alerts/${alertId}`)

export const updateAlert = (companyId: number, alertId: number, payload: { status?: Alert['status']; priority?: Alert['priority'] }) =>
  api.patch<Alert>(`/api/v1/companies/${companyId}/alerts/${alertId}`, payload)

export const addAlertComment = (companyId: number, alertId: number, body: string) =>
  api.post<{ id: number; body: string; created_at: string }>(`/api/v1/companies/${companyId}/alerts/${alertId}/comments`, { body })

export const listObligations = (companyId: number) =>
  api.get<ListResponse<Obligation>>(`/api/v1/companies/${companyId}/obligations`)

export const createObligation = (
  companyId: number,
  payload: { name: string; period?: string; due_date: string; estimated_amount?: string | null; notes?: string },
) => api.post<Obligation>(`/api/v1/companies/${companyId}/obligations`, payload)

export const updateObligation = (
  companyId: number,
  obligationId: number,
  payload: { status?: Obligation['status']; notes?: string; estimated_amount?: string | null },
) => api.patch<Obligation>(`/api/v1/companies/${companyId}/obligations/${obligationId}`, payload)

export const listPlans = (companyId: number) => api.get<ListResponse<Plan>>(`/api/v1/companies/${companyId}/plans`)

export const getPlan = (companyId: number, planId: number) =>
  api.get<PlanDetail>(`/api/v1/companies/${companyId}/plans/${planId}`)

export const createPlanVersion = (
  companyId: number,
  planId: number,
  payload: {
    projected_income: string
    projected_expenses: string
    estimated_reserve?: string
    assumptions?: Record<string, unknown>
    notes?: string
  },
) => api.post<Plan>(`/api/v1/companies/${companyId}/plans/${planId}/versions`, payload)

export const listFiscalParameters = (companyId: number) =>
  api.get<ListResponse<FiscalParameter>>(`/api/v1/companies/${companyId}/fiscal-parameters`)

export const listReserves = (companyId: number) =>
  api.get<ListResponse<ReserveEntry> & { total: string }>(`/api/v1/companies/${companyId}/reserve-entries`)

export const createReserve = (
  companyId: number,
  payload: { amount: string; reserved_on: string; note?: string; plan_version_id?: number | null },
) => api.post<ReserveEntry>(`/api/v1/companies/${companyId}/reserve-entries`, payload)

export const createPlan = (
  companyId: number,
  payload: {
    name?: string
    period?: string
    projected_income?: string
    projected_expenses?: string
    estimated_reserve?: string
    assumptions?: Record<string, unknown>
    notes?: string
  },
) => api.post<Plan>(`/api/v1/companies/${companyId}/plans`, payload)

export const reviewPlanVersion = (companyId: number, planId: number, versionId: number) =>
  api.post<Plan>(`/api/v1/companies/${companyId}/plans/${planId}/versions/${versionId}/review`)

export const listForecasts = (companyId: number) =>
  api.get<ListResponse<ForecastRun>>(`/api/v1/companies/${companyId}/forecasts`)

export const createForecast = (companyId: number, payload: { horizon_months?: number; lookback_months?: number; income_growth_percent?: string; expense_growth_percent?: string }) =>
  api.post<ForecastResult>(`/api/v1/companies/${companyId}/forecasts`, payload)

export const createModelForecast = (companyId: number, payload: { horizon_months?: number } = {}) =>
  api.post<ForecastResult>(`/api/v1/companies/${companyId}/forecasts/model`, payload)

export const listAudit = (companyId: number) =>
  api.get<PaginatedResponse<AuditEvent>>(`/api/v1/companies/${companyId}/audit`)

export type MonitoringStatus = 'pending' | 'normal' | 'watch' | 'degraded'

export type MonitoringTarget = {
  status: MonitoringStatus
  rolling_normalized_error_pct: number | null
  ratio_to_reference: number | null
  reference_normalized_error_pct: number
  months_used: string[]
  pending_months: string[]
}

export type MonitoringRow = {
  forecast_run_id: number
  target: 'income' | 'expenses'
  forecast_month: string
  horizon_step: number
  predicted_value: string
  actual_value: string | null
  absolute_error: string | null
  normalized_error_pct: number | null
  status: MonitoringStatus
  model_version: string | null
}

export type MonitoringView = {
  status: MonitoringStatus
  targets: Record<'income' | 'expenses', MonitoringTarget>
  model_version: string | null
  last_forecast_at: string | null
  inputs_changed_since_training: boolean
  reference: string
  thresholds: { normal: string; watch: string; degraded: string; rolling_months: number }
  rows: MonitoringRow[]
  operations: {
    requests: number
    outcomes: Record<string, number>
    latency_ms: { p50: number | null; p95: number | null }
    last_model_version: string | null
    last_request_at: string | null
  }
}

export const getMonitoring = (companyId: number) =>
  api.get<MonitoringView>(`/api/v1/companies/${companyId}/monitoring`)

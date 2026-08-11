export interface ModelSettings {
  current_model: string;
  available_models: string[];
}

export interface EncryptionCategory {
  key: string;
  label: string;
  encrypt_enabled: boolean;
  encrypted_count: number;
  plain_count: number;
  total: number;
}

export interface EncryptionSettings {
  categories: EncryptionCategory[];
}

export interface AdminInfo {
  email: string;
  added_by: string | null;
  created_at: string | null;
}

export interface PermissionsData {
  superadmin: string;
  current_user: string;
  admins: AdminInfo[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  startedAt: string;
  sessionId: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  source?: 'faq' | 'document' | 'ai' | 'fallback' | 'guardrail' | 'handoff';
  handoff_url?: string | null;
}

export interface AdminSession {
  id: string;
  created_at: string;
  updated_at: string | null;
  message_count: number;
  user_name: string | null;
}

export interface AdminMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  source: string | null;
  created_at: string;
}

export interface AdminSessionDetail {
  session: AdminSession;
  messages: AdminMessage[];
}

export interface SuggestedQuestion {
  id: string;
  label: string;
  query: string;
  url?: string;
}

export interface ChatResponse {
  answer: string;
  source: 'faq' | 'document' | 'ai' | 'fallback' | 'guardrail' | 'handoff';
  session_id: string;
  handoff_url?: string | null;
}

export interface SuggestedQuestionsResponse {
  questions: SuggestedQuestion[];
}

export interface AdminDocument {
  id: number;
  logical_name: string;
  version: number;
  original_filename: string;
  status: 'uploaded' | 'parsing' | 'embedding' | 'review' | 'ready' | 'rejected' | 'archived' | 'failed' | 'deleted';
  parser_type: string | null;
  is_active: boolean;
  is_deleted: boolean;
  review_note: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  deleted_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
  has_md: boolean;
  has_json: boolean;
  has_pdf: boolean;
}

export interface AdminDocumentDetail {
  document: AdminDocument;
  md_content: string | null;
  json_content: string | null;
}

export interface AdminFaq {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  aliases: string[];
  search_hints: string[];
  source_files: string[];
  direct_answer: boolean;
  top_k: number;
}

export interface PromptConfig {
  prompt_key: string;
  label: string;
  content: string;
  updated_at: string;
}

export interface ProcessingLog {
  id: number;
  document_id: number | null;
  log_type: string;
  status: string;
  message: string;
  detail: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: string | null;
  created_at: string;
}

export interface ChatLog {
  id: number;
  session_id: string;
  question: string;
  retrieval_chunks: string[];
  answer: string;
  source: string | null;
  error: string | null;
  processing_status: string;
  embedding_cost: number;
  llm_cost: number;
  created_at: string;
}

export type OperationsSignalType = 'handoff' | 'cancel' | 'safety' | 'error';

export interface OperationsMetricSummary {
  visitors: number;
  chats: number;
  handoffs: number;
  cancels: number;
  safety: number;
  failed: number;
}

export interface OperationsDailyMetric {
  date: string;
  visitors: number;
  chats: number;
  handoffs: number;
  cancels: number;
  safety: number;
}

export interface HandoffCategoryMetric {
  key: string;
  label: string;
  count: number;
}

export interface QuestionCategoryMetric {
  key: string;
  label: string;
  count: number;
}

export interface AnswerSourceSummary {
  faq: number;
  llm: number;
  other: number;
  total: number;
}

export interface BillingCostRecord {
  id: number;
  billing_month: string;
  amount_krw: number;
  source: 'nxavis_manual' | string;
  note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperationsMonthlyMetric {
  month: string;
  visitors: number;
  chats: number;
  handoffs: number;
  cancels: number;
}

export interface OperationsHourlyMetric {
  hour: number;
  label: string;
  visitors: number;
  chats: number;
}

export interface AnalyticsPeak {
  label: string;
  count: number;
}

export interface OperationsAnalyticsData {
  period_months: number;
  hourly_days: number;
  generated_at: string;
  monthly: OperationsMonthlyMetric[];
  hourly: OperationsHourlyMetric[];
  highlights: {
    busiest_visitor_month: AnalyticsPeak | null;
    busiest_chat_month: AnalyticsPeak | null;
    busiest_visitor_hour: AnalyticsPeak | null;
    busiest_chat_hour: AnalyticsPeak | null;
  };
  question_categories_top5: QuestionCategoryMetric[];
  answer_source_summary: AnswerSourceSummary;
  handoff_categories: HandoffCategoryMetric[];
}

export interface CostAccountSummary {
  account_id: string;
  account_name: string;
  total_krw: number;
}

export interface CostServiceTotal {
  service_name: string;
  amount_krw: number;
}

export interface CostDailyTotal {
  date: string;
  day: number;
  total_krw: number;
  services: Record<string, number>;
}

export interface CostServiceDailyRow {
  service_name: string;
  total_krw: number;
  daily: Record<string, number>;
}

export interface CostManagementData {
  billing_month: string;
  selected_account_id: string;
  accounts: CostAccountSummary[];
  actual_invoice_krw: number | null;
  usage_total_krw: number;
  difference_krw: number | null;
  service_totals: CostServiceTotal[];
  daily_totals: CostDailyTotal[];
  service_daily_rows: CostServiceDailyRow[];
  monthly_history: BillingCostRecord[];
}

export type SystemHealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown' | 'not_configured';

export interface SystemHealthCheck {
  key: 'application' | 'database_read' | 'database_write' | 'ec2';
  label: string;
  status: SystemHealthStatus;
  message: string;
  latency_ms: number | null;
  checked_at: string;
  details: Record<string, string | number | null>;
}

export interface SystemHealthData {
  overall_status: 'healthy' | 'degraded' | 'critical';
  generated_at: string;
  checks: SystemHealthCheck[];
}

export interface OperationsAttentionItem {
  id: number;
  alert_id: number;
  session_id: string;
  type: OperationsSignalType;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  status: 'open' | 'checking' | 'resolved';
  assigned_to: string | null;
  note: string | null;
  question: string;
  answer: string;
  processing_status: string;
  created_at: string;
}

export interface OperationsDashboardData {
  period_days: number;
  generated_at: string;
  summary: OperationsMetricSummary;
  previous_summary: OperationsMetricSummary;
  changes: Record<keyof OperationsMetricSummary, number | null>;
  daily: OperationsDailyMetric[];
  handoff_categories: HandoffCategoryMetric[];
  question_categories_top5: QuestionCategoryMetric[];
  answer_source_summary: AnswerSourceSummary;
  billing_costs: BillingCostRecord[];
  attention: OperationsAttentionItem[];
  recent_sessions: AdminSession[];
}

export interface OperationsAlertUpdateResult {
  id: number;
  status: 'open' | 'checking' | 'resolved';
  assigned_to: string | null;
  note: string | null;
  resolved_at: string | null;
  updated_at: string | null;
}

export interface PromptPayload {
  prompt_key: string;
  label: string;
  content: string;
}

export interface CustomTableSummary {
  id: number;
  name: string;
  description: string | null;
  row_count: number;
  created_at: string;
}

export interface CustomColumnDef {
  id: number;
  column_name: string;
  column_type: 'text' | 'number' | 'date';
  sort_order: number;
}

export interface CustomRowData {
  id: number;
  data: Record<string, string>;
  created_at: string;
}

export interface CustomTableDetail {
  id: number;
  name: string;
  description: string | null;
  columns: CustomColumnDef[];
  rows: CustomRowData[];
}

export interface DbTableMeta {
  name: string;
  display_name: string;
  description: string;
  row_count: number;
  columns: string[];
}

export interface DbTableData {
  columns: string[];
  rows: Record<string, unknown>[];
  editable?: boolean;
  droppable?: boolean;
  restriction_reason?: string | null;
  protected_columns?: string[];
  total: number;
  page: number;
  limit: number;
}

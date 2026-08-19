import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import {
  Bot,
  BellRing,
  HelpCircle,
  Database,
  Eye,
  FileCheck2,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import { adminApi, clearAdminToken, getAdminToken, saveAdminToken } from '../services/api';
import InfoTooltip from '../components/admin/InfoTooltip';
import AdminOperationsOverview from '../components/admin/AdminOperationsOverview';
import OperationsReview from '../components/admin/OperationsReview';
import CostManagement from '../components/admin/CostManagement';
import SecurityVault from '../components/admin/SecurityVault';
import {
  AdminDocument,
  AdminDocumentDetail,
  AdminFaq,
  AdminSession,
  AuditLog,
  ChatLog,
  CustomTableDetail,
  DbTableData,
  DbTableMeta,
  EncryptionSettings,
  ModelSettings,
  CostManagementData,
  OpenAiCostData,
  OperationsDashboardData,
  OperationsAnalyticsData,
  PermissionAccess,
  PermissionsData,
  ProcessingLog,
  PromptConfig,
  PromptPayload,
  SystemHealthData,
} from '../types';

type TabKey = 'dashboard' | 'improvements' | 'costs' | 'documents' | 'faqs' | 'prompts' | 'chats' | 'data' | 'db' | 'security' | 'settings' | 'permissions';

const ADMIN_VIEW_STORAGE_KEY = 'coa-admin-view';
const CHAT_SESSION_PAGE_SIZE = 20;
const ADMIN_TAB_KEYS = new Set<TabKey>([
  'dashboard',
  'improvements',
  'costs',
  'documents',
  'faqs',
  'prompts',
  'chats',
  'data',
  'db',
  'security',
  'settings',
  'permissions',
]);

interface StoredAdminView {
  activeTab: TabKey;
  chatStartDate: string;
  chatEndDate: string;
  chatSessionPage: number;
}

function readStoredAdminView(): StoredAdminView {
  const fallback: StoredAdminView = {
    activeTab: 'dashboard',
    chatStartDate: '',
    chatEndDate: '',
    chatSessionPage: 1,
  };
  try {
    const raw = window.sessionStorage.getItem(ADMIN_VIEW_STORAGE_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<StoredAdminView>;
    const storedTab = stored.activeTab && ADMIN_TAB_KEYS.has(stored.activeTab) ? stored.activeTab : 'dashboard';
    return {
      activeTab: storedTab === 'data' ? 'db' : storedTab,
      chatStartDate: typeof stored.chatStartDate === 'string' ? stored.chatStartDate : '',
      chatEndDate: typeof stored.chatEndDate === 'string' ? stored.chatEndDate : '',
      chatSessionPage: typeof stored.chatSessionPage === 'number' && stored.chatSessionPage >= 1
        ? Math.floor(stored.chatSessionPage)
        : 1,
    };
  } catch {
    return fallback;
  }
}

const NAV_GROUPS: { label: string; items: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    label: '운영',
    items: [
      { key: 'dashboard' as const, label: '대시보드', icon: LayoutDashboard },
      { key: 'improvements' as const, label: '개선 검토', icon: BellRing },
      { key: 'costs' as const, label: '비용 관리', icon: WalletCards },
    ],
  },
  {
    label: '콘텐츠',
    items: [
      { key: 'documents' as const, label: '문서 검토', icon: FileCheck2 },
      { key: 'faqs' as const, label: 'FAQ 관리', icon: HelpCircle },
      { key: 'prompts' as const, label: '프롬프트', icon: Bot },
    ],
  },
  {
    label: '관리 도구',
    items: [
      { key: 'chats' as const, label: '로그·내보내기', icon: ScrollText },
      { key: 'db' as const, label: '데이터 콘솔', icon: Database },
      { key: 'security' as const, label: '보안 정보', icon: LockKeyhole },
      { key: 'settings' as const, label: '설정', icon: Settings },
      { key: 'permissions' as const, label: '권한 관리', icon: ShieldCheck },
    ],
  },
];

const PAGE_META: Record<TabKey, { title: string; description: string }> = {
  dashboard: { title: '운영 대시보드', description: '방문과 대화 흐름, 상담 전환, 취소·안전 신호를 한눈에 확인합니다.' },
  improvements: { title: '개선 검토', description: '감지된 대화의 원인을 확인하고 수정한 답변을 다시 검증합니다.' },
  costs: { title: '비용 관리', description: '업로드한 원화 비용을 월·서비스·일자별로 관리하고 분석합니다.' },
  documents: { title: '문서 검토', description: '업로드 문서를 검토하고 승인된 지식만 운영 검색에 반영합니다.' },
  faqs: { title: 'FAQ 관리', description: '자주 묻는 질문과 답변, 검색 키워드를 관리합니다.' },
  prompts: { title: '프롬프트', description: '상담 응답과 시스템 동작을 결정하는 프롬프트를 관리합니다.' },
  chats: { title: '로그·내보내기', description: '채팅·처리·감사 로그를 조회하고 필요한 데이터를 내보냅니다.' },
  data: { title: '데이터 콘솔', description: '시스템 데이터는 안전하게 조회하고 업무 데이터는 직접 구성하고 관리합니다.' },
  db: { title: '데이터 콘솔', description: '시스템 데이터는 안전하게 조회하고 업무 데이터는 직접 구성하고 관리합니다.' },
  security: { title: '보안 정보', description: '운영 접속 계정과 허용된 환경설정을 별도 잠금으로 관리합니다.' },
  settings: { title: '설정', description: 'AI 모델과 데이터 암호화 정책을 설정합니다.' },
  permissions: { title: '권한 관리', description: '관리자 계정과 최상위 관리자 권한을 관리합니다.' },
};

interface ModelMeta {
  desc: string;
  speed: string;
  ctx: string;
  inputPrice: number;
  outputPrice: number;
  intelligence: number; // 1~10: 원시 추론·지시 이행 능력
  recommend: number;    // 1~10: 챗봇 운영 추천도
  badge?: string;
  legacy?: boolean;
}

// 속도 문자열 → 정렬용 숫자 (낮을수록 빠름)
const SPEED_RANK: Record<string, number> = {
  '매우 빠름': 1, '빠름': 2, '중간': 3, '느림': 4, '미확인': 5,
};

const MODEL_DB: Record<string, ModelMeta> = {
  // ── GPT-5 계열 (2025.08 출시, 현재 최신) ────────────────
  'gpt-5':        { desc: '최신 GPT 플래그십. gpt-4.1 대비 추론·지시 이행 전 분야 향상. 복잡한 다단계 작업·코딩·분석에 최고 수준. 비용이 gpt-5-mini의 ~5배로 중요 응답에 선택 사용 권장', speed: '중간', ctx: '미확인', inputPrice: 2.50, outputPrice: 15.00, intelligence: 10, recommend: 9, badge: '최신' },
  'gpt-5-mini':   { desc: '빠르고 경제적인 GPT-5 경량판. gpt-4.1급 지능에 가격은 절반 이하($0.25/$2). 400K 컨텍스트로 긴 문서 처리 가능. 일상적인 챗봇 응답에 현재 최고 가성비', speed: '빠름', ctx: '400K', inputPrice: 0.25, outputPrice: 2.00, intelligence: 9, recommend: 10, badge: '최신' },
  // ── GPT-4.1 계열 (2025.04 출시, 현재 최신) ───────────────
  'gpt-4.1':      { desc: '2025년 4월 출시. gpt-4o보다 코딩·지시 이행 성능 높고 가격은 20% 저렴. 1M 토큰 컨텍스트로 긴 문서에 유리. gpt-5 계열 미지원 환경의 대안', speed: '중간', ctx: '1M', inputPrice: 2.00, outputPrice: 8.00, intelligence: 9, recommend: 8, badge: '추천' },
  'gpt-4.1-mini': { desc: '4.1의 경량판. gpt-4o-mini보다 성능 개선, 가격은 비슷. FAQ 답변·요약·분류 등 일상적 챗봇 응답에 최적. 비용과 품질의 균형이 가장 좋음', speed: '빠름', ctx: '1M', inputPrice: 0.20, outputPrice: 0.80, intelligence: 7, recommend: 10, badge: '추천' },
  'gpt-4.1-nano': { desc: '초경량 초저가 모델. 단순 키워드 매핑·짧은 라벨링·빠른 분류에 한정 사용. 복잡한 질문에는 엉뚱한 답변 가능성 높아 챗봇 메인 모델로 부적합', speed: '매우 빠름', ctx: '1M', inputPrice: 0.05, outputPrice: 0.20, intelligence: 4, recommend: 4 },
  // ── GPT-4o 계열 ──────────────────────────────────────────
  'gpt-4o':       { desc: '2024년 플래그십. gpt-4.1 출시 전까지 최고 성능. 지시 이행·추론·코드 생성 균형 우수. gpt-4.1로의 전환을 고려할 수 있으나 현재도 충분히 좋은 선택', speed: '중간', ctx: '128K', inputPrice: 2.50, outputPrice: 10.00, intelligence: 8, recommend: 8 },
  'gpt-4o-mini':  { desc: '가장 많이 쓰이는 경량 모델. gpt-4o 대비 94% 저렴하지만 복잡한 다단계 추론에선 오류 발생. 단순 FAQ·요약 등에 적합. gpt-4.1-mini로 대체 검토 권장', speed: '빠름', ctx: '128K', inputPrice: 0.15, outputPrice: 0.60, intelligence: 6, recommend: 7 },
  // ── GPT-4 Turbo·GPT-4 (레거시) ──────────────────────────
  'gpt-4-turbo':  { desc: '레거시. gpt-4o 출시 이후 동일 가격대에서 성능 역전됨. gpt-4o 또는 gpt-4.1 사용 권장. 신규 프로젝트 사용 비권장', speed: '중간', ctx: '128K', inputPrice: 5.00, outputPrice: 15.00, intelligence: 7, recommend: 2, legacy: true },
  'gpt-4':        { desc: '레거시. 8K 컨텍스트 제한에 출력 $60/1M으로 현존 최고가. 현재 기준 성능·비용 모두 최하위. 즉시 gpt-4o 또는 gpt-4.1로 교체 필요', speed: '느림', ctx: '8K', inputPrice: 30.00, outputPrice: 60.00, intelligence: 6, recommend: 1, legacy: true },
  'gpt-4-0613':   { desc: 'gpt-4 스냅샷 버전. gpt-4와 동일한 가격·성능 한계. 레거시 코드 호환 목적 외 사용 불필요', speed: '느림', ctx: '8K', inputPrice: 30.00, outputPrice: 60.00, intelligence: 6, recommend: 1, legacy: true },
  // ── GPT-3.5 계열 (레거시) ────────────────────────────────
  'gpt-3.5-turbo': { desc: '레거시. gpt-4o-mini 출시 후 사실상 대체됨. gpt-4o-mini가 더 저렴하거나 비슷한 가격에 훨씬 높은 성능. 신규 사용 비권장', speed: '매우 빠름', ctx: '16K', inputPrice: 0.50, outputPrice: 1.00, intelligence: 3, recommend: 2, legacy: true },
  // ── o1 계열 (추론 모델, 레거시) ─────────────────────────
  'o1':           { desc: '추론 모델 원조. 답변 전 내부에서 수십~수백 번 생각하는 방식. 그러나 o3 출시 후 성능·가격 모두 역전됨. 내부 추론 토큰으로 실비용은 표시의 3~10배. o3 사용 권장', speed: '느림', ctx: '128K', inputPrice: 15.00, outputPrice: 60.00, intelligence: 8, recommend: 2, legacy: true },
  'o1-mini':      { desc: 'o1 경량판. 그러나 o3-mini보다 비싸고 성능도 낮아 현재 존재 의미가 약함. o3-mini 또는 o4-mini 사용 권장', speed: '중간', ctx: '128K', inputPrice: 0.55, outputPrice: 2.20, intelligence: 6, recommend: 2, legacy: true },
  // ── o3 계열 (추론 모델) ──────────────────────────────────
  'o3-mini':      { desc: '경량 추론 모델. o1-mini 대비 성능 향상, 가격은 동급. 수학·알고리즘·코드 디버깅 등 명확한 정답이 있는 문제에 특화. 일반 대화에는 o4-mini가 나음', speed: '빠름', ctx: '200K', inputPrice: 1.10, outputPrice: 4.40, intelligence: 8, recommend: 7 },
  'o3':           { desc: '고성능 추론 모델. o1보다 성능 높고 가격은 75% 낮음. 수학·과학·복잡한 코드 분석에 최강. 단, 추론 토큰 추가 과금으로 실비용 주의. 일반 챗봇보다 전문 분석 도구에 적합', speed: '중간', ctx: '200K', inputPrice: 2.00, outputPrice: 8.00, intelligence: 10, recommend: 6 },
  // ── o4 계열 ──────────────────────────────────────────────
  'o4-mini':      { desc: '2025년 4월 최신 추론 소형 모델. o3-mini와 같은 가격($1.10/$4.40)에 이미지 이해 추가, 성능은 o3-mini보다 높음. 추론 모델 중 현재 가성비 최고', speed: '빠름', ctx: '128K', inputPrice: 1.10, outputPrice: 4.40, intelligence: 9, recommend: 8, badge: '최신' },
};

type ModelSortKey = 'price' | 'speed' | 'intelligence' | 'recommend' | 'value';

function getModelMeta(name: string): ModelMeta {
  if (MODEL_DB[name]) return MODEL_DB[name];
  const sortedKeys = Object.keys(MODEL_DB).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (name.startsWith(key + '-') || name.startsWith(key + ':')) {
      return { ...MODEL_DB[key], badge: undefined };
    }
  }
  if (name.startsWith('gpt-5')) return { desc: 'GPT-5 계열 최신 모델. 현재 최고 수준의 지시 이행·추론 능력', speed: '중간', ctx: '미확인', inputPrice: 0, outputPrice: 0, intelligence: 10, recommend: 9, badge: '최신' };
  if (name.startsWith('o4')) return { desc: 'OpenAI o4 계열 추론 모델', speed: '중간', ctx: '미확인', inputPrice: 0, outputPrice: 0, intelligence: 9, recommend: 7, badge: '최신' };
  if (name.startsWith('o3')) return { desc: 'OpenAI o3 계열 추론 모델', speed: '중간', ctx: '미확인', inputPrice: 0, outputPrice: 0, intelligence: 8, recommend: 6 };
  if (name.startsWith('o1')) return { desc: 'OpenAI o1 계열 추론 모델 (레거시)', speed: '느림', ctx: '미확인', inputPrice: 0, outputPrice: 0, intelligence: 7, recommend: 2, legacy: true };
  if (name.startsWith('gpt-4.1')) return { desc: 'GPT-4.1 계열 모델', speed: '중간', ctx: '1M', inputPrice: 0, outputPrice: 0, intelligence: 8, recommend: 8, badge: '추천' };
  if (name.startsWith('gpt-4o')) return { desc: 'GPT-4o 계열 모델', speed: '중간', ctx: '128K', inputPrice: 0, outputPrice: 0, intelligence: 7, recommend: 7 };
  if (name.startsWith('gpt-4')) return { desc: 'GPT-4 계열 레거시 모델', speed: '중간', ctx: '미확인', inputPrice: 0, outputPrice: 0, intelligence: 6, recommend: 2, legacy: true };
  if (name.startsWith('gpt-3')) return { desc: 'GPT-3.5 계열 레거시 모델', speed: '빠름', ctx: '미확인', inputPrice: 0, outputPrice: 0, intelligence: 3, recommend: 1, legacy: true };
  return { desc: 'OpenAI 신규 모델. platform.openai.com/docs/pricing 참고', speed: '미확인', ctx: '미확인', inputPrice: 0, outputPrice: 0, intelligence: 5, recommend: 5 };
}

function sortModels(models: string[], key: ModelSortKey, dir: 'asc' | 'desc'): string[] {
  const scored = models.map((m) => {
    const info = getModelMeta(m);
    const total = info.inputPrice + info.outputPrice;
    const value = total > 0 ? (info.intelligence / total) * 10 : info.intelligence;
    const scores: Record<ModelSortKey, number> = {
      price: total,
      speed: SPEED_RANK[info.speed] ?? 5,
      intelligence: info.intelligence,
      recommend: info.recommend,
      value,
    };
    return { m, score: scores[key] };
  });
  scored.sort((a, b) => dir === 'asc' ? a.score - b.score : b.score - a.score);
  return scored.map((x) => x.m);
}

const EMPTY_FAQ: AdminFaq = {
  id: '',
  category: '',
  question: '',
  answer: '',
  keywords: [],
  aliases: [],
  search_hints: [],
  source_files: [],
  direct_answer: true,
  top_k: 4,
};

const EMPTY_PROMPT: PromptPayload = {
  prompt_key: '',
  label: '',
  content: '',
};

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100';
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100';

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function joinCsv(values: string[]): string {
  return values.join(', ');
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR');
}

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [authenticated, setAuthenticated] = useState(() => !!getAdminToken());
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [initialAdminView] = useState(readStoredAdminView);

  const tabParam = searchParams.get('tab');
  const normalizedTabParam = tabParam === 'data' ? 'db' : tabParam;
  const activeTab = normalizedTabParam && ADMIN_TAB_KEYS.has(normalizedTabParam as TabKey)
    ? (normalizedTabParam as TabKey)
    : initialAdminView.activeTab;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');

  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [prompts, setPrompts] = useState<PromptConfig[]>([]);
  const [faqs, setFaqs] = useState<AdminFaq[]>([]);
  const [processingLogs, setProcessingLogs] = useState<ProcessingLog[]>([]);
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [operationsData, setOperationsData] = useState<OperationsDashboardData | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<OperationsAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsYear, setAnalyticsYear] = useState('all');
  const [analyticsMonth, setAnalyticsMonth] = useState('all');
  const [dashboardCostData, setDashboardCostData] = useState<CostManagementData | null>(null);
  const [dashboardOpenAiCostData, setDashboardOpenAiCostData] = useState<OpenAiCostData | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [selectedDocument, setSelectedDocument] = useState<AdminDocumentDetail | null>(null);
  const [documentReviewOpen, setDocumentReviewOpen] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [documentMdDraft, setDocumentMdDraft] = useState('');
  const [documentJsonDraft, setDocumentJsonDraft] = useState('');
  const [documentArtifactSaving, setDocumentArtifactSaving] = useState(false);
  const [documentPermanentDeleteBusy, setDocumentPermanentDeleteBusy] = useState(false);
  const [faqReconvertBusy, setFaqReconvertBusy] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [mdFile, setMdFile] = useState<File | null>(null);
  const [mdTitle, setMdTitle] = useState('');
  const [mdCategory, setMdCategory] = useState('');
  const [faqMdFile, setFaqMdFile] = useState<File | null>(null);
  const [faqMdCategory, setFaqMdCategory] = useState('');
  const [documentUploadMode, setDocumentUploadMode] = useState<'pdf' | 'md' | 'faq' | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [reindexBusy, setReindexBusy] = useState(false);

  const [faqForm, setFaqForm] = useState(EMPTY_FAQ);
  const [faqKeywords, setFaqKeywords] = useState('');
  const [faqAliases, setFaqAliases] = useState('');
  const [faqSearchHints, setFaqSearchHints] = useState('');
  const [faqSourceFiles, setFaqSourceFiles] = useState('');
  const [faqSaving, setFaqSaving] = useState(false);

  const [promptForm, setPromptForm] = useState<PromptPayload>(EMPTY_PROMPT);
  const [promptSaving, setPromptSaving] = useState(false);

  const [chatStartDate, setChatStartDate] = useState(initialAdminView.chatStartDate);
  const [chatEndDate, setChatEndDate] = useState(initialAdminView.chatEndDate);
  const [appliedChatStartDate, setAppliedChatStartDate] = useState(initialAdminView.chatStartDate);
  const [appliedChatEndDate, setAppliedChatEndDate] = useState(initialAdminView.chatEndDate);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatExporting, setChatExporting] = useState(false);
  const [chatReviewingId, setChatReviewingId] = useState<number | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionPage, setSessionPage] = useState(initialAdminView.chatSessionPage);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionTotalPages, setSessionTotalPages] = useState(1);

  // DB 브라우저
  const [dbTables, setDbTables] = useState<DbTableMeta[]>([]);
  const [selectedDbTable, setSelectedDbTable] = useState<string | null>(null);
  const [dbTableData, setDbTableData] = useState<DbTableData | null>(null);
  const [dbTableQuery, setDbTableQuery] = useState('');
  const [dbTableKindFilter, setDbTableKindFilter] = useState<'all' | 'custom' | 'system'>('all');
  const [dbPage, setDbPage] = useState(1);
  const [dbLoading, setDbLoading] = useState(false);

  // 모델 설정
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [embeddingModelSelection, setEmbeddingModelSelection] = useState('');
  const [embeddingModelSaving, setEmbeddingModelSaving] = useState(false);
  const [modelSettingsTab, setModelSettingsTab] = useState<'generation' | 'embedding'>('generation');
  const [modelLoadError, setModelLoadError] = useState('');
  const [modelSortKey, setModelSortKey] = useState<ModelSortKey>('recommend');
  const [modelSortDir, setModelSortDir] = useState<'asc' | 'desc'>('desc');

  // 권한 관리
  const [permissionsData, setPermissionsData] = useState<PermissionsData | null>(null);
  const [permissionAccess, setPermissionAccess] = useState<PermissionAccess | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [newPermEmail, setNewPermEmail] = useState('');
  const [permSaving, setPermSaving] = useState(false);
  const [newSuperadminEmail, setNewSuperadminEmail] = useState('');
  const [superadminSaving, setSuperadminSaving] = useState(false);
  const isSuperadmin = permissionAccess?.is_superadmin ?? false;
  const visibleNavGroups = useMemo(
    () => NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => !['security', 'permissions'].includes(item.key) || isSuperadmin),
    })),
    [isSuperadmin],
  );

  // 암호화 설정
  const [encryptionSettings, setEncryptionSettings] = useState<EncryptionSettings | null>(null);
  const [encryptionLoading, setEncryptionLoading] = useState(false);
  const [migrating, setMigrating] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'encryption' | 'models'>('encryption');

  // 데이터 관리
  const [selectedTable, setSelectedTable] = useState<CustomTableDetail | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataRowQueryInput, setDataRowQueryInput] = useState('');
  const [dataRowQuery, setDataRowQuery] = useState('');
  const [dataSearchColumn, setDataSearchColumn] = useState('');
  const [dataAppliedSearchColumn, setDataAppliedSearchColumn] = useState('');
  const [dataPage, setDataPage] = useState(1);
  const [showNewTableForm, setShowNewTableForm] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableDesc, setNewTableDesc] = useState('');
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('text');
  const [editingRow, setEditingRow] = useState<{ id: number | null; data: Record<string, string> } | null>(null);
  const [dataExporting, setDataExporting] = useState(false);
  const [allExporting, setAllExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingColId, setEditingColId] = useState<number | null>(null);
  const [editingColNameVal, setEditingColNameVal] = useState('');

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const faqMdInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const documentRequestIdRef = useRef(0);
  const navigate = useNavigate();

  const setActiveTab = (tab: TabKey) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('tab', tab);
    setSearchParams(nextSearchParams, { replace: true });
  };

  const handleAdminLogout = () => {
    window.sessionStorage.removeItem(ADMIN_VIEW_STORAGE_KEY);
    clearAdminToken();
    setAuthenticated(false);
  };

  const resetFaqForm = () => {
    setFaqForm(EMPTY_FAQ);
    setFaqKeywords('');
    setFaqAliases('');
    setFaqSearchHints('');
    setFaqSourceFiles('');
  };

  const resetPromptForm = () => setPromptForm(EMPTY_PROMPT);

  const loadDashboard = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [documentData, faqData, promptData, logData, operations] = await Promise.all([
        adminApi.getDocuments(true),
        adminApi.getFaqs(),
        adminApi.getPrompts(),
        adminApi.getLogs(),
        adminApi.getOperationsDashboard(),
      ]);
      setDocuments(documentData.documents);
      setFaqs(faqData.faqs);
      setPrompts(promptData.prompts);
      setProcessingLogs(logData.processing_logs);
      setAuditLogs(logData.audit_logs);
      setOperationsData(operations);
    } catch {
      setLoadError('관리자 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadOperations = async () => {
    setOperationsLoading(true);
    try {
      setOperationsData(await adminApi.getOperationsDashboard());
    } catch {
      setLoadError('운영 현황을 불러오지 못했습니다.');
    } finally {
      setOperationsLoading(false);
    }
  };

  const loadSystemHealth = async () => {
    setHealthLoading(true);
    try {
      setSystemHealth(await adminApi.getSystemHealth());
    } catch {
      const checkedAt = new Date().toISOString();
      setSystemHealth({
        overall_status: 'critical',
        generated_at: checkedAt,
        checks: [
          { key: 'application', label: '백엔드 API', status: 'critical', message: '백엔드 서버가 응답하지 않습니다.', latency_ms: null, checked_at: checkedAt, details: {} },
          { key: 'database_read', label: 'DB 조회', status: 'unknown', message: '백엔드 장애로 조회 상태를 확인할 수 없습니다.', latency_ms: null, checked_at: checkedAt, details: {} },
          { key: 'database_write', label: 'DB 저장', status: 'unknown', message: '백엔드 장애로 저장 상태를 확인할 수 없습니다.', latency_ms: null, checked_at: checkedAt, details: {} },
          { key: 'ec2', label: 'EC2', status: 'unknown', message: '백엔드 장애로 EC2 상태를 확인할 수 없습니다.', latency_ms: null, checked_at: checkedAt, details: {} },
        ],
      });
    } finally {
      setHealthLoading(false);
    }
  };

  const loadAnalytics = async (selectedYear = analyticsYear, selectedMonth = analyticsMonth) => {
    setAnalyticsLoading(true);
    try {
      let result = await adminApi.getOperationsAnalytics(selectedYear, selectedMonth);
      if (result.unclassified_count > 0) {
        const classified = await adminApi.reclassifyQuestionCategories();
        if (classified.classified > 0) result = await adminApi.getOperationsAnalytics(selectedYear, selectedMonth);
      }
      setAnalyticsData(result);
    } catch {
      setLoadError('운영 분석 데이터를 불러오지 못했습니다.');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const loadDashboardCosts = async () => {
    const now = new Date();
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [costResult, openAiResult] = await Promise.allSettled([
      adminApi.getCostManagement(billingMonth, '249173798473'),
      adminApi.getOpenAiCosts(billingMonth),
    ]);
    if (costResult.status === 'fulfilled') setDashboardCostData(costResult.value);
    if (openAiResult.status === 'fulfilled') setDashboardOpenAiCostData(openAiResult.value);
  };

  const refreshOperationsDashboard = async () => {
    await Promise.all([loadOperations(), loadSystemHealth(), loadAnalytics(), loadDashboardCosts()]);
  };

  const handleAnalyticsYearChange = (selectedYear: string) => {
    setAnalyticsYear(selectedYear);
    if (selectedYear === 'all') {
      setAnalyticsMonth('all');
      void loadAnalytics('all', 'all');
      return;
    }
    void loadAnalytics(selectedYear, analyticsMonth);
  };

  const handleAnalyticsMonthChange = (selectedMonth: string) => {
    setAnalyticsMonth(selectedMonth);
    void loadAnalytics(analyticsYear, selectedMonth);
  };

  const loadModelSettings = async () => {
    setModelLoadError('');
    try {
      const data = await adminApi.getModelSettings();
      const normalizedData: ModelSettings = {
        ...data,
        current_embedding_model: data.current_embedding_model || 'text-embedding-3-large',
        available_embedding_models: data.available_embedding_models?.length
          ? data.available_embedding_models
          : ['text-embedding-3-large', 'text-embedding-3-small'],
        indexed_embedding_model: data.indexed_embedding_model || null,
      };
      setModelSettings(normalizedData);
      setEmbeddingModelSelection(normalizedData.current_embedding_model);
    } catch {
      setModelLoadError('모델 목록을 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    if (authenticated) {
      void loadDashboard();
      void loadSystemHealth();
      void loadPermissionAccess();
    } else {
      setPermissionsData(null);
      setPermissionAccess(null);
      setActiveTab('dashboard');
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    if (tabParam === 'data') {
      setActiveTab('db');
    } else if (!tabParam || !ADMIN_TAB_KEYS.has(tabParam as TabKey)) {
      setActiveTab(initialAdminView.activeTab);
    }
  }, [authenticated, tabParam]);

  useEffect(() => {
    if (!authenticated) return;
    window.sessionStorage.setItem(ADMIN_VIEW_STORAGE_KEY, JSON.stringify({
      activeTab,
      chatStartDate,
      chatEndDate,
      chatSessionPage: sessionPage,
    } satisfies StoredAdminView));
  }, [activeTab, authenticated, chatEndDate, chatStartDate, sessionPage]);

  useEffect(() => {
    if (!authenticated || activeTab !== 'chats') return;
    void loadChatView(sessionPage, appliedChatStartDate, appliedChatEndDate, false);
  }, [activeTab, authenticated]);

  useEffect(() => {
    if (permissionAccess && !isSuperadmin && ['security', 'permissions'].includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, isSuperadmin, permissionAccess]);

  useEffect(() => {
    if (activeTab === 'db' && authenticated) {
      void loadDbTables();
    }
  }, [activeTab, authenticated]);

  useEffect(() => {
    if (activeTab === 'db' && dbTables.length > 0 && !selectedDbTable) {
      void handleSelectDbTable(dbTables[0].name);
    }
  }, [activeTab, dbTables]);

  useEffect(() => {
    if (activeTab === 'settings') {
      if (!modelSettings) void loadModelSettings();
      if (!encryptionSettings) void loadEncryptionSettings();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'permissions' && authenticated && isSuperadmin) {
      void loadPermissions();
    }
  }, [activeTab, authenticated, isSuperadmin]);

  useEffect(() => {
    if (activeTab === 'dashboard' && authenticated) {
      void loadAnalytics();
      void loadDashboardCosts();
    }
  }, [activeTab, authenticated]);

  useEffect(() => {
    if (!authenticated || (activeTab !== 'dashboard' && activeTab !== 'improvements')) return;
    const timer = window.setInterval(() => {
      void loadOperations();
      void loadSystemHealth();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [activeTab, authenticated]);

  useEffect(() => () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
  }, [pdfPreviewUrl]);

  const loadEncryptionSettings = async () => {
    setEncryptionLoading(true);
    try {
      const data = await adminApi.getEncryptionSettings();
      setEncryptionSettings(data);
    } catch {
      setNotice('암호화 설정을 불러오지 못했습니다.');
    } finally {
      setEncryptionLoading(false);
    }
  };

  const handleMigrateConversationEncryption = async () => {
    const plainCount = encryptionSettings?.categories[0]?.plain_count ?? 0;
    if (!window.confirm(`기존 평문 대화 데이터 ${plainCount}개 필드를 암호화할까요?\n대화 암호화는 해제할 수 없습니다.`)) return;
    setMigrating('conversation_encrypt');
    try {
      const result = await adminApi.migrateEncryption('conversation');
      setNotice(result.message);
      await loadEncryptionSettings();
    } catch {
      setNotice('기존 대화 데이터 암호화에 실패했습니다.');
    } finally {
      setMigrating(null);
    }
  };

  const loadPermissions = async () => {
    setPermLoading(true);
    try {
      const result = await adminApi.getPermissions();
      setPermissionsData(result);
    } catch {
      setNotice('권한 목록을 불러오지 못했습니다.');
    } finally {
      setPermLoading(false);
    }
  };

  const loadPermissionAccess = async () => {
    try {
      const result = await adminApi.getPermissionAccess();
      setPermissionAccess(result);
    } catch {
      setPermissionAccess(null);
    }
  };

  const openDocument = async (documentId: number) => {
    setDocumentReviewOpen(true);
    setSelectedDocument(null);
    const requestId = ++documentRequestIdRef.current;
    setDocumentLoading(true);
    setPdfPreviewLoading(false);
    setPdfPreviewUrl(null);
    try {
      const detail = await adminApi.getDocumentDetail(documentId);
      if (requestId !== documentRequestIdRef.current) return;
      setSelectedDocument(detail);
      setReviewNote(detail.document.review_note ?? '');
      setDocumentMdDraft(detail.md_content ?? '');
      setDocumentJsonDraft(detail.json_content ?? '');
      if (detail.document.has_pdf) {
        setPdfPreviewLoading(true);
        try {
          const pdfBlob = await adminApi.getDocumentPdf(documentId);
          if (requestId !== documentRequestIdRef.current) return;
          setPdfPreviewUrl(URL.createObjectURL(pdfBlob));
        } catch {
          if (requestId === documentRequestIdRef.current) {
            setNotice('문서 내용은 불러왔지만 원본 PDF 미리보기를 열지 못했습니다.');
          }
        } finally {
          if (requestId === documentRequestIdRef.current) setPdfPreviewLoading(false);
        }
      }
    } catch {
      if (requestId === documentRequestIdRef.current) {
        setNotice('문서 검토 내용을 불러오지 못했습니다.');
        setDocumentReviewOpen(false);
      }
    } finally {
      if (requestId === documentRequestIdRef.current) setDocumentLoading(false);
    }
  };

  const reloadAndOpenDocument = async (documentId: number) => {
    await loadDashboard();
    await openDocument(documentId);
  };

  const handleReindex = async () => {
    setReindexBusy(true);
    try {
      const preview = await adminApi.previewReindex();
      if (!preview.can_rebuild) {
        setNotice('OpenAI API 키가 없어 인덱스를 재구성할 수 없습니다. 설정을 먼저 확인해 주세요.');
        return;
      }
      if (!preview.changed) {
        setNotice(
          `변경 사항이 없습니다. 현재 인덱스를 그대로 사용합니다. 임베딩 ${preview.embedding_model}, 문서 ${preview.document_count}건, FAQ ${preview.faq_count}건, 벡터 ${preview.current_vector_count}건`,
        );
        return;
      }
      const confirmed = window.confirm(
        `변경 사항이 확인되었습니다.\n\n임베딩 모델 ${preview.embedding_model}${preview.indexed_embedding_model && preview.indexed_embedding_model !== preview.embedding_model ? `\n현재 인덱스 모델 ${preview.indexed_embedding_model}` : ''}\n승인 문서 ${preview.document_count}건\nFAQ ${preview.faq_count}건\n예상 청크 ${preview.chunk_count}건\n\n이 경우에만 임베딩 비용이 발생합니다. 재구성할까요?`,
      );
      if (!confirmed) {
        setNotice('사전 점검만 완료했고 인덱스는 변경하지 않았습니다.');
        return;
      }
      const result = await adminApi.reindex(preview.fingerprint);
      setNotice(`${result.message} 문서 ${result.document_count}건, FAQ ${result.faq_count}건, 벡터 ${result.vector_count}건 (${result.storage})`);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(detail || '인덱스 재구성에 실패했습니다.');
    } finally {
      setReindexBusy(false);
    }
  };

  const handlePdfUpload = async () => {
    if (!pdfFile) return;
    setUploadBusy(true);
    try {
      const result = await adminApi.uploadPdf(pdfFile);
      setNotice(result.message);
      setPdfFile(null);
      setDocumentUploadMode(null);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
      await reloadAndOpenDocument(result.document.id);
    } catch {
      setNotice('PDF 업로드에 실패했습니다.');
    } finally {
      setUploadBusy(false);
    }
  };

  const handleMdUpload = async () => {
    if (!mdFile) return;
    setUploadBusy(true);
    try {
      const result = await adminApi.uploadMd(mdFile, mdTitle || undefined, mdCategory || undefined);
      setNotice(result.message);
      setMdFile(null);
      setMdTitle('');
      setMdCategory('');
      setDocumentUploadMode(null);
      if (mdInputRef.current) mdInputRef.current.value = '';
      await reloadAndOpenDocument(result.document.id);
    } catch {
      setNotice('MD 업로드에 실패했습니다.');
    } finally {
      setUploadBusy(false);
    }
  };

  const handleFaqMdUpload = async () => {
    if (!faqMdFile) return;
    setUploadBusy(true);
    try {
      const result = await adminApi.uploadFaqMd(faqMdFile, faqMdCategory || undefined);
      const methodLabel = result.conversion.method === 'ai' ? 'AI 변환' : '규칙 기반 대체 변환';
      const warning = result.conversion.warnings.length ? ` ${result.conversion.warnings.join(' ')}` : '';
      setNotice(`${result.message} (${methodLabel} ${result.faqs.length}건)${warning}`);
      setFaqMdFile(null);
      setFaqMdCategory('');
      setDocumentUploadMode(null);
      if (faqMdInputRef.current) faqMdInputRef.current.value = '';
      await reloadAndOpenDocument(result.document.id);
    } catch {
      setNotice('FAQ용 MD 변환에 실패했습니다.');
    } finally {
      setUploadBusy(false);
    }
  };

  const handleDocumentApprove = async () => {
    if (!selectedDocument) return;
    const isFaqDocument = selectedDocument.document.parser_type === 'faq_json';
    const hasUnsavedChanges = documentMdDraft !== (selectedDocument.md_content ?? '')
      || (isFaqDocument && documentJsonDraft !== (selectedDocument.json_content ?? ''));
    if (hasUnsavedChanges) {
      setNotice('수정한 MD/JSON을 먼저 저장한 뒤 승인해 주세요.');
      return;
    }
    try {
      const result = await adminApi.approveDocument(selectedDocument.document.id, reviewNote || undefined);
      setNotice(result.message);
      await reloadAndOpenDocument(selectedDocument.document.id);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(detail || '문서 승인과 인덱스 반영에 실패했습니다.');
    }
  };

  const handleDocumentDelete = async (documentId: number) => {
    if (!window.confirm('이 문서를 삭제 상태로 옮길까요? 이후 검토 패널에서 복구하거나 영구 삭제할 수 있습니다.')) return;
    const note = selectedDocument?.document.id === documentId ? reviewNote : undefined;
    try {
      const result = await adminApi.deleteDocument(documentId, note);
      setNotice(result.message);
      if (selectedDocument?.document.id === documentId) {
        setSelectedDocument({
          ...selectedDocument,
          document: result.document,
        });
        setDocumentMdDraft(selectedDocument.md_content ?? '');
        setDocumentJsonDraft(selectedDocument.json_content ?? '');
      }
      await loadDashboard();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(detail || '문서 삭제 처리에 실패했습니다.');
    }
  };

  const handleDocumentRestore = async () => {
    if (!selectedDocument) return;
    const result = await adminApi.restoreDocument(selectedDocument.document.id);
    setNotice(result.message);
    await reloadAndOpenDocument(selectedDocument.document.id);
  };

  const handleDocumentPermanentDelete = async () => {
    if (!selectedDocument?.document.is_deleted) return;
    const documentId = selectedDocument.document.id;
    const filename = selectedDocument.document.original_filename;
    if (!window.confirm(`"${filename}" 문서를 영구 삭제할까요?\n\n원본·변환 파일, 문서 청크와 DB 문서 레코드가 삭제되며 복구할 수 없습니다.`)) return;
    setDocumentPermanentDeleteBusy(true);
    try {
      const result = await adminApi.permanentlyDeleteDocument(documentId);
      setSelectedDocument(null);
      setDocumentReviewOpen(false);
      setReviewNote('');
      setDocumentMdDraft('');
      setDocumentJsonDraft('');
      setPdfPreviewUrl(null);
      setNotice(result.message);
      await loadDashboard();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(detail || '문서 영구 삭제에 실패했습니다.');
    } finally {
      setDocumentPermanentDeleteBusy(false);
    }
  };

  const handleDocumentArtifactSave = async () => {
    if (!selectedDocument) return;
    setDocumentArtifactSaving(true);
    try {
      const isFaqDocument = selectedDocument.document.parser_type === 'faq_json';
      const result = await adminApi.updateDocumentArtifacts(selectedDocument.document.id, {
        md_content: documentMdDraft,
        ...(isFaqDocument ? { json_content: documentJsonDraft } : {}),
      });
      setSelectedDocument({
        document: result.document,
        md_content: result.md_content,
        json_content: result.json_content,
      });
      setDocumentMdDraft(result.md_content ?? '');
      setDocumentJsonDraft(result.json_content ?? '');
      setNotice(`${result.message}${isFaqDocument ? '' : ` (검색 청크 ${result.chunk_count}건)`}`);
      await loadDashboard();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(detail || '변환 결과 저장에 실패했습니다.');
    } finally {
      setDocumentArtifactSaving(false);
    }
  };

  const handleFaqReconvert = async () => {
    if (!selectedDocument || selectedDocument.document.parser_type !== 'faq_json') return;
    if (documentMdDraft !== (selectedDocument.md_content ?? '')) {
      setNotice('수정한 MD를 먼저 저장한 뒤 FAQ JSON을 다시 변환해 주세요.');
      return;
    }
    if (!window.confirm('현재 FAQ JSON을 MD 기준으로 다시 생성할까요? 기존 JSON 초안은 바뀝니다.')) return;
    setFaqReconvertBusy(true);
    try {
      const result = await adminApi.reconvertFaqDocument(selectedDocument.document.id);
      setSelectedDocument({
        document: result.document,
        md_content: result.md_content,
        json_content: result.json_content,
      });
      setDocumentMdDraft(result.md_content ?? '');
      setDocumentJsonDraft(result.json_content ?? '');
      const methodLabel = result.conversion.method === 'ai' ? 'AI 변환' : '규칙 기반 대체 변환';
      const warning = result.conversion.warnings.length ? ` ${result.conversion.warnings.join(' ')}` : '';
      setNotice(`${result.message} ${methodLabel} ${result.conversion.item_count}건.${warning}`);
      await loadDashboard();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(detail || 'FAQ JSON 재변환에 실패했습니다.');
    } finally {
      setFaqReconvertBusy(false);
    }
  };

  const handleSelectFaq = (faq: AdminFaq) => {
    setFaqForm(faq);
    setFaqKeywords(joinCsv(faq.keywords));
    setFaqAliases(joinCsv(faq.aliases));
    setFaqSearchHints(joinCsv(faq.search_hints));
    setFaqSourceFiles(joinCsv(faq.source_files));
  };

  const handleSaveFaq = async () => {
    setFaqSaving(true);
    const payload: AdminFaq = {
      ...faqForm,
      keywords: splitCsv(faqKeywords),
      aliases: splitCsv(faqAliases),
      search_hints: splitCsv(faqSearchHints),
      source_files: splitCsv(faqSourceFiles),
    };
    try {
      const result = faqForm.id ? await adminApi.updateFaq(payload) : await adminApi.createFaq(payload);
      setNotice(result.message);
      resetFaqForm();
      await loadDashboard();
    } catch {
      setNotice('FAQ 저장에 실패했습니다.');
    } finally {
      setFaqSaving(false);
    }
  };

  const handleDeleteFaq = async (faqId: string) => {
    if (!window.confirm('이 FAQ를 삭제할까요?')) return;
    await adminApi.deleteFaq(faqId);
    setNotice('FAQ를 삭제했습니다.');
    resetFaqForm();
    await loadDashboard();
  };

  const handleSelectPrompt = (prompt: PromptConfig) => {
    setPromptForm({ prompt_key: prompt.prompt_key, label: prompt.label, content: prompt.content });
  };

  const handleSavePrompt = async () => {
    setPromptSaving(true);
    try {
      const result =
        promptForm.prompt_key && prompts.some((item) => item.prompt_key === promptForm.prompt_key)
          ? await adminApi.updatePrompt(promptForm)
          : await adminApi.createPrompt(promptForm);
      setNotice(result.message);
      resetPromptForm();
      await loadDashboard();
    } catch {
      setNotice('프롬프트 저장에 실패했습니다.');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleDeletePrompt = async (promptKey: string) => {
    if (!window.confirm('이 프롬프트를 삭제할까요?')) return;
    try {
      const result = await adminApi.deletePrompt(promptKey);
      setNotice(result.message);
      resetPromptForm();
      await loadDashboard();
    } catch {
      setNotice('기본 프롬프트는 삭제할 수 없습니다.');
    }
  };

  const loadChatView = async (
    page: number,
    startDate: string,
    endDate: string,
    showNotice: boolean,
  ) => {
    setChatLoading(true);
    setSessionLoading(true);
    try {
      const period = {
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      };
      const [logResult, sessionResult] = await Promise.all([
        adminApi.getChatLogs(period),
        adminApi.getSessions({
          ...period,
          page,
          page_size: CHAT_SESSION_PAGE_SIZE,
        }),
      ]);
      setChatLogs(logResult.chat_logs);
      setSessions(sessionResult.sessions);
      setSessionPage(sessionResult.page);
      setSessionTotal(sessionResult.total);
      setSessionTotalPages(sessionResult.total_pages);
      if (showNotice) {
        setNotice(`대화 로그 ${logResult.chat_logs.length}건, 상담 세션 ${sessionResult.total}건이 조회되었습니다.`);
      }
    } catch {
      if (showNotice) setNotice('대화 로그와 상담 세션 조회에 실패했습니다.');
    } finally {
      setChatLoading(false);
      setSessionLoading(false);
    }
  };

  const handleFilterChatLogs = async () => {
    if (chatStartDate && chatEndDate && chatStartDate > chatEndDate) {
      setNotice('시작일은 종료일보다 늦을 수 없습니다.');
      return;
    }
    setAppliedChatStartDate(chatStartDate);
    setAppliedChatEndDate(chatEndDate);
    setSessionPage(1);
    await loadChatView(1, chatStartDate, chatEndDate, true);
  };

  const handleSessionPage = async (targetPage: number) => {
    const nextPage = Math.min(Math.max(targetPage, 1), sessionTotalPages);
    if (sessionLoading || nextPage === sessionPage) return;
    setSessionLoading(true);
    try {
      const result = await adminApi.getSessions({
        page: nextPage,
        page_size: CHAT_SESSION_PAGE_SIZE,
        start_date: appliedChatStartDate || undefined,
        end_date: appliedChatEndDate || undefined,
      });
      setSessions(result.sessions);
      setSessionPage(result.page);
      setSessionTotal(result.total);
      setSessionTotalPages(result.total_pages);
    } catch {
      setNotice('상담 세션 페이지를 불러오지 못했습니다.');
    } finally {
      setSessionLoading(false);
    }
  };

  const handleExportChatLogs = async () => {
    setChatExporting(true);
    try {
      const blob = await adminApi.exportChatLogs({
        start_date: appliedChatStartDate || undefined,
        end_date: appliedChatEndDate || undefined,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chat_logs_${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      setNotice('대화 데이터를 엑셀로 내보냈습니다.');
    } catch {
      setNotice('엑셀 다운로드에 실패했습니다.');
    } finally {
      setChatExporting(false);
    }
  };

  // ── 데이터 관리 핸들러 ──────────────────────────────────────
  const loadTableDetail = async (tableId: number, page = 1, query = '', searchColumn = '') => {
    setDataLoading(true);
    try {
      const detail = await adminApi.getDataTable(tableId, {
        page,
        limit: 50,
        query: query || undefined,
        search_column: searchColumn || undefined,
      });
      setSelectedTable(detail);
      setDataPage(detail.page);
      setEditingRow(null);
    } catch {
      setNotice('테이블 데이터를 불러오지 못했습니다.');
    } finally {
      setDataLoading(false);
    }
  };

  const handleCreateOperationsReview = async (chatLogId: number) => {
    setChatReviewingId(chatLogId);
    try {
      const result = await adminApi.createOperationsReview(chatLogId);
      setNotice(result.message);
      await loadOperations();
    } catch {
      setNotice('개선 검토 등록에 실패했습니다.');
    } finally {
      setChatReviewingId(null);
    }
  };

  const handleSelectDataTable = async (tableId: number) => {
    setDataRowQueryInput('');
    setDataRowQuery('');
    setDataSearchColumn('');
    setDataAppliedSearchColumn('');
    setDataPage(1);
    await loadTableDetail(tableId);
  };

  const handleFilterDataRows = async () => {
    if (!selectedTable) return;
    const query = dataRowQueryInput.trim();
    setDataRowQuery(query);
    setDataAppliedSearchColumn(dataSearchColumn);
    setDataPage(1);
    await loadTableDetail(selectedTable.id, 1, query, dataSearchColumn);
  };

  const handleResetDataRows = async () => {
    if (!selectedTable) return;
    setDataRowQueryInput('');
    setDataRowQuery('');
    setDataSearchColumn('');
    setDataAppliedSearchColumn('');
    setDataPage(1);
    await loadTableDetail(selectedTable.id);
  };

  const handleDataPageChange = async (nextPage: number) => {
    if (!selectedTable || nextPage < 1 || nextPage > selectedTable.total_pages) return;
    await loadTableDetail(selectedTable.id, nextPage, dataRowQuery, dataAppliedSearchColumn);
  };

  const handleExportAll = async () => {
    setAllExporting(true);
    try {
      await adminApi.exportAllDataTables();
      setNotice('전체 데이터를 엑셀로 내보냈습니다.');
    } catch {
      setNotice('전체 내보내기에 실패했습니다.');
    } finally {
      setAllExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTable) return;
    setImporting(true);
    try {
      const result = await adminApi.importTableData(selectedTable.id, file);
      setNotice(result.message);
      await Promise.all([handleSelectDataTable(selectedTable.id), loadDbTables()]);
    } catch {
      setNotice('가져오기에 실패했습니다. 파일 형식과 컬럼명을 확인해주세요.');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const handleRenameColumn = async (colId: number) => {
    if (!selectedTable || !editingColNameVal.trim()) { setEditingColId(null); return; }
    const col = selectedTable.columns.find((c) => c.id === colId);
    if (!col || col.column_name === editingColNameVal.trim()) { setEditingColId(null); return; }
    try {
      await adminApi.renameColumn(selectedTable.id, colId, editingColNameVal.trim());
      await Promise.all([handleSelectDataTable(selectedTable.id), loadDbTables()]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(msg ?? '컬럼 이름 변경에 실패했습니다.');
    } finally {
      setEditingColId(null);
    }
  };

  const handleReorderColumn = async (colId: number, direction: 'up' | 'down') => {
    if (!selectedTable) return;
    try {
      await adminApi.reorderColumn(selectedTable.id, colId, direction);
      await handleSelectDataTable(selectedTable.id);
    } catch {
      setNotice('컬럼 순서 변경에 실패했습니다.');
    }
  };

  const handleCreateTable = async () => {
    if (!newTableName.trim()) return;
    try {
      const created = await adminApi.createDataTable(newTableName.trim(), newTableDesc.trim());
      setNewTableName('');
      setNewTableDesc('');
      setShowNewTableForm(false);
      setSelectedDbTable(created.physical_name);
      setDbTableData(null);
      await Promise.all([loadDbTables(), handleSelectDataTable(created.id)]);
      setNotice('업무 테이블을 생성했습니다. 바로 컬럼과 데이터를 추가할 수 있습니다.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(msg ?? '테이블 생성에 실패했습니다.');
    }
  };

  const handleDeleteTable = async (tableId: number) => {
    if (!confirm('테이블과 모든 데이터가 삭제됩니다. 계속하시겠어요?')) return;
    try {
      await adminApi.deleteDataTable(tableId);
      if (selectedTable?.id === tableId) setSelectedTable(null);
      if (selectedDbTable === `cdata_${tableId}`) {
        setSelectedDbTable(null);
        setDbTableData(null);
      }
      await loadDbTables();
      setNotice('테이블이 삭제되었습니다.');
    } catch {
      setNotice('테이블 삭제에 실패했습니다.');
    }
  };

  const handleAddColumn = async () => {
    if (!selectedTable || !newColName.trim()) return;
    try {
      await adminApi.addColumn(selectedTable.id, newColName.trim(), newColType);
      setNewColName('');
      setNewColType('text');
      await Promise.all([handleSelectDataTable(selectedTable.id), loadDbTables()]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNotice(msg ?? '컬럼 추가에 실패했습니다.');
    }
  };

  const handleDeleteColumn = async (colId: number) => {
    if (!selectedTable) return;
    if (!confirm('이 컬럼과 해당 데이터가 삭제됩니다.')) return;
    try {
      await adminApi.deleteColumn(selectedTable.id, colId);
      await Promise.all([handleSelectDataTable(selectedTable.id), loadDbTables()]);
    } catch {
      setNotice('컬럼 삭제에 실패했습니다.');
    }
  };

  const handleSaveRow = async () => {
    if (!selectedTable || !editingRow) return;
    try {
      if (editingRow.id === null) {
        await adminApi.addRow(selectedTable.id, editingRow.data);
      } else {
        await adminApi.updateRow(selectedTable.id, editingRow.id, editingRow.data);
      }
      setEditingRow(null);
      await Promise.all([
        loadTableDetail(selectedTable.id, dataPage, dataRowQuery, dataAppliedSearchColumn),
        loadDbTables(),
      ]);
    } catch {
      setNotice('저장에 실패했습니다.');
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    if (!selectedTable) return;
    try {
      await adminApi.deleteRow(selectedTable.id, rowId);
      await Promise.all([
        loadTableDetail(selectedTable.id, dataPage, dataRowQuery, dataAppliedSearchColumn),
        loadDbTables(),
      ]);
    } catch {
      setNotice('행 삭제에 실패했습니다.');
    }
  };

  const handleExportTable = async () => {
    if (!selectedTable) return;
    setDataExporting(true);
    try {
      await adminApi.exportDataTable(selectedTable.id, selectedTable.name);
      setNotice('엑셀 파일이 다운로드되었습니다.');
    } catch {
      setNotice('엑셀 다운로드에 실패했습니다.');
    } finally {
      setDataExporting(false);
    }
  };

  // ── DB 브라우저 핸들러 ──────────────────────────────────────
  const loadDbTables = async () => {
    try {
      const result = await adminApi.getDbTables();
      setDbTables(result.tables);
    } catch {
      setNotice('DB 테이블 목록을 불러오지 못했습니다.');
    }
  };

  const loadDbTableData = async (tableName: string, page = 1) => {
    setDbLoading(true);
    try {
      const result = await adminApi.browseDbTable(tableName, page);
      setDbTableData(result);
      setDbPage(page);
    } catch {
      setNotice('테이블 데이터를 불러오지 못했습니다.');
    } finally {
      setDbLoading(false);
    }
  };

  const handleSelectDbTable = async (tableName: string) => {
    setSelectedDbTable(tableName);
    setDbPage(1);
    const table = dbTables.find((item) => item.name === tableName);
    if (table?.table_kind === 'custom' && table.custom_table_id) {
      setDbTableData(null);
      await handleSelectDataTable(table.custom_table_id);
      return;
    }
    setSelectedTable(null);
    await loadDbTableData(tableName, 1);
  };

  const documentRows = useMemo(
    () => [...documents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [documents],
  );
  const selectedIsFaqDocument = selectedDocument?.document.parser_type === 'faq_json';
  const selectedDocumentCanApprove = selectedDocument?.document.status === 'review'
    || selectedDocument?.document.status === 'rejected';
  const documentArtifactsDirty = Boolean(selectedDocument) && (
    documentMdDraft !== (selectedDocument?.md_content ?? '')
    || (selectedIsFaqDocument && documentJsonDraft !== (selectedDocument?.json_content ?? ''))
  );
  const closeDocumentReview = () => {
    if (documentPermanentDeleteBusy) return;
    if (documentArtifactsDirty && !window.confirm('저장하지 않은 변환 결과 수정이 있습니다. 검토 창을 닫을까요?')) return;
    setDocumentReviewOpen(false);
  };

  useEffect(() => {
    if (!documentReviewOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDocumentReview();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [documentReviewOpen, documentPermanentDeleteBusy, documentArtifactsDirty]);

  useEffect(() => {
    if (activeTab !== 'documents') setDocumentReviewOpen(false);
  }, [activeTab]);

  const visibleDbTables = useMemo(() => {
    const query = dbTableQuery.trim().toLocaleLowerCase('ko-KR');
    return [...dbTables]
      .filter((table) => dbTableKindFilter === 'all' || table.table_kind === dbTableKindFilter)
      .filter((table) => !query || [table.display_name, table.name, table.description]
        .some((value) => value.toLocaleLowerCase('ko-KR').includes(query)))
      .sort((a, b) => {
        if (a.table_kind !== b.table_kind) return a.table_kind === 'custom' ? -1 : 1;
        return (a.display_name || a.name).localeCompare(b.display_name || b.name, 'ko-KR');
      });
  }, [dbTableKindFilter, dbTableQuery, dbTables]);

  const selectedDbTableMeta = useMemo(
    () => dbTables.find((table) => table.name === selectedDbTable) ?? null,
    [dbTables, selectedDbTable],
  );

  const customTableCount = useMemo(
    () => dbTables.filter((table) => table.table_kind === 'custom').length,
    [dbTables],
  );

  const reviewCount = useMemo(() => documents.filter((doc) => doc.status === 'review' && !doc.is_deleted).length, [documents]);
  const sessionPageNumbers = useMemo(() => {
    const visibleCount = Math.min(5, sessionTotalPages);
    const start = Math.max(1, Math.min(sessionPage - 2, sessionTotalPages - visibleCount + 1));
    return Array.from({ length: visibleCount }, (_, index) => start + index);
  }, [sessionPage, sessionTotalPages]);

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#ecfeff,_#f8fafc_55%)]">
        <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
          <div className="w-full rounded-3xl border border-cyan-100 bg-white/95 p-8 shadow-xl shadow-cyan-100/50">
            <h1 className="text-2xl font-semibold text-slate-900">관리자 로그인</h1>
            <p className="mt-2 text-sm text-slate-500">등록된 Google 계정으로 로그인하세요.</p>
            {loginError && (
              <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{loginError}</p>
            )}
            <div className="mt-6 flex justify-center">
              {loginLoading ? (
                <p className="text-sm text-slate-400">로그인 중...</p>
              ) : (
                <GoogleLogin
                  onSuccess={async (credentialResponse) => {
                    if (!credentialResponse.credential) return;
                    setLoginLoading(true);
                    setLoginError('');
                    try {
                      const result = await adminApi.verifyGoogleToken(credentialResponse.credential);
                      saveAdminToken(result.token);
                      setAuthenticated(true);
                    } catch {
                      setLoginError('접근 권한이 없는 계정입니다. 관리자에게 문의하세요.');
                    } finally {
                      setLoginLoading(false);
                    }
                  }}
                  onError={() => setLoginError('Google 로그인에 실패했습니다.')}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-slate-800 bg-[#08111f] text-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold tracking-wide">COA CONTROL</p>
            <p className="text-[11px] text-slate-400">상담 운영 콘솔</p>
          </div>
        </div>

        <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-6">
          {visibleNavGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{group.label}</p>
              <div className="space-y-1">
                {group.items.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${activeTab === key ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-950/30' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    <span>{label}</span>
                    {key === 'documents' && reviewCount > 0 && (
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${activeTab === key ? 'bg-slate-950/15 text-slate-950' : 'bg-amber-400/15 text-amber-300'}`}>{reviewCount}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/5 px-3 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"><ShieldCheck className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">관리자 접속 중</p>
              <p className="truncate text-[10px] text-slate-400">보호된 운영 세션</p>
            </div>
          </div>
          <button onClick={handleAdminLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white">
            <LogOut className="h-4 w-4" /> 로그아웃
          </button>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4 px-4 py-4 sm:px-6 xl:px-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Menu className="h-5 w-5 text-slate-400 lg:hidden" />
                <h1 className="truncate text-xl font-bold tracking-tight text-slate-950">{PAGE_META[activeTab].title}</h1>
              </div>
              <p className="mt-1 hidden text-xs text-slate-500 sm:block">{PAGE_META[activeTab].description}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  setLoading(true);
                  await loadDashboard();
                  if (selectedDocument) await openDocument(selectedDocument.document.id);
                }}
                disabled={loading || operationsLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading || operationsLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">새로고침</span>
              </button>
              <button onClick={handleAdminLogout} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white lg:hidden">로그아웃</button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1680px] px-4 pb-10 pt-4 sm:px-6 xl:px-8">
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {visibleNavGroups.flatMap((group) => group.items).map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setActiveTab(key)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${activeTab === key ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

        {(notice || loadError) && (
          <div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${loadError ? 'bg-rose-50 text-rose-700' : 'bg-cyan-50 text-cyan-800'}`}>
            {loadError || notice}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="mt-5">
            <AdminOperationsOverview
              data={operationsData}
              loading={loading || operationsLoading}
              analyticsData={analyticsData}
              analyticsLoading={analyticsLoading}
              analyticsYear={analyticsYear}
              analyticsMonth={analyticsMonth}
              costData={dashboardCostData}
              openAiCostData={dashboardOpenAiCostData}
              systemHealth={systemHealth}
              healthLoading={healthLoading}
              onRefresh={refreshOperationsDashboard}
              onYearChange={handleAnalyticsYearChange}
              onMonthChange={handleAnalyticsMonthChange}
              onRefreshAnalytics={loadAnalytics}
              onOpenReview={() => setActiveTab('improvements')}
              onOpenCosts={() => setActiveTab('costs')}
            />
          </div>
        )}

        {activeTab === 'improvements' && (
          <div className="mt-5">
            <OperationsReview
              data={operationsData}
              loading={loading || operationsLoading}
              onRefresh={loadOperations}
              onOpenPrompts={() => setActiveTab('prompts')}
            />
          </div>
        )}

        {activeTab === 'costs' && (
          <div className="mt-5">
            <CostManagement />
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="mt-6 space-y-6">
            <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">업로드와 변환</h2>
                  <p className="mt-1 break-keep text-sm leading-6 text-slate-500">작업을 선택하면 필요한 입력 항목만 펼쳐집니다.</p>
                </div>
                <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 sm:max-w-md">
                    <div className="text-sm font-semibold text-slate-900">FAISS 인덱스</div>
                    <p className="mt-0.5 break-keep text-xs leading-5 text-slate-600">승인 데이터 변경분을 먼저 확인한 뒤 필요할 때만 재구성합니다.</p>
                  </div>
                  <button onClick={handleReindex} disabled={reindexBusy} className="min-h-10 w-full shrink-0 whitespace-normal break-keep rounded-xl bg-amber-600 px-4 py-2 text-center text-xs font-medium leading-5 text-white hover:bg-amber-700 disabled:opacity-50 sm:w-auto">
                    {reindexBusy ? '확인 중...' : '변경 확인·재구성'}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {([
                  ['pdf', 'PDF → MD', 'PDF를 변환해 검토 대기로 저장'],
                  ['md', '일반 MD 등록', '문서형 MD를 검토 대기로 등록'],
                  ['faq', 'MD → FAQ JSON', 'FAQ JSON을 생성해 검토'],
                ] as const).map(([mode, title, description]) => {
                  const selected = documentUploadMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-expanded={selected}
                      onClick={() => setDocumentUploadMode(selected ? null : mode)}
                      className={`min-w-0 rounded-xl border px-4 py-3 text-left transition ${selected ? 'border-cyan-500 bg-cyan-50 ring-2 ring-cyan-100' : 'border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-white'}`}
                    >
                      <div className="break-keep text-sm font-semibold leading-5 text-slate-900">{title}</div>
                      <div className="mt-1 break-keep text-xs leading-5 text-slate-500">{description}</div>
                    </button>
                  );
                })}
              </div>

              {documentUploadMode && (
                <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4">
                  {documentUploadMode === 'pdf' && (
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <label className="min-w-0 flex-1 cursor-pointer">
                        <input ref={pdfInputRef} type="file" accept=".pdf" className="sr-only" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} />
                        <span className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">PDF 파일 선택</span>
                        <span className="ml-0 mt-2 block break-all text-xs leading-5 text-slate-500 sm:ml-3 sm:mt-0 sm:inline">{pdfFile?.name ?? '선택된 파일 없음'}</span>
                      </label>
                      <button onClick={handlePdfUpload} disabled={!pdfFile || uploadBusy} className="min-h-10 w-full shrink-0 rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 lg:w-auto">변환 시작</button>
                    </div>
                  )}
                  {documentUploadMode === 'md' && (
                    <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1.3fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-center">
                      <label className="min-w-0 cursor-pointer">
                        <input ref={mdInputRef} type="file" accept=".md" className="sr-only" onChange={(e) => setMdFile(e.target.files?.[0] ?? null)} />
                        <span className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">MD 파일 선택</span>
                        <span className="mt-1 block break-all text-xs leading-5 text-slate-500">{mdFile?.name ?? '선택된 파일 없음'}</span>
                      </label>
                      <input value={mdTitle} onChange={(e) => setMdTitle(e.target.value)} placeholder="문서 제목" className={`${INPUT_CLASS} min-w-0`} />
                      <input value={mdCategory} onChange={(e) => setMdCategory(e.target.value)} placeholder="카테고리" className={`${INPUT_CLASS} min-w-0`} />
                      <button onClick={handleMdUpload} disabled={!mdFile || uploadBusy} className="min-h-10 w-full shrink-0 rounded-xl bg-cyan-700 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 lg:w-auto">등록</button>
                    </div>
                  )}
                  {documentUploadMode === 'faq' && (
                    <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(12rem,1fr)_auto] lg:items-center">
                      <label className="min-w-0 cursor-pointer">
                        <input ref={faqMdInputRef} type="file" accept=".md" className="sr-only" onChange={(e) => setFaqMdFile(e.target.files?.[0] ?? null)} />
                        <span className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">FAQ용 MD 선택</span>
                        <span className="mt-1 block break-all text-xs leading-5 text-slate-500">{faqMdFile?.name ?? '선택된 파일 없음'}</span>
                      </label>
                      <input value={faqMdCategory} onChange={(e) => setFaqMdCategory(e.target.value)} placeholder="FAQ 카테고리" className={`${INPUT_CLASS} min-w-0`} />
                      <button onClick={handleFaqMdUpload} disabled={!faqMdFile || uploadBusy} className="min-h-10 w-full shrink-0 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 lg:w-auto">변환 생성</button>
                    </div>
                  )}
                </div>
              )}
            </section>

              <section className="min-w-0 rounded-3xl bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-900">문서 목록</h2>
                    <p className="mt-1 break-keep text-sm leading-6 text-slate-500">전체 문서의 상태와 버전을 비교하고 검토할 문서를 선택합니다. 삭제된 문서도 이 목록에서 복구할 수 있습니다.</p>
                  </div>
                  <span className="text-sm text-slate-500">{loading ? '불러오는 중...' : `${documentRows.length}건`}</span>
                </div>
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="whitespace-nowrap bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">파일명</th>
                        <th className="px-4 py-3 font-medium">타입</th>
                        <th className="px-4 py-3 font-medium">상태</th>
                        <th className="px-4 py-3 font-medium">버전</th>
                        <th className="px-4 py-3 font-medium">생성일</th>
                        <th className="px-4 py-3 text-right font-medium">작업</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {documentRows.length === 0 && !loading && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">등록된 문서가 없습니다.</td></tr>
                      )}
                      {documentRows.map((doc) => {
                        const selected = selectedDocument?.document.id === doc.id;
                        return (
                          <tr key={doc.id} className={selected ? 'bg-cyan-50' : doc.is_deleted ? 'bg-rose-50/40' : 'bg-white'}>
                            <td className="min-w-64 px-4 py-3">
                              <div className="break-all font-medium leading-6 text-slate-900">{doc.logical_name}</div>
                              <div className="break-all text-xs leading-5 text-slate-500">{doc.original_filename}</div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{doc.parser_type ?? '-'}</td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${doc.is_deleted ? 'bg-rose-100 text-rose-700' : doc.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {doc.is_deleted ? '삭제됨' : doc.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-600">v{doc.version}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(doc.created_at)}</td>
                            <td className="px-4 py-3 text-right">
                              <button onClick={() => void openDocument(doc.id)} className={`min-h-9 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${selected ? 'bg-cyan-700 text-white' : 'bg-slate-900 text-white'}`}>
                                조회
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

            {documentReviewOpen && (
              <div
                className="fixed inset-0 z-[80] flex justify-end bg-slate-950/55 backdrop-blur-[2px]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="document-review-title"
                onMouseDown={closeDocumentReview}
              >
                <section
                  className="admin-document-drawer flex h-full w-full max-w-3xl min-w-0 flex-col overflow-hidden bg-white shadow-2xl sm:rounded-l-3xl"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                      <h2 id="document-review-title" className="text-lg font-semibold text-slate-900">문서 상세 및 검토</h2>
                      <p className="mt-1 break-keep text-xs leading-5 text-slate-500">원본과 변환 결과를 확인하고 승인·삭제·복구 작업을 처리합니다.</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {documentLoading && <span className="hidden text-sm text-slate-500 sm:inline">불러오는 중...</span>}
                      <button
                        type="button"
                        aria-label="문서 검토 닫기"
                        disabled={documentPermanentDeleteBusy}
                        onClick={closeDocumentReview}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-xl leading-none text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              {!selectedDocument ? (
                <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="break-keep text-center text-sm leading-6 text-slate-600">{documentLoading ? '문서 검토 내용을 불러오는 중입니다...' : '문서 검토 내용을 표시할 수 없습니다.'}</p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="break-all text-base font-semibold leading-6 text-slate-900">{selectedDocument.document.original_filename}</div>
                    <div className="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm leading-6 text-slate-600">
                      <span>상태</span><span>{selectedDocument.document.status}</span>
                      <span>타입</span><span>{selectedDocument.document.parser_type ?? '-'}</span>
                      <span>활성</span><span>{selectedDocument.document.is_active ? 'Y' : 'N'}</span>
                      <span>삭제</span><span>{selectedDocument.document.is_deleted ? 'Y' : 'N'}</span>
                      <span>승인 시각</span><span className="break-all">{formatDate(selectedDocument.document.approved_at)}</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-900">관리 메모</label>
                    <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} disabled={selectedDocument.document.is_deleted} className={`${TEXTAREA_CLASS} h-24 disabled:bg-slate-50`} placeholder="승인 또는 삭제 사유를 남겨두세요." />
                  </div>
                  {documentArtifactsDirty && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                      저장하지 않은 수정 내용이 있습니다. 저장이 끝날 때까지 승인할 수 없습니다.
                    </p>
                  )}
                  <div className="grid gap-5">
                    <div>
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">원본 PDF</h3>
                        <span className="text-[11px] text-slate-500">원본을 확인한 뒤 아래 변환 결과와 비교하세요.</span>
                      </div>
                      <div className="h-[30rem] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                        {pdfPreviewLoading ? (
                          <div className="flex h-full items-center justify-center text-sm text-slate-500">PDF를 불러오는 중...</div>
                        ) : pdfPreviewUrl ? (
                          <iframe title="원본 PDF 미리보기" src={pdfPreviewUrl} className="h-full w-full" />
                        ) : (
                          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                            {selectedDocument.document.has_pdf ? '원본 PDF 미리보기를 불러오지 못했습니다.' : 'MD로 직접 등록된 문서라 원본 PDF가 없습니다.'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">변환된 MD 편집</h3>
                        <span className="text-[11px] text-slate-500">표·제목·누락 문장을 확인하세요.</span>
                      </div>
                      <textarea
                        value={documentMdDraft}
                        onChange={(event) => setDocumentMdDraft(event.target.value)}
                        disabled={selectedDocument.document.is_deleted}
                        className="h-[30rem] w-full rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700 disabled:bg-slate-50"
                      />
                    </div>
                  </div>
                  {selectedIsFaqDocument ? (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">FAQ JSON 편집·검증</h3>
                          <p className="mt-1 text-[11px] text-slate-500">저장할 때 JSON 문법, question/answer, 중복 id, top_k 범위를 검사합니다.</p>
                        </div>
                        <button
                          onClick={() => void handleFaqReconvert()}
                          disabled={faqReconvertBusy || documentArtifactSaving || selectedDocument.document.is_deleted || documentMdDraft !== (selectedDocument.md_content ?? '')}
                          className="min-h-10 whitespace-normal break-keep rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-center text-xs font-medium leading-5 text-cyan-800 disabled:opacity-50"
                        >
                          {faqReconvertBusy ? '재변환 중...' : '저장된 MD에서 다시 변환'}
                        </button>
                      </div>
                      <textarea
                        value={documentJsonDraft}
                        onChange={(event) => setDocumentJsonDraft(event.target.value)}
                        disabled={selectedDocument.document.is_deleted}
                        className="h-80 w-full rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700 disabled:bg-slate-50"
                      />
                    </div>
                  ) : (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-900">처리 메타데이터 JSON</h3>
                      <textarea readOnly value={documentJsonDraft} className="h-48 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-700" />
                    </div>
                  )}
                </div>
              )}
                  </div>
                  {selectedDocument && (
                    <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="break-keep text-xs leading-5 text-slate-500">
                          {selectedDocument.document.is_deleted
                            ? '복구는 삭제 직전 상태로 원복하며, 영구 삭제 후에는 되돌릴 수 없습니다.'
                            : selectedDocument.document.status === 'ready'
                              ? '승인되어 검색에 반영된 문서입니다.'
                              : selectedDocumentCanApprove
                                ? '내용을 확인하고 수정 사항을 저장한 뒤 승인하세요.'
                                : '현재 처리 상태에서는 승인할 수 없습니다.'}
                        </p>
                        <div className="flex flex-wrap justify-end gap-2">
                          {selectedDocument.document.is_deleted ? (
                            <>
                              <button disabled={documentPermanentDeleteBusy} onClick={() => void handleDocumentRestore()} className="min-h-10 min-w-20 whitespace-nowrap rounded-xl bg-cyan-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">복구</button>
                              <button disabled={documentPermanentDeleteBusy} onClick={() => void handleDocumentPermanentDelete()} className="min-h-10 min-w-24 whitespace-nowrap rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                                {documentPermanentDeleteBusy ? '삭제 중...' : '영구 삭제'}
                              </button>
                            </>
                          ) : (
                            <>
                              {(documentArtifactsDirty || selectedDocumentCanApprove) && (
                                <button
                                  onClick={() => void handleDocumentArtifactSave()}
                                  disabled={!documentArtifactsDirty || documentArtifactSaving}
                                  className="min-h-10 whitespace-normal break-keep rounded-xl bg-cyan-700 px-4 py-2 text-center text-sm font-medium leading-5 text-white disabled:opacity-40"
                                >
                                  {documentArtifactSaving ? '저장 중...' : '변환 결과 저장'}
                                </button>
                              )}
                              <button onClick={() => void handleDocumentDelete(selectedDocument.document.id)} className="min-h-10 min-w-20 whitespace-nowrap rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white">삭제</button>
                              {selectedDocumentCanApprove && (
                                <button
                                  onClick={() => void handleDocumentApprove()}
                                  disabled={documentArtifactsDirty || documentArtifactSaving}
                                  className="min-h-10 min-w-20 whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                                >
                                  승인
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}

        {activeTab === 'faqs' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">FAQ 목록</h2>
                <button onClick={resetFaqForm} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white">새 FAQ</button>
              </div>
              <div className="mt-4 max-h-[720px] space-y-3 overflow-y-auto">
                {faqs.map((faq) => (
                  <div key={faq.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-cyan-700">{faq.category}</div>
                        <div className="mt-1 font-medium text-slate-900">{faq.question}</div>
                        <p className="mt-2 line-clamp-3 text-sm text-slate-600">{faq.answer}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleSelectFaq(faq)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">수정</button>
                        <button onClick={() => void handleDeleteFaq(faq.id)} className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">삭제</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{faqForm.id ? 'FAQ 수정' : 'FAQ 추가'}</h2>
              <div className="mt-4 space-y-4">
                <input value={faqForm.id} onChange={(e) => setFaqForm((current) => ({ ...current, id: e.target.value }))} placeholder="FAQ ID" className={INPUT_CLASS} />
                <input value={faqForm.category} onChange={(e) => setFaqForm((current) => ({ ...current, category: e.target.value }))} placeholder="카테고리" className={INPUT_CLASS} />
                <input value={faqForm.question} onChange={(e) => setFaqForm((current) => ({ ...current, question: e.target.value }))} placeholder="질문" className={INPUT_CLASS} />
                <textarea value={faqForm.answer} onChange={(e) => setFaqForm((current) => ({ ...current, answer: e.target.value }))} placeholder="답변" className={`${TEXTAREA_CLASS} h-40`} />
                <input value={faqKeywords} onChange={(e) => setFaqKeywords(e.target.value)} placeholder="키워드" className={INPUT_CLASS} />
                <input value={faqAliases} onChange={(e) => setFaqAliases(e.target.value)} placeholder="별칭" className={INPUT_CLASS} />
                <input value={faqSearchHints} onChange={(e) => setFaqSearchHints(e.target.value)} placeholder="검색 힌트" className={INPUT_CLASS} />
                <input value={faqSourceFiles} onChange={(e) => setFaqSourceFiles(e.target.value)} placeholder="source_files" className={INPUT_CLASS} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={faqForm.direct_answer} onChange={(e) => setFaqForm((current) => ({ ...current, direct_answer: e.target.checked }))} />
                    direct_answer
                  </label>
                  <input type="number" min={1} max={10} value={faqForm.top_k} onChange={(e) => setFaqForm((current) => ({ ...current, top_k: Number(e.target.value) || 4 }))} className={INPUT_CLASS} />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => void handleSaveFaq()} disabled={faqSaving || !faqForm.id || !faqForm.question || !faqForm.answer} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{faqSaving ? '저장 중...' : '저장'}</button>
                  <button onClick={resetFaqForm} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">초기화</button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'prompts' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">프롬프트 목록</h2>
                <button onClick={resetPromptForm} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white">새 프롬프트</button>
              </div>
              <div className="mt-4 max-h-[720px] space-y-3 overflow-y-auto">
                {prompts.map((prompt) => (
                  <div key={prompt.prompt_key} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-cyan-700">{prompt.prompt_key}</div>
                        <div className="mt-1 font-medium text-slate-900">{prompt.label}</div>
                        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-slate-600">{prompt.content}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleSelectPrompt(prompt)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">수정</button>
                        <button onClick={() => void handleDeletePrompt(prompt.prompt_key)} className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">삭제</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{promptForm.prompt_key && prompts.some((item) => item.prompt_key === promptForm.prompt_key) ? '프롬프트 수정' : '프롬프트 추가'}</h2>
              <div className="mt-4 space-y-4">
                <input value={promptForm.prompt_key} onChange={(e) => setPromptForm((current) => ({ ...current, prompt_key: e.target.value }))} placeholder="prompt_key" className={INPUT_CLASS} />
                <input value={promptForm.label} onChange={(e) => setPromptForm((current) => ({ ...current, label: e.target.value }))} placeholder="라벨" className={INPUT_CLASS} />
                <textarea value={promptForm.content} onChange={(e) => setPromptForm((current) => ({ ...current, content: e.target.value }))} placeholder="프롬프트 본문" className={`${TEXTAREA_CLASS} h-[420px]`} />
                <div className="flex gap-3">
                  <button onClick={() => void handleSavePrompt()} disabled={promptSaving || !promptForm.prompt_key || !promptForm.label || !promptForm.content} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{promptSaving ? '저장 중...' : '저장'}</button>
                  <button onClick={resetPromptForm} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">초기화</button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'chats' && (
          <div className="mt-6 space-y-6">
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">대화 로그 조회와 엑셀 다운로드</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_1.2fr]">
                <input type="date" value={chatStartDate} onChange={(e) => setChatStartDate(e.target.value)} className={INPUT_CLASS} />
                <input type="date" value={chatEndDate} onChange={(e) => setChatEndDate(e.target.value)} className={INPUT_CLASS} />
                <div className="flex gap-2">
                  <button onClick={() => void handleFilterChatLogs()} disabled={chatLoading} className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{chatLoading ? '조회 중...' : '조회'}</button>
                  <button onClick={() => void handleExportChatLogs()} disabled={chatExporting} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{chatExporting ? '처리 중...' : '엑셀'}</button>
                </div>
              </div>
              <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto">
                {!chatLoading && chatLogs.length === 0 && (
                  <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">조회된 대화 로그가 없습니다.</p>
                )}
                {chatLogs.map((log) => (
                  <div key={log.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{log.session_id}</span>
                      <span>{formatDate(log.created_at)}</span>
                      <span>{log.source}</span>
                      <span>LLM ${log.llm_cost.toFixed(6)}</span>
                      <button
                        type="button"
                        onClick={() => void handleCreateOperationsReview(log.id)}
                        disabled={chatReviewingId === log.id}
                        className="ml-auto rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 font-semibold text-violet-700 disabled:opacity-50"
                      >{chatReviewingId === log.id ? '등록 중...' : '개선 검토 등록'}</button>
                    </div>
                    <div className="mt-2 font-medium text-slate-900">{log.question}</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{log.answer}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <section className="rounded-3xl bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">처리 로그</h2>
                <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto">
                  {processingLogs.map((log) => (
                    <div key={log.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm font-medium text-slate-900">{log.status} / {log.message}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(log.created_at)}</div>
                      {log.detail && <p className="mt-2 text-sm text-rose-600">{log.detail}</p>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">감사 로그</h2>
                <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm font-medium text-slate-900">{log.action}</div>
                      <div className="mt-1 text-xs text-slate-500">{log.target_type} / {log.target_id ?? '-'} / {formatDate(log.created_at)}</div>
                      {log.detail && <p className="mt-2 text-sm text-slate-700">{log.detail}</p>}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">상담 세션</h2>
                <span className="text-sm text-slate-500">전체 {sessionTotal}건</span>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-3 py-3">사용자</th>
                      <th className="px-3 py-3">시작</th>
                      <th className="px-3 py-3">최근</th>
                      <th className="px-3 py-3">메시지</th>
                      <th className="px-3 py-3">상세</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!sessionLoading && sessions.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">조회된 상담 세션이 없습니다.</td></tr>
                    )}
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td className="px-3 py-3">{session.user_name ?? '익명'}</td>
                        <td className="px-3 py-3">{formatDate(session.created_at)}</td>
                        <td className="px-3 py-3">{formatDate(session.updated_at)}</td>
                        <td className="px-3 py-3">{session.message_count}</td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => navigate(`/admin/sessions/${session.id}?tab=chats`, { state: { fromAdmin: true } })}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                          >보기</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSessionPage(1)}
                  disabled={sessionLoading || sessionPage <= 1}
                  aria-label="첫 페이지"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >&lt;&lt;</button>
                <button
                  type="button"
                  onClick={() => void handleSessionPage(sessionPage - 1)}
                  disabled={sessionLoading || sessionPage <= 1}
                  aria-label="이전 페이지"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >&lt;</button>
                {sessionPageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => void handleSessionPage(pageNumber)}
                    disabled={sessionLoading || pageNumber === sessionPage}
                    aria-current={pageNumber === sessionPage ? 'page' : undefined}
                    className={`min-w-10 rounded-lg px-3 py-2 text-sm font-semibold ${
                      pageNumber === sessionPage
                        ? 'bg-slate-900 text-white disabled:opacity-100'
                        : 'border border-slate-300 text-slate-700 disabled:opacity-40'
                    }`}
                  >{pageNumber}</button>
                ))}
                <button
                  type="button"
                  onClick={() => void handleSessionPage(sessionPage + 1)}
                  disabled={sessionLoading || sessionPage >= sessionTotalPages}
                  aria-label="다음 페이지"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >&gt;</button>
                <button
                  type="button"
                  onClick={() => void handleSessionPage(sessionTotalPages)}
                  disabled={sessionLoading || sessionPage >= sessionTotalPages}
                  aria-label="마지막 페이지"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >&gt;&gt;</button>
              </div>
              {sessionLoading && <p className="mt-2 text-center text-xs text-slate-500">상담 세션을 불러오는 중입니다.</p>}
            </section>
          </div>
        )}

        {activeTab === 'db' && selectedDbTableMeta?.table_kind === 'custom' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
            {/* 왼쪽: 테이블 목록 */}
            <div className="min-w-0">
              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-1">
                  <h2 className="text-sm font-semibold text-slate-900">테이블 목록</h2>
                  <div className="flex gap-1">
                    <button
                      onClick={() => void handleExportAll()}
                      disabled={allExporting || customTableCount === 0}
                      title="모든 업무 테이블을 하나의 엑셀 파일로 내보냅니다"
                      className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {allExporting ? '…' : '전체 내보내기'}
                    </button>
                    <button onClick={() => setShowNewTableForm((v) => !v)} className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white">+ 새 테이블</button>
                  </div>
                </div>
                {showNewTableForm && (
                  <div className="mt-3 space-y-2">
                    <input value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="테이블 이름 *" className={INPUT_CLASS} />
                    <input value={newTableDesc} onChange={(e) => setNewTableDesc(e.target.value)} placeholder="설명 (선택)" className={INPUT_CLASS} />
                    <div className="flex gap-2">
                      <button onClick={() => void handleCreateTable()} disabled={!newTableName.trim()} className="flex-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">만들기</button>
                      <button onClick={() => { setShowNewTableForm(false); setNewTableName(''); setNewTableDesc(''); }} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-600">취소</button>
                    </div>
                  </div>
                )}
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={dbTableQuery}
                    onChange={(event) => setDbTableQuery(event.target.value)}
                    placeholder="테이블 검색"
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1">
                  {([['all', '전체'], ['custom', '업무'], ['system', '시스템']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDbTableKindFilter(value)}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${dbTableKindFilter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                    >{label}</button>
                  ))}
                </div>
                <div className="mt-3 space-y-1">
                  {dbTables.length === 0 && <p className="text-xs text-slate-400">테이블이 없습니다.</p>}
                  {visibleDbTables.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => void handleSelectDbTable(t.name)}
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm ${selectedDbTable === t.name ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'}`}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${selectedDbTable === t.name ? 'bg-white/10 text-slate-200' : t.table_kind === 'custom' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-500'}`}>{t.table_kind === 'custom' ? '업무' : '시스템'}</span>
                        <span className="truncate font-medium">{t.display_name || t.name}</span>
                      </div>
                      <div className={`text-xs ${selectedDbTable === t.name ? 'text-slate-300' : 'text-slate-400'}`}>{t.row_count.toLocaleString()}행</div>
                    </button>
                  ))}
                  {dbTables.length > 0 && visibleDbTables.length === 0 && (
                    <p className="px-2 py-5 text-center text-xs text-slate-400">검색 결과가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>

            {/* 오른쪽: 테이블 상세 */}
            <div className="min-w-0 flex-1">
              {!selectedTable ? (
                <div className="flex h-64 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <p className="text-slate-400">왼쪽에서 테이블을 선택하거나 새로 만들어 주세요.</p>
                </div>
              ) : dataLoading ? (
                <div className="flex h-64 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <p className="text-slate-400">불러오는 중...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 헤더 */}
                  <div className="rounded-3xl bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-semibold text-slate-900">{selectedTable.name}</h2>
                          <span className="rounded bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-700">업무 · 편집 가능</span>
                        </div>
                        {selectedTable.description && <p className="mt-1 text-sm text-slate-500">{selectedTable.description}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {/* CSV/Excel 가져오기 */}
                        <input
                          ref={importFileRef}
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => void handleImport(e)}
                        />
                        <button
                          onClick={() => importFileRef.current?.click()}
                          disabled={importing || selectedTable.columns.length === 0}
                          title="CSV 또는 Excel 파일의 행을 이 테이블로 가져옵니다"
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        >
                          {importing ? '가져오는 중...' : 'CSV/Excel 가져오기'}
                        </button>
                        <button onClick={() => void handleExportTable()} disabled={dataExporting} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{dataExporting ? '처리 중...' : '엑셀 내보내기'}</button>
                        <button onClick={() => void handleDeleteTable(selectedTable.id)} className="rounded-xl bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-100">테이블 삭제</button>
                      </div>
                    </div>

                    {/* 컬럼 관리 */}
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <h3 className="mb-3 text-sm font-medium text-slate-700">컬럼 관리 <span className="font-normal text-slate-400 text-xs ml-1">이름 클릭 시 변경 · ↑↓ 순서 변경</span></h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedTable.columns.map((col, colIdx) => (
                          <span key={col.id} className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                            {/* 순서 버튼 */}
                            <button
                              onClick={() => void handleReorderColumn(col.id, 'up')}
                              disabled={colIdx === 0}
                              className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none"
                              title="위로"
                            >↑</button>
                            <button
                              onClick={() => void handleReorderColumn(col.id, 'down')}
                              disabled={colIdx === selectedTable.columns.length - 1}
                              className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none"
                              title="아래로"
                            >↓</button>
                            {/* 컬럼 이름 (클릭하면 인라인 편집) */}
                            {editingColId === col.id ? (
                              <input
                                autoFocus
                                value={editingColNameVal}
                                onChange={(e) => setEditingColNameVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleRenameColumn(col.id);
                                  if (e.key === 'Escape') setEditingColId(null);
                                }}
                                onBlur={() => void handleRenameColumn(col.id)}
                                className="w-24 rounded border border-cyan-400 bg-white px-1 py-0.5 text-xs outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => { setEditingColId(col.id); setEditingColNameVal(col.column_name); }}
                                className="font-medium hover:text-cyan-700"
                                title="클릭하여 이름 변경"
                              >
                                {col.column_name}
                              </button>
                            )}
                            <span className="text-slate-400">({col.column_type})</span>
                            <button onClick={() => void handleDeleteColumn(col.id)} className="ml-0.5 text-slate-300 hover:text-rose-500" title="컬럼 삭제">×</button>
                          </span>
                        ))}
                        {/* 새 컬럼 추가 */}
                        <div className="flex items-center gap-1">
                          <input
                            value={newColName}
                            onChange={(e) => setNewColName(e.target.value)}
                            placeholder="컬럼 이름"
                            className="w-28 rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddColumn(); }}
                          />
                          <select value={newColType} onChange={(e) => setNewColType(e.target.value)} className="rounded-xl border border-dashed border-slate-300 px-2 py-1.5 text-xs outline-none">
                            <option value="text">텍스트</option>
                            <option value="number">숫자</option>
                            <option value="date">날짜</option>
                          </select>
                          <button onClick={() => void handleAddColumn()} disabled={!newColName.trim()} className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">+ 추가</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 데이터 테이블 */}
                  <div className="rounded-3xl bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium text-slate-700">데이터 {selectedTable.total.toLocaleString()}건</h3>
                        {dataRowQuery && (
                          <p className="mt-0.5 text-xs text-slate-400">
                            {dataAppliedSearchColumn || '전체 컬럼'} · {dataRowQuery}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setEditingRow({ id: null, data: Object.fromEntries(selectedTable.columns.map((c) => [c.column_name, ''])) })}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                      >+ 행 추가</button>
                    </div>

                    {selectedTable.columns.length === 0 ? (
                      <p className="mt-4 text-sm text-slate-400">먼저 컬럼을 추가해 주세요.</p>
                    ) : (
                      <>
                        <form
                          className="mt-4 flex flex-wrap items-center gap-2 border-y border-slate-100 py-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleFilterDataRows();
                          }}
                        >
                          <select
                            value={dataSearchColumn}
                            onChange={(event) => setDataSearchColumn(event.target.value)}
                            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-cyan-400"
                            aria-label="검색 컬럼"
                          >
                            <option value="">전체 컬럼</option>
                            {selectedTable.columns.map((column) => (
                              <option key={column.id} value={column.column_name}>{column.column_name}</option>
                            ))}
                          </select>
                          <div className="relative min-w-48 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              value={dataRowQueryInput}
                              onChange={(event) => setDataRowQueryInput(event.target.value)}
                              placeholder="데이터 검색"
                              maxLength={100}
                              className="h-9 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-cyan-400"
                            />
                          </div>
                          <button type="submit" className="h-9 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white">검색</button>
                          {(dataRowQuery || dataRowQueryInput || dataSearchColumn) && (
                            <button type="button" onClick={() => void handleResetDataRows()} className="h-9 rounded-xl border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">초기화</button>
                          )}
                        </form>

                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                              {selectedTable.columns.map((col) => (
                                <th key={col.id} className="pb-2 pr-4 font-medium">{col.column_name}</th>
                              ))}
                              <th className="pb-2 font-medium">작업</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {/* 새 행 입력 폼 */}
                            {editingRow && editingRow.id === null && (
                              <tr className="bg-slate-50">
                                {selectedTable.columns.map((col) => (
                                  <td key={col.id} className="py-2 pr-4">
                                    <input
                                      type={col.column_type === 'number' ? 'number' : col.column_type === 'date' ? 'date' : 'text'}
                                      value={editingRow.data[col.column_name] ?? ''}
                                      onChange={(e) => setEditingRow((prev) => prev ? { ...prev, data: { ...prev.data, [col.column_name]: e.target.value } } : null)}
                                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                                    />
                                  </td>
                                ))}
                                <td className="py-2">
                                  <div className="flex gap-1">
                                    <button onClick={() => void handleSaveRow()} className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white">저장</button>
                                    <button onClick={() => setEditingRow(null)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600">취소</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {selectedTable.rows.map((row) => (
                              <tr key={row.id} className="hover:bg-slate-50">
                                {selectedTable.columns.map((col) => (
                                  <td key={col.id} className="py-2 pr-4">
                                    {editingRow?.id === row.id ? (
                                      <input
                                        type={col.column_type === 'number' ? 'number' : col.column_type === 'date' ? 'date' : 'text'}
                                        value={editingRow.data[col.column_name] ?? ''}
                                        onChange={(e) => setEditingRow((prev) => prev ? { ...prev, data: { ...prev.data, [col.column_name]: e.target.value } } : null)}
                                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                                      />
                                    ) : (
                                      <span className="text-slate-800">{row.data[col.column_name] ?? ''}</span>
                                    )}
                                  </td>
                                ))}
                                <td className="py-2">
                                  {editingRow?.id === row.id ? (
                                    <div className="flex gap-1">
                                      <button onClick={() => void handleSaveRow()} className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white">저장</button>
                                      <button onClick={() => setEditingRow(null)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600">취소</button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-1">
                                      <button onClick={() => setEditingRow({ id: row.id, data: { ...row.data } })} className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400">수정</button>
                                      <button onClick={() => void handleDeleteRow(row.id)} className="rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50">삭제</button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {selectedTable.rows.length === 0 && !editingRow && (
                              <tr>
                                <td colSpan={selectedTable.columns.length + 1} className="py-6 text-center text-sm text-slate-400">
                                  {dataRowQuery ? '검색 결과가 없습니다.' : '데이터가 없습니다. 행을 추가해 주세요.'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                          </table>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
                          <span>
                            {selectedTable.total === 0 ? 0 : (selectedTable.page - 1) * selectedTable.limit + 1}
                            -{Math.min(selectedTable.page * selectedTable.limit, selectedTable.total)} / {selectedTable.total.toLocaleString()}건
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleDataPageChange(dataPage - 1)}
                              disabled={dataPage <= 1}
                              className="h-8 min-w-16 rounded-lg border border-slate-200 px-3 disabled:opacity-30"
                            >이전</button>
                            <span className="min-w-14 text-center">{selectedTable.page} / {selectedTable.total_pages}</span>
                            <button
                              type="button"
                              onClick={() => void handleDataPageChange(dataPage + 1)}
                              disabled={dataPage >= selectedTable.total_pages}
                              className="h-8 min-w-16 rounded-lg border border-slate-200 px-3 disabled:opacity-30"
                            >다음</button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'db' && selectedDbTableMeta?.table_kind !== 'custom' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
            {/* 왼쪽: 테이블 목록 */}
            <div className="min-w-0">
              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-1">
                  <h2 className="text-sm font-semibold text-slate-900">테이블 목록</h2>
                  <div className="flex items-center gap-1">
                    <button onClick={() => void handleExportAll()} disabled={allExporting || customTableCount === 0} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40" title="모든 업무 테이블 내보내기">
                      {allExporting ? '…' : '전체 내보내기'}
                    </button>
                    <button onClick={() => setShowNewTableForm((value) => !value)} className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white">+ 새 테이블</button>
                    <button onClick={() => void loadDbTables()} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="테이블 새로고침">
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {showNewTableForm && (
                  <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                    <input value={newTableName} onChange={(event) => setNewTableName(event.target.value)} placeholder="테이블 이름 *" className={INPUT_CLASS} />
                    <input value={newTableDesc} onChange={(event) => setNewTableDesc(event.target.value)} placeholder="설명 (선택)" className={INPUT_CLASS} />
                    <div className="flex gap-2">
                      <button onClick={() => void handleCreateTable()} disabled={!newTableName.trim()} className="flex-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">만들기</button>
                      <button onClick={() => { setShowNewTableForm(false); setNewTableName(''); setNewTableDesc(''); }} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-600">취소</button>
                    </div>
                  </div>
                )}
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={dbTableQuery}
                    onChange={(event) => setDbTableQuery(event.target.value)}
                    placeholder="테이블 검색"
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1">
                  {([['all', '전체'], ['custom', '업무'], ['system', '시스템']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDbTableKindFilter(value)}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${dbTableKindFilter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                    >{label}</button>
                  ))}
                </div>
                <div className="mt-3 space-y-0.5">
                  {visibleDbTables.map((t) => (
                    <div key={t.name} className="group relative">
                      <button
                        onClick={() => void handleSelectDbTable(t.name)}
                        className={`w-full rounded-xl px-3 py-2 text-left ${selectedDbTable === t.name ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'}`}
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${selectedDbTable === t.name ? 'bg-white/10 text-slate-200' : t.table_kind === 'custom' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-500'}`}>{t.table_kind === 'custom' ? '업무' : '시스템'}</span>
                          <span className="truncate text-sm font-medium">{t.display_name || t.name}</span>
                        </div>
                        {t.description && (
                          <div className={`truncate text-xs ${selectedDbTable === t.name ? 'text-slate-300' : 'text-slate-500'}`}>{t.description}</div>
                        )}
                        <div className={`text-xs ${selectedDbTable === t.name ? 'text-slate-400' : 'text-slate-400'}`}>{t.row_count.toLocaleString()}행</div>
                      </button>
                      <div className="pointer-events-none absolute left-full top-0 z-30 ml-2 w-72 rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 whitespace-pre-line">
                        <div className="mb-0.5 text-sm font-semibold text-white">{t.display_name || t.name}</div>
                        {t.description && <div className="text-slate-300">{t.description}</div>}
                        <div className="mt-1 font-mono text-[10px] text-slate-400">{t.name} · {t.row_count.toLocaleString()}행 · {t.columns.length}컬럼</div>
                      </div>
                    </div>
                  ))}
                  {visibleDbTables.length === 0 && (
                    <p className="px-2 py-5 text-center text-xs text-slate-400">검색 결과가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>

            {/* 오른쪽: 데이터 */}
            <div className="min-w-0 flex-1">
              {!selectedDbTable ? (
                <div className="flex h-64 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <p className="text-slate-400">왼쪽에서 테이블을 선택하세요.</p>
                </div>
              ) : dbLoading ? (
                <div className="flex h-64 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <p className="text-slate-400">불러오는 중...</p>
                </div>
              ) : dbTableData ? (
                <div className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      {(() => {
                        const meta = dbTables.find((t) => t.name === selectedDbTable);
                        return (
                          <>
                            <div className="flex items-center gap-2">
                              <h2 className="font-semibold text-slate-900">{meta?.display_name || selectedDbTable}</h2>
                              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                                <Eye className="h-3 w-3" />조회 전용
                              </span>
                              {meta && (
                                <InfoTooltip
                                  align="left"
                                  text={
                                    (meta.description ? `${meta.description}\n\n` : '') +
                                    `테이블명: ${meta.name}\n` +
                                    `컬럼 ${meta.columns.length}개: ${meta.columns.join(', ')}`
                                  }
                                />
                              )}
                            </div>
                            {meta?.description && <p className="text-xs text-slate-500">{meta.description}</p>}
                            <p className="text-xs text-slate-400">전체 {dbTableData.total.toLocaleString()}행 · {dbTableData.page}페이지 · <span className="font-mono">{selectedDbTable}</span></p>
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void loadDbTableData(selectedDbTable, dbPage - 1)} disabled={dbPage <= 1} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-30">← 이전</button>
                      <button onClick={() => void loadDbTableData(selectedDbTable, dbPage + 1)} disabled={dbPage * dbTableData.limit >= dbTableData.total} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-30">다음 →</button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          {dbTableData.columns.map((col) => (
                            <th key={col} className="pb-2 pr-4 text-left text-xs font-medium text-slate-500 whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {dbTableData.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            {dbTableData.columns.map((col) => {
                              const val = row[col];
                              const str = val === null || val === undefined ? '' : String(val);
                              const truncated = str.length > 60 ? str.slice(0, 60) + '…' : str;
                              return (
                                <td key={col} className="py-2 pr-4 text-xs text-slate-700 whitespace-nowrap" title={str}>{truncated}</td>
                              );
                            })}
                          </tr>
                        ))}
                        {dbTableData.rows.length === 0 && (
                          <tr><td colSpan={dbTableData.columns.length} className="py-6 text-center text-slate-400">데이터가 없습니다.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {activeTab === 'permissions' && isSuperadmin && (
          <div className="mt-6 space-y-6">
            {/* 최상위 관리자 */}
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">권한 관리</h2>
              <p className="mt-1 text-sm text-slate-500">관리자 페이지에 접근할 수 있는 Google 계정 이메일을 관리합니다.</p>

              {permLoading && <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>}

              {permissionsData && (
                <div className="mt-5 space-y-4">
                  {/* 최상위 관리자 카드 */}
                  {(() => {
                    const isSuperadmin = permissionsData.superadmin === permissionsData.current_user;
                    return (
                      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
                        <div className="flex items-center gap-3">
                          <span className="flex-shrink-0 rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-semibold text-white">최상위 관리자</span>
                          <span className="font-mono text-sm font-medium text-slate-800">{permissionsData.superadmin}</span>
                          {isSuperadmin && (
                            <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">나</span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-amber-700">환경변수 <code className="font-mono">ADMIN_EMAIL</code>로 설정된 계정입니다. 삭제할 수 없으며 모든 권한을 보유합니다.</p>

                        {/* 최상위 관리자 변경 — 본인일 때만 표시 */}
                        {isSuperadmin && (
                          <div className="mt-4 border-t border-amber-200 pt-4">
                            <p className="mb-2 text-xs font-semibold text-amber-800">최상위 관리자 이메일 변경</p>
                            <p className="mb-3 text-xs text-amber-700">변경 즉시 현재 계정은 최상위 관리자 권한을 잃습니다. 새 이메일로 로그인해야 합니다.</p>
                            <div className="flex gap-2">
                              <input
                                value={newSuperadminEmail}
                                onChange={(e) => setNewSuperadminEmail(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                                placeholder="새 최상위 관리자 Google 이메일"
                                className={INPUT_CLASS + ' max-w-sm bg-white'}
                              />
                              <button
                                disabled={superadminSaving || !newSuperadminEmail.trim()}
                                onClick={async () => {
                                  if (!window.confirm(`최상위 관리자를 "${newSuperadminEmail}"로 변경하시겠습니까?\n변경 후 현재 계정은 자동 로그아웃됩니다.`)) return;
                                  setSuperadminSaving(true);
                                  try {
                                    const result = await adminApi.setSuperadmin(newSuperadminEmail.trim());
                                    setNotice(result.message);
                                    setNewSuperadminEmail('');
                                    // 슈퍼어드민이 바뀌었으므로 로그아웃
                                    setTimeout(handleAdminLogout, 2000);
                                  } catch (err: unknown) {
                                    const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                                    setNotice(msg ?? '최상위 관리자 변경에 실패했습니다.');
                                  } finally {
                                    setSuperadminSaving(false);
                                  }
                                }}
                                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                              >
                                {superadminSaving ? '변경 중...' : '변경'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* 관리자 목록 */}
                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-700">관리자 <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{permissionsData.admins.length}명</span></p>
                    {permissionsData.admins.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-400">추가된 관리자가 없습니다.</p>
                    ) : (
                      <ul className="space-y-2">
                        {permissionsData.admins.map((admin) => {
                          const isMe = admin.email === permissionsData.current_user;
                          return (
                            <li key={admin.email} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${isMe ? 'border-cyan-200 bg-cyan-50' : 'border-slate-100'}`}>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-800">{admin.email}</span>
                                  {isMe && <span className="rounded-full bg-cyan-200 px-2 py-0.5 text-xs font-medium text-cyan-800">나</span>}
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">관리자</span>
                                </div>
                                <p className="mt-0.5 text-xs text-slate-400">
                                  {admin.added_by ? `${admin.added_by}이 추가` : '시스템 추가'}
                                  {admin.created_at && ` · ${new Date(admin.created_at).toLocaleDateString('ko-KR')}`}
                                </p>
                              </div>
                              <button
                                onClick={async () => {
                                  if (!window.confirm(`${admin.email}의 권한을 제거할까요?`)) return;
                                  try {
                                    await adminApi.removePermission(admin.email);
                                    setNotice('권한을 제거했습니다.');
                                    await loadPermissions();
                                  } catch {
                                    setNotice('권한 제거에 실패했습니다.');
                                  }
                                }}
                                className="ml-3 flex-shrink-0 text-xs text-rose-500 hover:text-rose-700"
                              >
                                제거
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {/* 이메일 추가 */}
                  <div className="border-t border-slate-100 pt-4">
                    <p className="mb-2 text-sm font-medium text-slate-700">관리자 추가</p>
                    <div className="flex gap-2">
                      <input
                        value={newPermEmail}
                        onChange={(e) => setNewPermEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                        placeholder="추가할 Google 이메일"
                        className={INPUT_CLASS + ' max-w-sm'}
                      />
                      <button
                        disabled={permSaving || !newPermEmail.trim()}
                        onClick={async () => {
                          setPermSaving(true);
                          try {
                            await adminApi.addPermission(newPermEmail.trim());
                            setNewPermEmail('');
                            setNotice('권한을 추가했습니다.');
                            await loadPermissions();
                          } catch {
                            setNotice('권한 추가에 실패했습니다. 이미 등록된 이메일일 수 있습니다.');
                          } finally {
                            setPermSaving(false);
                          }
                        }}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {permSaving ? '추가 중...' : '추가'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="mt-6 space-y-6">
            <div className="grid gap-2 rounded-2xl bg-white p-2 shadow-sm sm:grid-cols-2" role="tablist" aria-label="설정 구분">
              {([
                ['encryption', '암호화 설정'],
                ['models', '모델 설정'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === key}
                  onClick={() => {
                    setSettingsTab(key);
                    if (key === 'models' && !modelSettings) void loadModelSettings();
                  }}
                  className={`min-h-12 whitespace-normal break-keep rounded-xl px-4 py-3 text-center text-sm font-semibold leading-5 transition ${settingsTab === key ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {settingsTab === 'encryption' && (
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">암호화 설정</h2>
                    <InfoTooltip
                      align="left"
                      text={
                        '사용자 이름과 상담 대화, 질문·답변 로그를 Fernet 대칭 암호화로 보호합니다.\n\n' +
                        'FAQ, 프롬프트, 문서 파일명·검토 메모·청크는 운영자가 DB에서 바로 관리할 수 있도록 평문으로 저장합니다.'
                      }
                    />
                  </div>
                  <p className="mt-1 break-keep text-sm leading-6 text-slate-500">대화 데이터의 암호화 상태를 확인하고 기존 평문 대화만 일괄 암호화합니다.</p>
                </div>
                <button onClick={() => { setEncryptionSettings(null); void loadEncryptionSettings(); }} className="min-h-10 shrink-0 whitespace-nowrap rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600">새로고침</button>
              </div>

              {encryptionLoading && <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>}

              {encryptionSettings && (() => {
                const conversation = encryptionSettings.categories[0];
                if (!conversation) return null;
                const completionRate = conversation.total > 0
                  ? Math.round((conversation.encrypted_count / conversation.total) * 100)
                  : 100;
                return (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-slate-900">대화 내용 암호화</h3>
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">항상 ON</span>
                          </div>
                          <p className="mt-2 break-keep text-sm leading-6 text-slate-600">사용자 이름, 상담 메시지, 질문·답변 로그와 취소 요청 메시지를 보호합니다.</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-2xl font-bold text-emerald-700">{completionRate}%</div>
                          <div className="text-xs text-slate-500">암호화 완료</div>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl bg-white px-4 py-3"><div className="text-xs text-slate-500">전체 필드</div><div className="mt-1 text-lg font-semibold text-slate-900">{conversation.total}</div></div>
                        <div className="rounded-xl bg-white px-4 py-3"><div className="text-xs text-slate-500">암호화</div><div className="mt-1 text-lg font-semibold text-emerald-700">{conversation.encrypted_count}</div></div>
                        <div className="rounded-xl bg-white px-4 py-3"><div className="text-xs text-slate-500">기존 평문</div><div className="mt-1 text-lg font-semibold text-amber-700">{conversation.plain_count}</div></div>
                      </div>
                      <button
                        type="button"
                        disabled={migrating !== null || conversation.plain_count === 0}
                        onClick={() => void handleMigrateConversationEncryption()}
                        className="mt-5 min-h-11 w-full whitespace-normal break-keep rounded-xl bg-slate-900 px-5 py-2.5 text-center text-sm font-medium leading-5 text-white disabled:opacity-40 sm:w-auto"
                      >
                        {migrating === 'conversation_encrypt' ? '암호화 처리 중...' : conversation.plain_count > 0 ? `기존 평문 암호화 (${conversation.plain_count}개)` : '모든 대화 데이터 암호화 완료'}
                      </button>
                    </div>

                  </div>
                );
              })()}
            </section>
            )}

            {settingsTab === 'models' && (
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">모델 설정</h2>
                  <p className="mt-1 break-keep text-sm leading-6 text-slate-500">답변 생성과 검색 임베딩에 사용하는 모델을 각각 설정합니다.</p>
                </div>
                <button onClick={() => { setModelSettings(null); void loadModelSettings(); }} className="min-h-10 shrink-0 whitespace-nowrap rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600">새로고침</button>
              </div>

              <div className="mt-5 grid gap-2 rounded-2xl bg-slate-100 p-2 sm:grid-cols-2" role="tablist" aria-label="모델 설정 구분">
                {([
                  ['generation', '답변 생성 모델'],
                  ['embedding', '임베딩 모델'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={modelSettingsTab === key}
                    onClick={() => setModelSettingsTab(key)}
                    className={`min-h-11 whitespace-normal break-keep rounded-xl px-4 py-2.5 text-center text-sm font-semibold leading-5 transition ${modelSettingsTab === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {modelLoadError && (
                <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{modelLoadError}</div>
              )}

              {!modelSettings && !modelLoadError && (
                <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
              )}

              {modelSettingsTab === 'generation' && modelSettings && (() => {
                const allModels = [
                  ...modelSettings.available_models,
                  ...(modelSettings.available_models.includes(modelSettings.current_model) ? [] : [modelSettings.current_model]),
                ].filter((m) => !getModelMeta(m).legacy || m === modelSettings.current_model);
                return (
                  <div className="mt-5 space-y-5">
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-cyan-50 px-4 py-3">
                      <span className="text-xs font-medium text-cyan-600">현재 적용 모델</span>
                      <span className="break-all font-mono text-sm font-semibold text-cyan-800">{modelSettings.current_model}</span>
                    </div>

                    <div className="space-y-2">
                      {/* 정렬 버튼 */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-slate-400">정렬</span>
                        {([
                          ['recommend', '추천순'],
                          ['intelligence', '지능순'],
                          ['value', '가성비순'],
                          ['price', '가격순'],
                          ['speed', '속도순'],
                        ] as [ModelSortKey, string][]).map(([k, label]) => {
                          const active = modelSortKey === k;
                          const arrow = active ? (modelSortDir === 'desc' ? ' ↓' : ' ↑') : '';
                          return (
                            <button
                              key={k}
                              onClick={() => {
                                if (modelSortKey === k) {
                                  setModelSortDir((d) => d === 'desc' ? 'asc' : 'desc');
                                } else {
                                  setModelSortKey(k);
                                  setModelSortDir(k === 'price' || k === 'speed' ? 'asc' : 'desc');
                                }
                              }}
                              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                              {label}{arrow}
                            </button>
                          );
                        })}
                      </div>
                      {sortModels(allModels, modelSortKey, modelSortDir).map((m) => {
                        const info = getModelMeta(m);
                        const isCurrent = m === modelSettings.current_model;
                        const hasPrice = info.inputPrice > 0;
                        const badgeColor: Record<string, string> = {
                          '최신': 'bg-violet-100 text-violet-700',
                          '추천': 'bg-emerald-100 text-emerald-700',
                        };
                        return (
                          <label
                            key={m}
                            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${isCurrent ? 'border-cyan-300 bg-cyan-50' : info.legacy ? 'border-slate-100 bg-slate-50/50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                          >
                            <input type="radio" name="model-select" value={m} defaultChecked={isCurrent} className="mt-0.5 accent-cyan-600" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`break-all font-mono text-sm font-semibold ${info.legacy ? 'text-slate-400' : 'text-slate-800'}`}>{m}</span>
                                {info.badge && (
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor[info.badge] ?? 'bg-slate-100 text-slate-600'}`}>{info.badge}</span>
                                )}
                                {info.legacy && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">레거시</span>
                                )}
                                {isCurrent && (
                                  <span className="rounded-full bg-cyan-200 px-2 py-0.5 text-xs font-medium text-cyan-800">현재</span>
                                )}
                              </div>
                              <p className={`mt-1 text-xs ${info.legacy ? 'text-slate-400' : 'text-slate-500'}`}>{info.desc}</p>
                              <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-slate-400">
                                {info.ctx !== '미확인' && <span>컨텍스트 <span className="font-medium text-slate-600">{info.ctx}</span></span>}
                                <span>속도 <span className="font-medium text-slate-600">{info.speed}</span></span>
                                {hasPrice ? (
                                  <>
                                    <span>입력 <span className="font-medium text-slate-700">${info.inputPrice.toFixed(2)}</span><span className="text-slate-400">/1M tok</span></span>
                                    <span>출력 <span className="font-medium text-slate-700">${info.outputPrice.toFixed(2)}</span><span className="text-slate-400">/1M tok</span></span>
                                  </>
                                ) : (
                                  <span>가격 미확인 — <a href="https://openai.com/api/pricing/" target="_blank" rel="noreferrer" className="underline">공식 페이지</a> 참고</span>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <button
                      disabled={modelSaving}
                      onClick={async () => {
                        const checked = document.querySelector<HTMLInputElement>('input[name="model-select"]:checked');
                        if (!checked?.value) return;
                        setModelSaving(true);
                        try {
                          const result = await adminApi.setModel(checked.value);
                          setModelSettings({ ...modelSettings, current_model: result.model_name });
                          setNotice(result.message);
                        } catch {
                          setNotice('모델 변경에 실패했습니다.');
                        } finally {
                          setModelSaving(false);
                        }
                      }}
                      className="min-h-11 w-full whitespace-normal break-keep rounded-xl bg-slate-900 px-5 py-2.5 text-center text-sm font-medium leading-5 text-white disabled:opacity-50 sm:w-auto"
                    >
                      {modelSaving ? '저장 중...' : '선택한 모델로 적용'}
                    </button>
                  </div>
                );
              })()}

              {modelSettingsTab === 'embedding' && modelSettings && (
                <div className="mt-5">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">임베딩 모델</h3>
                    <p className="mt-1 break-keep text-sm leading-6 text-slate-500">문서와 FAQ를 검색 벡터로 변환할 모델입니다. 저장 후 문서 검토에서 FAISS 변경 확인·재구성을 완료해야 검색에 적용됩니다.</p>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {modelSettings.available_embedding_models.map((modelName) => {
                      const isSelected = embeddingModelSelection === modelName;
                      const isIndexed = modelSettings.indexed_embedding_model === modelName;
                      const isLarge = modelName === 'text-embedding-3-large';
                      return (
                        <label key={modelName} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-2xl border p-4 ${isSelected ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 hover:border-slate-300'}`}>
                          <input
                            type="radio"
                            name="embedding-model-select"
                            value={modelName}
                            checked={isSelected}
                            onChange={() => setEmbeddingModelSelection(modelName)}
                            className="mt-1 accent-cyan-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="break-all font-mono text-sm font-semibold text-slate-800">{modelName}</span>
                              {isLarge && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">품질 추천</span>}
                              {isIndexed && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">현재 인덱스</span>}
                            </div>
                            <p className="mt-2 break-keep text-xs leading-5 text-slate-500">
                              {isLarge ? '한국어를 포함한 검색 품질을 우선할 때 적합합니다. 현재 기본 모델입니다.' : '임베딩 비용과 처리량을 우선할 때 적합합니다.'}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {modelSettings.indexed_embedding_model && modelSettings.indexed_embedding_model !== embeddingModelSelection && (
                    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                      선택 모델과 현재 인덱스 모델이 다릅니다. 저장만으로 기존 검색은 바뀌지 않으며, 문서 검토의 FAISS 인덱스 관리에서 재구성을 확인해야 합니다.
                    </p>
                  )}
                  {!modelSettings.indexed_embedding_model && (
                    <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">현재 인덱스의 임베딩 모델 기록이 없습니다. 다음 재구성부터 선택 모델이 기록됩니다.</p>
                  )}
                  <button
                    type="button"
                    disabled={embeddingModelSaving || !embeddingModelSelection || embeddingModelSelection === modelSettings.current_embedding_model}
                    onClick={async () => {
                      setEmbeddingModelSaving(true);
                      try {
                        const result = await adminApi.setEmbeddingModel(embeddingModelSelection);
                        setModelSettings({ ...modelSettings, current_embedding_model: result.model_name });
                        setNotice(result.message);
                      } catch {
                        setNotice('임베딩 모델 변경에 실패했습니다.');
                      } finally {
                        setEmbeddingModelSaving(false);
                      }
                    }}
                    className="mt-4 min-h-11 w-full whitespace-normal break-keep rounded-xl bg-cyan-700 px-5 py-2.5 text-center text-sm font-medium leading-5 text-white disabled:opacity-50 sm:w-auto"
                  >
                    {embeddingModelSaving ? '저장 중...' : embeddingModelSelection === modelSettings.current_embedding_model ? '저장된 임베딩 모델' : '선택한 임베딩 모델 저장'}
                  </button>
                </div>
              )}
            </section>
            )}
          </div>
        )}

        {activeTab === 'security' && isSuperadmin && <div className="mt-6"><SecurityVault /></div>}
      </div>

      </div>
    </div>
  );
}

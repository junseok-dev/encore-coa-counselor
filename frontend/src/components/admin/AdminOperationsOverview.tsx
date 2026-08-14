import {
  Activity, AlertTriangle, Ban, Bell, CheckCircle2, CreditCard, Database, DollarSign,
  Headphones, MessageCircle, RefreshCw, Save, Server, ShieldAlert, Users, WalletCards, XCircle,
} from 'lucide-react';
import {
  CostManagementData, OpenAiCostData, OperationsAnalyticsData, OperationsDashboardData,
  SystemHealthData, SystemHealthStatus,
} from '../../types';
import OperationsAnalytics from './OperationsAnalytics';

interface Props {
  data: OperationsDashboardData | null;
  loading: boolean;
  analyticsData: OperationsAnalyticsData | null;
  analyticsLoading: boolean;
  analyticsYear: string;
  analyticsMonth: string;
  costData: CostManagementData | null;
  openAiCostData: OpenAiCostData | null;
  systemHealth: SystemHealthData | null;
  healthLoading: boolean;
  onRefresh: () => Promise<void>;
  onYearChange: (year: string) => void;
  onMonthChange: (month: string) => void;
  onRefreshAnalytics: () => Promise<void>;
  onOpenReview: () => void;
  onOpenCosts: () => void;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}

function usd(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(value);
}

function MetricCard({ value, badge, label, caption, icon: Icon, iconClass, iconBg }: { value: string; badge: string; label: string; caption: string; icon: typeof Users; iconClass: string; iconBg: string }) {
  return (
    <div className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}><Icon className={`h-5 w-5 ${iconClass}`} /></div><span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500">{badge}</span></div>
      <div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-950">{value}</p></div><p className="pb-1 text-right text-[11px] leading-4 text-slate-400">{caption}</p></div>
    </div>
  );
}

const HEALTH_STATUS_STYLE: Record<SystemHealthStatus, { label: string; className: string }> = {
  healthy: { label: '정상', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  degraded: { label: '주의', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  critical: { label: '장애', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  unknown: { label: '확인 불가', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  not_configured: { label: '설정 필요', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};
const HEALTH_ICONS = { application: Server, database_read: Database, database_write: Save, ec2: Activity };

function SystemHealthPanel({ data, loading }: { data: SystemHealthData | null; loading: boolean }) {
  const isCritical = data?.overall_status === 'critical';
  const isDegraded = data?.overall_status === 'degraded';
  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${isCritical ? 'border-rose-300' : isDegraded ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className={`flex items-center gap-3 px-5 py-4 ${isCritical ? 'bg-rose-50' : isDegraded ? 'bg-amber-50' : 'bg-slate-50/70'}`}>
        {isCritical ? <XCircle className="h-5 w-5 text-rose-600" /> : isDegraded ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
        <div><h2 className="font-bold text-slate-950">시스템 상태</h2><p className="mt-0.5 text-xs text-slate-500">{data?.generated_at ? `최근 점검 ${formatDateTime(data.generated_at)}` : '시스템 상태를 확인하는 중입니다.'}</p></div>
      </div>
      <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        {(data?.checks ?? []).map((check) => { const Icon = HEALTH_ICONS[check.key] ?? Server; const status = HEALTH_STATUS_STYLE[check.status]; return <div key={check.key} className="bg-white p-4"><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-bold text-slate-800"><Icon className="h-4 w-4 text-slate-400" />{check.label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${status.className}`}>{status.label}</span></div><p className="mt-2 min-h-8 text-xs leading-4 text-slate-500">{check.message}</p><p className="mt-2 text-[10px] text-slate-400">{check.latency_ms !== null ? `${check.latency_ms}ms` : '응답 시간 없음'}</p></div>; })}
        {!data && <div className="col-span-full bg-white p-6 text-center text-sm text-slate-500">{loading ? '시스템 상태를 점검하는 중입니다.' : '시스템 상태를 확인하지 못했습니다.'}</div>}
      </div>
    </section>
  );
}

export default function AdminOperationsOverview({ data, loading, analyticsData, analyticsLoading, analyticsYear, analyticsMonth, costData, openAiCostData, systemHealth, healthLoading, onRefresh, onYearChange, onMonthChange, onRefreshAnalytics, onOpenReview, onOpenCosts }: Props) {
  const summary = data?.summary;
  const unresolved = (data?.attention ?? []).filter((item) => item.status !== 'resolved');
  const highPriorityCount = unresolved.filter((item) => item.severity === 'high').length;
  const changeBadge = (value: number | null | undefined) => value === null || value === undefined ? '비교 없음' : `${value > 0 ? '+' : ''}${value}%`;
  const kpis = [
    { label: '대화 세션', value: `${summary?.visitors.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.visitors), caption: '최근 7일 시작된 대화', icon: Users, iconClass: 'text-cyan-700', iconBg: 'bg-cyan-50' },
    { label: '사용자 질문', value: `${summary?.chats.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.chats), caption: '실제 저장된 질문', icon: MessageCircle, iconClass: 'text-blue-700', iconBg: 'bg-blue-50' },
    { label: '상담 연결', value: `${summary?.handoffs.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.handoffs), caption: '실제 상담 연결', icon: Headphones, iconClass: 'text-violet-700', iconBg: 'bg-violet-50' },
    { label: '취소 요청', value: `${summary?.cancels.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.cancels), caption: '취소 접수', icon: Ban, iconClass: 'text-amber-700', iconBg: 'bg-amber-50' },
    { label: '환불 요청', value: `${summary?.refunds.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.refunds), caption: '환불·환급 접수', icon: CreditCard, iconClass: 'text-emerald-700', iconBg: 'bg-emerald-50' },
    { label: '안전 감지', value: `${summary?.safety.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.safety), caption: '가드레일 감지', icon: ShieldAlert, iconClass: 'text-rose-700', iconBg: 'bg-rose-50' },
    { label: '처리 오류', value: `${summary?.failed.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.failed), caption: '생성·저장 실패', icon: AlertTriangle, iconClass: 'text-slate-700', iconBg: 'bg-slate-100' },
    { label: '세션당 질문', value: `${summary?.avg_questions_per_session.toFixed(1) ?? '0.0'}건`, badge: changeBadge(data?.changes.avg_questions_per_session), caption: '평균 대화 깊이', icon: Activity, iconClass: 'text-teal-700', iconBg: 'bg-teal-50' },
  ];

  return (
    <div className="space-y-6">
      <header className="overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#082f49,#0f766e)] px-6 py-5 text-white shadow-lg shadow-cyan-950/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><Activity className="h-6 w-6 text-cyan-200" /></span><div><p className="text-sm font-semibold text-cyan-100">운영 종합 요약 · 최근 {data?.period_days ?? 7}일</p><h1 className="mt-1 text-2xl font-bold">챗봇 운영 현황</h1><p className="mt-1 text-[11px] text-cyan-100">KPI 증감은 직전 동일 기간과 비교합니다.</p></div></div>
          <div className="flex items-center gap-2">
            {data?.last_conversation_at && <div className="mr-1 hidden rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15 sm:block"><p className="text-[10px] text-cyan-100">최근 대화</p><p className="mt-0.5 text-xs font-bold">{formatRelativeTime(data.last_conversation_at)}</p></div>}
            <button onClick={() => void onRefresh()} disabled={loading} title="대시보드 새로고침" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 hover:bg-white/20 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
            <button onClick={onOpenReview} title="개선 검토 알림 열기" className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 hover:bg-white/20"><Bell className="h-4 w-4" />{unresolved.length > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white ring-2 ring-teal-900">{unresolved.length > 99 ? '99+' : unresolved.length}</span>}</button>
          </div>
        </div>
      </header>
      {highPriorityCount > 0 && <button onClick={onOpenReview} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-left text-rose-900"><span className="flex items-center gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" /><span><b className="block text-sm">우선 확인할 개선 항목 {highPriorityCount}건</b><span className="mt-0.5 block text-xs text-rose-700">대화 맥락을 확인하고 이후 답변을 검증해 주세요.</span></span></span><span className="text-xs font-black">개선 검토 열기</span></button>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{kpis.map((metric) => <MetricCard key={metric.label} {...metric} />)}</div>
      <OperationsAnalytics data={analyticsData} loading={analyticsLoading} selectedYear={analyticsYear} selectedMonth={analyticsMonth} onYearChange={onYearChange} onMonthChange={onMonthChange} onRefresh={onRefreshAnalytics} />
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4"><div className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-blue-600" /><h2 className="font-bold text-slate-950">이번 달 비용</h2></div><button onClick={onOpenCosts} className="text-xs font-black text-blue-700">비용 관리 열기</button></div>
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2"><div className="bg-white p-5"><p className="text-xs font-bold text-slate-500">n·Xavis 인프라 비용</p><p className="mt-2 text-2xl font-black text-slate-950">{costData ? `${costData.usage_total_krw.toLocaleString()}원` : '-'}</p><p className="mt-2 text-xs text-slate-400">업로드된 원화 청구 자료</p></div><div className="bg-white p-5"><p className="flex items-center gap-1.5 text-xs font-bold text-slate-500"><DollarSign className="h-3.5 w-3.5" />OpenAI API 비용</p><p className="mt-2 text-2xl font-black text-emerald-700">{usd(openAiCostData?.total_usd)}</p><p className="mt-2 text-xs text-slate-400">{openAiCostData?.message ?? '비용 상태 확인 중'}</p></div></div>
      </section>
      <SystemHealthPanel data={systemHealth} loading={healthLoading} />
    </div>
  );
}

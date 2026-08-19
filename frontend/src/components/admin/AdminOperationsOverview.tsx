import { useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, BarChart3, Bell, Bot, CreditCard, DollarSign,
  Globe2, Headphones, MessageCircle, RefreshCw, Server, ShieldAlert, Users, WalletCards,
} from 'lucide-react';
import {
  CostManagementData, OpenAiCostData, OperationsAnalyticsData,
  OperationsDashboardData, OperationsPeriodFilters, OperationsPeriodMode,
} from '../../types';
import OperationsAnalytics, { OperationsUsageMetricKey } from './OperationsAnalytics';
import OperationsPeriodFilter from './OperationsPeriodFilter';

interface Props {
  data: OperationsDashboardData | null;
  loading: boolean;
  analyticsData: OperationsAnalyticsData | null;
  analyticsLoading: boolean;
  analyticsPeriod: OperationsPeriodMode;
  analyticsFilters: OperationsPeriodFilters;
  analyticsAnchorDate: string;
  costData: CostManagementData | null;
  openAiCostData: OpenAiCostData | null;
  onRefresh: () => Promise<void>;
  onPeriodChange: (period: OperationsPeriodMode) => void;
  onFiltersChange: (filters: OperationsPeriodFilters) => void;
  onRefreshAnalytics: () => Promise<void>;
  onOpenReview: () => void;
  onOpenCosts: () => void;
}

type OverviewTab = 'usage' | 'analysis' | 'cost';

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

function MetricCard({ value, label, caption, icon: Icon, iconClass, iconBg }: { value: string; label: string; caption: string; icon: typeof Users; iconClass: string; iconBg: string }) {
  return <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}><Icon className={`h-5 w-5 ${iconClass}`} /></div><div className="mt-4"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-950">{value}</p><p className="mt-2 min-h-8 text-[11px] leading-4 text-slate-400">{caption}</p></div></div>;
}

type CostMetric = 'aws' | 'openai';
type UsageGroup = 'traffic' | 'consultation' | 'quality';

const PERIOD_NAMES: Record<OperationsPeriodMode, string> = { year: '연별', month: '월별', week: '주별', day: '일별' };
const PERIOD_OPTIONS: OperationsPeriodMode[] = ['year', 'month', 'week', 'day'];
const USAGE_GROUPS: Record<UsageGroup, { label: string; description: string; metrics: OperationsUsageMetricKey[] }> = {
  traffic: { label: '이용량', description: '방문과 대화 유입', metrics: ['visitors', 'chats', 'homepage'] },
  consultation: { label: '상담 대응', description: '상담 전환과 안전 대응', metrics: ['consultationRequests', 'handoffs', 'safety'] },
  quality: { label: '요청 처리', description: '취소·환불·처리 오류', metrics: ['cancels', 'refunds', 'failed'] },
};

function CostChart({ data, metric }: { data: OperationsAnalyticsData; metric: CostMetric }) {
  const points = data.period_mode === 'year'
    ? data.monthly.map((item) => ({ label: data.period_months > 12 ? `${item.month.slice(0, 4)}.${Number(item.month.slice(5))}` : `${Number(item.month.slice(5))}월`, value: metric === 'aws' ? item.aws_cost_krw : item.openai_estimated_usd }))
    : data.daily.map((item) => ({ label: `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`, value: metric === 'aws' ? item.aws_cost_krw ?? 0 : item.openai_estimated_usd ?? 0 }));
  const maxValue = Math.max(metric === 'aws' ? 1 : 0.000001, ...points.map((item) => item.value));
  const minWidth = `${Math.max(420, points.length * 34)}px`;
  const isAws = metric === 'aws';
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-950">{isAws ? 'AWS 비용 변화' : 'OpenAI 비용 변화'}</h2><p className="mt-1 text-xs text-slate-500">{isAws ? '업로드된 원화 청구 자료입니다.' : '대화 로그에 기록된 사용 추정액입니다.'}</p></div><span className={`h-3 w-3 shrink-0 rounded-full ${isAws ? 'bg-orange-500' : 'bg-emerald-500'}`} /></div><div className="mt-4 overflow-x-auto pb-2"><div className="flex h-60 items-end gap-2 border-b border-slate-200 px-2" style={{ minWidth }}>{points.map((point) => <div key={point.label} className="flex h-full min-w-7 flex-1 flex-col items-center justify-end gap-1"><div className="flex h-48 w-full items-end justify-center" title={`${point.label} · ${isAws ? `${point.value.toLocaleString()}원` : usd(point.value)}`}><span className={`w-[64%] rounded-t ${isAws ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ height: `${Math.max(point.value ? 3 : 0, point.value / maxValue * 100)}%` }} /></div><span className="whitespace-nowrap text-[9px] text-slate-500">{point.label}</span></div>)}</div></div></section>;
}

export default function AdminOperationsOverview({ data, loading, analyticsData, analyticsLoading, analyticsPeriod, analyticsFilters, analyticsAnchorDate, costData, openAiCostData, onRefresh, onPeriodChange, onFiltersChange, onRefreshAnalytics, onOpenReview, onOpenCosts }: Props) {
  const [activeView, setActiveView] = useState<OverviewTab>('usage');
  const [usageGroup, setUsageGroup] = useState<UsageGroup>('traffic');
  const unresolved = (data?.attention ?? []).filter((item) => item.status !== 'resolved');
  const highPriorityCount = unresolved.filter((item) => item.severity === 'high').length;
  const summary = analyticsData?.period_summary;
  const kpis = useMemo(() => [
    { key: 'visitors' as const, label: '방문자', value: `${summary?.visitors.toLocaleString() ?? 0}명`, caption: '새로 시작된 대화 세션', icon: Users, iconClass: 'text-cyan-700', iconBg: 'bg-cyan-50' },
    { key: 'chats' as const, label: '채팅 수', value: `${summary?.chats.toLocaleString() ?? 0}건`, caption: '저장된 사용자 질문', icon: MessageCircle, iconClass: 'text-blue-700', iconBg: 'bg-blue-50' },
    { key: 'homepage' as const, label: '홈페이지 요청', value: `${summary?.homepage_requests.toLocaleString() ?? 0}건`, caption: '공식 홈페이지·링크 요청', icon: Globe2, iconClass: 'text-teal-700', iconBg: 'bg-teal-50' },
    { key: 'consultationRequests' as const, label: '상담 요청', value: `${summary?.consultation_requests.toLocaleString() ?? 0}건`, caption: '챗봇이 상담 연결을 제안', icon: Bot, iconClass: 'text-fuchsia-700', iconBg: 'bg-fuchsia-50' },
    { key: 'handoffs' as const, label: '상담 연결', value: `${summary?.handoffs.toLocaleString() ?? 0}건`, caption: '실제 상담 채널로 연결', icon: Headphones, iconClass: 'text-violet-700', iconBg: 'bg-violet-50' },
    { key: 'cancels' as const, label: '취소 요청', value: `${summary?.cancels.toLocaleString() ?? 0}건`, caption: '과정·신청 취소 접수', icon: Ban, iconClass: 'text-amber-700', iconBg: 'bg-amber-50' },
    { key: 'refunds' as const, label: '환불 요청', value: `${summary?.refunds.toLocaleString() ?? 0}건`, caption: '환불·환급 처리 요청', icon: CreditCard, iconClass: 'text-emerald-700', iconBg: 'bg-emerald-50' },
    { key: 'safety' as const, label: '안전 감지', value: `${summary?.safety.toLocaleString() ?? 0}건`, caption: '안전 가드레일 감지', icon: ShieldAlert, iconClass: 'text-rose-700', iconBg: 'bg-rose-50' },
    { key: 'failed' as const, label: '처리 오류', value: `${summary?.failed.toLocaleString() ?? 0}건`, caption: '답변 생성·저장 실패', icon: AlertTriangle, iconClass: 'text-slate-700', iconBg: 'bg-slate-100' },
  ], [summary]);
  const selectedGroup = USAGE_GROUPS[usageGroup];
  const visibleKpis = kpis.filter((metric) => selectedGroup.metrics.includes(metric.key));

  return <div className="space-y-6">
    <header className="overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#082f49,#0f766e)] px-6 py-5 text-white shadow-lg shadow-cyan-950/10"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><BarChart3 className="h-6 w-6 text-cyan-200" /></span><div><p className="text-sm font-semibold text-cyan-100">{analyticsData?.period_label ?? `${PERIOD_NAMES[analyticsPeriod]} 통계`}</p><h1 className="mt-1 text-2xl font-bold">챗봇 운영 대시보드</h1><p className="mt-1 text-[11px] text-cyan-100">기간과 지표 묶음을 선택해 항목별 변화를 확인합니다.</p></div></div><div className="flex items-center gap-2">{data?.last_conversation_at && <div className="mr-1 hidden rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15 sm:block"><p className="text-[10px] text-cyan-100">최근 대화</p><p className="mt-0.5 text-xs font-bold">{formatRelativeTime(data.last_conversation_at)}</p></div>}<button onClick={() => void onRefresh()} disabled={loading || analyticsLoading} title="대시보드 새로고침" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading || analyticsLoading ? 'animate-spin' : ''}`} /></button><button onClick={onOpenReview} title="개선 검토 알림 열기" className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20"><Bell className="h-4 w-4" />{unresolved.length > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white ring-2 ring-teal-900">{unresolved.length > 99 ? '99+' : unresolved.length}</span>}</button></div></div></header>

    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="flex flex-wrap gap-1.5">{([['usage', '이용 현황'], ['analysis', '답변·상담 분석'], ['cost', '비용']] as const).map(([key, label]) => <button key={key} onClick={() => setActiveView(key)} className={`rounded-xl px-4 py-2.5 text-sm font-black ${activeView === key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}</div><div className="flex flex-col gap-2 xl:items-end"><div className="inline-flex self-start rounded-xl bg-slate-100 p-1 xl:self-end">{PERIOD_OPTIONS.map((period) => <button key={period} onClick={() => onPeriodChange(period)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${analyticsPeriod === period ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{PERIOD_NAMES[period]}</button>)}</div><OperationsPeriodFilter data={analyticsData} loading={analyticsLoading} mode={analyticsPeriod} filters={analyticsFilters} onChange={onFiltersChange} onRefresh={onRefreshAnalytics} /></div></div></section>

    {highPriorityCount > 0 && <button onClick={onOpenReview} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-left text-rose-900"><span className="flex items-center gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" /><span><b className="block text-sm">우선 확인할 개선 항목 {highPriorityCount}건</b><span className="mt-0.5 block text-xs text-rose-700">대화 맥락과 수정 후 답변을 검증해 주세요.</span></span></span><span className="text-xs font-black">개선 검토 열기</span></button>}

    {activeView === 'usage' && <div className="space-y-6"><section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"><div className="grid gap-2 sm:grid-cols-3">{(Object.entries(USAGE_GROUPS) as [UsageGroup, typeof USAGE_GROUPS[UsageGroup]][]).map(([key, group]) => <button key={key} onClick={() => setUsageGroup(key)} className={`rounded-xl px-4 py-3 text-left transition ${usageGroup === key ? 'bg-cyan-700 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}><span className="block text-sm font-black">{group.label}</span><span className={`mt-0.5 block text-[11px] ${usageGroup === key ? 'text-cyan-100' : 'text-slate-400'}`}>{group.description}</span></button>)}</div></section><div><div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-black text-cyan-700">{selectedGroup.label}</p><h2 className="mt-1 text-lg font-black text-slate-950">{analyticsData?.period_label ?? '선택 기간'} 핵심 지표</h2></div><p className="text-xs text-slate-500">각 지표는 독립 그래프로 표시됩니다.</p></div><div className="grid gap-4 sm:grid-cols-3">{visibleKpis.map(({ key, ...metric }) => <MetricCard key={key} {...metric} />)}</div></div><OperationsAnalytics data={analyticsData} loading={analyticsLoading} view="usage" usageMetrics={selectedGroup.metrics} /></div>}
    {activeView === 'analysis' && <OperationsAnalytics data={analyticsData} loading={analyticsLoading} view="analysis" />}
    {activeView === 'cost' && <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label={`${PERIOD_NAMES[analyticsPeriod]} AWS`} value={analyticsData ? `${analyticsData.cost_summary.aws_cost_krw.toLocaleString()}원` : '-'} caption="선택 기간의 업로드 청구 합계" icon={Server} iconClass="text-orange-700" iconBg="bg-orange-50" /><MetricCard label={`${PERIOD_NAMES[analyticsPeriod]} OpenAI`} value={usd(analyticsData?.cost_summary.openai_estimated_usd)} caption="선택 기간의 대화 로그 추정액" icon={DollarSign} iconClass="text-emerald-700" iconBg="bg-emerald-50" /><MetricCard label={`${analyticsAnchorDate.slice(0, 7)} AWS`} value={costData ? `${costData.usage_total_krw.toLocaleString()}원` : '-'} caption="기준 월 업로드 청구 합계" icon={WalletCards} iconClass="text-blue-700" iconBg="bg-blue-50" /><MetricCard label={`${analyticsAnchorDate.slice(0, 7)} OpenAI 실제`} value={usd(openAiCostData?.total_usd)} caption={openAiCostData?.message ?? 'OpenAI 관리 API 비용'} icon={Bot} iconClass="text-violet-700" iconBg="bg-violet-50" /></div>{analyticsData ? <div className="grid gap-5 xl:grid-cols-2"><CostChart data={analyticsData} metric="aws" /><CostChart data={analyticsData} metric="openai" /></div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-24 text-center text-sm text-slate-400">{analyticsLoading ? '비용 통계를 불러오는 중입니다.' : '비용 데이터가 없습니다.'}</div>}<button onClick={onOpenCosts} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white"><WalletCards className="h-4 w-4" />상세 비용 관리 열기</button></div>}
  </div>;
}

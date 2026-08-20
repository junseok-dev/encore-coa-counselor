import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BarChart3, Bell, CalendarRange, CreditCard, Headphones,
  MessageCircle, RefreshCw, ShieldAlert, Users,
} from 'lucide-react';
import {
  OperationsAnalyticsData, OperationsAttentionItem, OperationsDashboardData, OperationsPeriodFilters, OperationsPeriodMode,
} from '../../types';
import { dateTimeMillis, formatKoreaDateTime } from '../../utils/dateTime';
import OperationsAnalytics from './OperationsAnalytics';
import OperationsPeriodFilter from './OperationsPeriodFilter';

interface Props {
  data: OperationsDashboardData | null;
  loading: boolean;
  analyticsData: OperationsAnalyticsData | null;
  analyticsLoading: boolean;
  analyticsPeriod: OperationsPeriodMode;
  analyticsFilters: OperationsPeriodFilters;
  onRefresh: () => Promise<void>;
  onPeriodChange: (period: OperationsPeriodMode) => void;
  onFiltersChange: (filters: OperationsPeriodFilters) => void;
  onRefreshAnalytics: () => Promise<void>;
  onOpenReview: (item?: OperationsAttentionItem) => void;
}

const PERIOD_NAMES: Record<OperationsPeriodMode, string> = { year: '연별', month: '월별', week: '주별', day: '일별' };
const PERIOD_OPTIONS: OperationsPeriodMode[] = ['year', 'month', 'week', 'day'];
const SIGNAL_LABEL = {
  handoff: '상담 연결', cancel: '취소 문의', refund: '환불 요청',
  safety: '안전 감지', error: '처리 오류', quality: '직접 등록',
  intent_deviation: '의도 이탈', context_mismatch: '문맥 불일치',
  user_complaint: '답변 불만', repeated_failure: '반복 실패',
  safety_failure: '안전 처리 실패',
};

function formatRelativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - dateTimeMillis(value)) / 60000));
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}

function SummaryCard({ title, icon: Icon, iconClass, iconBg, values, guidance }: { title: string; icon: typeof Users; iconClass: string; iconBg: string; values: { label: string; value: number; unit: string }[]; guidance?: { message: string; pending: number; onOpen?: () => void } }) {
  return <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2.5"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconBg}`}><Icon className={`h-4 w-4 ${iconClass}`} /></span><h2 className="text-sm font-black text-slate-800">{title}</h2></div>
    <div className="mt-4 grid grid-cols-2 divide-x divide-slate-100">{values.map((item) => <div key={item.label} className="px-3 first:pl-0 last:pr-0"><p className="text-[11px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{item.value.toLocaleString()}<span className="ml-1 text-xs font-bold text-slate-400">{item.unit}</span></p></div>)}</div>
    {guidance && <div className="mt-3 border-t border-slate-100 pt-3"><p className="text-[10px] leading-4 text-slate-500">{guidance.message}</p>{guidance.pending > 0 && guidance.onOpen ? <button type="button" onClick={guidance.onOpen} className="mt-2 flex w-full items-center justify-between rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-black text-rose-700 hover:bg-rose-100"><span>미확인 안정성 {guidance.pending}건</span><span className="flex items-center gap-1">검토하기<ArrowRight className="h-3.5 w-3.5" /></span></button> : <p className="mt-2 text-[10px] font-bold text-emerald-600">현재 미확인 문제 없음</p>}</div>}
  </div>;
}

export default function AdminOperationsOverview({ data, loading, analyticsData, analyticsLoading, analyticsPeriod, analyticsFilters, onRefresh, onPeriodChange, onFiltersChange, onRefreshAnalytics, onOpenReview }: Props) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const knownNotificationIdsRef = useRef<Set<number> | null>(null);
  const notificationPopoverRef = useRef<HTMLDivElement>(null);
  const unresolved = useMemo(() => (data?.attention ?? []).filter((item) => item.status !== 'resolved'), [data?.attention]);
  const notifications = useMemo(() => [...unresolved].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return dateTimeMillis(b.created_at) - dateTimeMillis(a.created_at);
  }), [unresolved]);
  const stabilityNotifications = useMemo(
    () => notifications.filter((item) => ['safety', 'error', 'repeated_failure', 'safety_failure'].includes(item.type)),
    [notifications],
  );
  const unresolvedSafetyCount = stabilityNotifications.filter((item) => ['safety', 'safety_failure'].includes(item.type)).length;
  const unresolvedErrorCount = stabilityNotifications.filter((item) => ['error', 'repeated_failure'].includes(item.type)).length;
  const highPriorityCount = unresolved.filter((item) => item.severity === 'high').length;
  const summary = analyticsData?.period_summary;
  const cards: Parameters<typeof SummaryCard>[0][] = [
    { title: '이용 현황', icon: MessageCircle, iconClass: 'text-cyan-700', iconBg: 'bg-cyan-50', values: [{ label: '방문자', value: summary?.visitors ?? 0, unit: '명' }, { label: '채팅', value: summary?.chats ?? 0, unit: '건' }] },
    { title: '사람 상담', icon: Headphones, iconClass: 'text-violet-700', iconBg: 'bg-violet-50', values: [{ label: '상담 요청', value: summary?.handoffs ?? 0, unit: '건' }, { label: '연결 클릭', value: summary?.handoff_clicks ?? 0, unit: '건' }] },
    { title: '취소·환불', icon: CreditCard, iconClass: 'text-amber-700', iconBg: 'bg-amber-50', values: [{ label: '취소 요청', value: summary?.cancels ?? 0, unit: '건' }, { label: '환불 요청', value: summary?.refunds ?? 0, unit: '건' }] },
    { title: '안전성', icon: ShieldAlert, iconClass: 'text-rose-700', iconBg: 'bg-rose-50', values: [{ label: '미확인 안전', value: unresolvedSafetyCount, unit: '건' }, { label: '미확인 오류', value: unresolvedErrorCount, unit: '건' }], guidance: { message: '해결 완료하거나 문제 없음으로 확인하면 카드와 알림에서 제외됩니다.', pending: stabilityNotifications.length, onOpen: stabilityNotifications[0] ? () => onOpenReview(stabilityNotifications[0]) : undefined } },
  ];

  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(unresolved.map((item) => item.alert_id));
    const knownIds = knownNotificationIdsRef.current;
    if (knownIds && notifications.some((item) => !knownIds.has(item.alert_id))) setNotificationsOpen(true);
    knownNotificationIdsRef.current = currentIds;
  }, [data, notifications, unresolved]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closePopover = (event: MouseEvent) => {
      if (!notificationPopoverRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', closePopover);
    return () => document.removeEventListener('mousedown', closePopover);
  }, [notificationsOpen]);

  return <div className="space-y-6">
    {highPriorityCount > 0 && <button onClick={() => setNotificationsOpen(true)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-left text-rose-900"><span className="flex items-center gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" /><span><b className="block text-sm">우선 확인할 개선 항목 {highPriorityCount}건</b><span className="mt-0.5 block text-xs text-rose-700">기간과 관계없이 미확인 안전 감지와 처리 오류를 우선 표시합니다.</span></span></span><span className="text-xs font-black">알림 보기</span></button>}

    <header className="relative rounded-2xl bg-[linear-gradient(120deg,#082f49,#0f766e)] px-6 py-5 text-white shadow-lg shadow-cyan-950/10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><BarChart3 className="h-6 w-6 text-cyan-200" /></span><div><p className="text-sm font-semibold text-cyan-100">{analyticsData?.period_label ?? `${PERIOD_NAMES[analyticsPeriod]} 통계`}</p><h1 className="mt-1 text-2xl font-bold">상담 운영 대시보드</h1><p className="mt-1 text-[11px] text-cyan-100">이용량, 사람 상담, 요청 처리와 안전 상태를 간결하게 확인합니다.</p></div></div>
        <div className="flex items-center gap-2">
          {data?.last_conversation_at && <div className="mr-1 hidden rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15 sm:block"><p className="text-[10px] text-cyan-100">최근 대화</p><p className="mt-0.5 text-xs font-bold">{formatRelativeTime(data.last_conversation_at)}</p></div>}
          <button onClick={() => void onRefresh()} disabled={loading || analyticsLoading} title="대시보드 새로고침" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading || analyticsLoading ? 'animate-spin' : ''}`} /></button>
          <div ref={notificationPopoverRef} className="relative">
            <button onClick={() => setNotificationsOpen((open) => !open)} title="개선 검토 알림 열기" aria-expanded={notificationsOpen} className={`relative flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${notificationsOpen ? 'bg-white text-slate-950 ring-white' : 'bg-white/10 text-white ring-white/20'}`}><Bell className="h-4 w-4" />{unresolved.length > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white ring-2 ring-teal-900">{unresolved.length > 99 ? '99+' : unresolved.length}</span>}</button>
            {notificationsOpen && <div role="dialog" aria-label="개선 검토 알림" className="absolute right-0 top-[calc(100%+12px)] z-50 w-[min(380px,calc(100vw-3rem))] text-slate-900"><span className="absolute -top-2 right-3 h-4 w-4 rotate-45 border-l border-t border-slate-200 bg-white" /><div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20"><div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-black">개선 검토 알림</h2><p className="mt-0.5 text-[11px] text-slate-500">전체 기간 미확인 {notifications.length}건</p></div><div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">{notifications.length > 0 ? notifications.map((item) => <button key={item.alert_id} type="button" onClick={() => { setNotificationsOpen(false); onOpenReview(item); }} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.severity === 'high' ? 'bg-rose-500' : item.severity === 'medium' ? 'bg-amber-500' : 'bg-cyan-500'}`} /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate text-xs text-slate-900">{SIGNAL_LABEL[item.type]} · {item.reason}</strong>{item.severity === 'high' && <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-black text-rose-700">긴급</span>}</span><span className="mt-1 block truncate text-[11px] text-slate-500">{item.question || '질문 내용 없음'}</span><span className="mt-1 block text-[9px] text-slate-400">{formatKoreaDateTime(item.created_at)}</span></span></button>) : <p className="px-4 py-8 text-center text-xs text-slate-400">미확인 항목이 없습니다.</p>}</div></div></div>}
          </div>
        </div>
      </div>
    </header>

    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"><CalendarRange className="h-5 w-5" /></span>
          <div><h2 className="text-sm font-black text-slate-900">통계 조회 기간</h2><p className="mt-0.5 text-[11px] text-slate-500">집계 단위와 상세 범위를 선택하세요.</p></div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-end">
          <div className="inline-flex self-start rounded-xl bg-slate-100 p-1">{PERIOD_OPTIONS.map((period) => <button key={period} onClick={() => onPeriodChange(period)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${analyticsPeriod === period ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{PERIOD_NAMES[period]}</button>)}</div>
          <div className="hidden h-9 w-px bg-slate-200 lg:block" />
          <OperationsPeriodFilter data={analyticsData} loading={analyticsLoading} mode={analyticsPeriod} filters={analyticsFilters} onChange={onFiltersChange} onRefresh={onRefreshAnalytics} />
        </div>
      </div>
    </section>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((metric) => <SummaryCard key={metric.title} {...metric} />)}</div>
    <OperationsAnalytics data={analyticsData} loading={analyticsLoading} />
  </div>;
}

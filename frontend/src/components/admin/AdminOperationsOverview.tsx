import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, BarChart3, Bell, BookOpenCheck, CreditCard,
  ExternalLink, MessageCircle, RefreshCw, ShieldAlert, Users,
} from 'lucide-react';
import {
  OperationsAnalyticsData, OperationsAttentionItem, OperationsDashboardData, OperationsPeriodFilters, OperationsPeriodMode,
} from '../../types';
import { dateTimeMillis, formatKoreaDateTime } from '../../utils/dateTime';
import OperationsAnalytics, { OperationsDashboardView } from './OperationsAnalytics';
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
const VIEWS: { key: OperationsDashboardView; label: string; description: string }[] = [
  { key: 'traffic', label: '이용 현황', description: '방문자와 채팅 흐름' },
  { key: 'interest', label: '수강 관심', description: '과정 문의와 페이지 이동' },
  { key: 'withdrawal', label: '취소·환불', description: '관심 철회와 환불 요청' },
  { key: 'risk', label: '안전·오류', description: '위험 감지와 잠재 손실' },
];

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

function MetricCard({ value, label, caption, icon: Icon, iconClass, iconBg }: { value: string; label: string; caption: string; icon: typeof Users; iconClass: string; iconBg: string }) {
  return <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}><Icon className={`h-5 w-5 ${iconClass}`} /></div>
    <div className="mt-4"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-950">{value}</p><p className="mt-2 min-h-8 text-[11px] leading-4 text-slate-400">{caption}</p></div>
  </div>;
}

export default function AdminOperationsOverview({ data, loading, analyticsData, analyticsLoading, analyticsPeriod, analyticsFilters, onRefresh, onPeriodChange, onFiltersChange, onRefreshAnalytics, onOpenReview }: Props) {
  const [activeView, setActiveView] = useState<OperationsDashboardView>('traffic');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const knownNotificationIdsRef = useRef<Set<number> | null>(null);
  const notificationPopoverRef = useRef<HTMLDivElement>(null);
  const unresolved = useMemo(() => (data?.attention ?? []).filter((item) => item.status !== 'resolved'), [data?.attention]);
  const notifications = useMemo(() => [...unresolved].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return dateTimeMillis(b.created_at) - dateTimeMillis(a.created_at);
  }), [unresolved]);
  const highPriorityCount = unresolved.filter((item) => item.severity === 'high').length;
  const summary = analyticsData?.period_summary;
  const cards = {
    traffic: [
      { label: '방문자', value: `${summary?.visitors.toLocaleString() ?? 0}명`, caption: '새로 시작된 고유 대화 세션', icon: Users, iconClass: 'text-cyan-700', iconBg: 'bg-cyan-50' },
      { label: '채팅 수', value: `${summary?.chats.toLocaleString() ?? 0}건`, caption: '사용자가 실제로 남긴 질문', icon: MessageCircle, iconClass: 'text-blue-700', iconBg: 'bg-blue-50' },
    ],
    interest: [
      { label: '수강 문의', value: `${(summary?.course_inquiries ?? 0).toLocaleString()}건`, caption: '전체 대화 맥락에서 과정 관심이 확인된 세션', icon: BookOpenCheck, iconClass: 'text-violet-700', iconBg: 'bg-violet-50' },
      { label: '과정 페이지 이동', value: `${(summary?.course_page_views ?? 0).toLocaleString()}건`, caption: '챗봇에서 과정 상세 링크를 실제로 누른 세션', icon: ExternalLink, iconClass: 'text-teal-700', iconBg: 'bg-teal-50' },
    ],
    withdrawal: [
      { label: '수강 취소 문의', value: `${summary?.cancels.toLocaleString() ?? 0}건`, caption: '단순 정책 질문이 아닌 취소 의도 접수', icon: Ban, iconClass: 'text-amber-700', iconBg: 'bg-amber-50' },
      { label: '환불 요청', value: `${summary?.refunds.toLocaleString() ?? 0}건`, caption: '환불·환급 의도가 확인된 요청', icon: CreditCard, iconClass: 'text-emerald-700', iconBg: 'bg-emerald-50' },
    ],
    risk: [
      { label: '안전 감지', value: `${summary?.safety.toLocaleString() ?? 0}건`, caption: '안전 가드레일이 개입한 대화', icon: ShieldAlert, iconClass: 'text-rose-700', iconBg: 'bg-rose-50' },
      { label: '처리 오류', value: `${summary?.failed.toLocaleString() ?? 0}건`, caption: '답변 생성 또는 저장 실패', icon: AlertTriangle, iconClass: 'text-slate-700', iconBg: 'bg-slate-100' },
      { label: '영향받은 세션', value: `${(summary?.affected_sessions ?? 0).toLocaleString()}건`, caption: '안전 감지나 오류가 포함된 고유 대화', icon: Users, iconClass: 'text-orange-700', iconBg: 'bg-orange-50' },
      { label: '잠재 문의 손실', value: `${(summary?.potential_inquiry_loss ?? 0).toLocaleString()}건`, caption: '과정 관심 대화가 오류 뒤 정상 복구되지 않은 세션', icon: Ban, iconClass: 'text-red-700', iconBg: 'bg-red-50' },
    ],
  } satisfies Record<OperationsDashboardView, Parameters<typeof MetricCard>[0][]>;

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
        <div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><BarChart3 className="h-6 w-6 text-cyan-200" /></span><div><p className="text-sm font-semibold text-cyan-100">{analyticsData?.period_label ?? `${PERIOD_NAMES[analyticsPeriod]} 통계`}</p><h1 className="mt-1 text-2xl font-bold">챗봇 운영 대시보드</h1><p className="mt-1 text-[11px] text-cyan-100">이용부터 수강 관심, 이탈, 오류 영향까지 대화 맥락으로 확인합니다.</p></div></div>
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

    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">{VIEWS.map((view) => <button key={view.key} onClick={() => setActiveView(view.key)} className={`rounded-xl px-4 py-2.5 text-left ${activeView === view.key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><span className="block text-sm font-black">{view.label}</span><span className={`mt-0.5 block text-[10px] ${activeView === view.key ? 'text-slate-300' : 'text-slate-400'}`}>{view.description}</span></button>)}</div>
        <div className="flex flex-col gap-2 xl:items-end"><div className="inline-flex self-start rounded-xl bg-slate-100 p-1 xl:self-end">{PERIOD_OPTIONS.map((period) => <button key={period} onClick={() => onPeriodChange(period)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${analyticsPeriod === period ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{PERIOD_NAMES[period]}</button>)}</div><OperationsPeriodFilter data={analyticsData} loading={analyticsLoading} mode={analyticsPeriod} filters={analyticsFilters} onChange={onFiltersChange} onRefresh={onRefreshAnalytics} /></div>
      </div>
    </section>

    <div className={`grid gap-4 ${cards[activeView].length === 2 ? 'sm:grid-cols-2' : cards[activeView].length === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>{cards[activeView].map((metric) => <MetricCard key={metric.label} {...metric} />)}</div>
    <OperationsAnalytics data={analyticsData} loading={analyticsLoading} view={activeView} />
  </div>;
}

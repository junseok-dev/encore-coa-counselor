import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Globe2,
  Headphones,
  MessageCircle,
  Radio,
  CreditCard,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import {
  OperationsAttentionItem,
  OperationsDashboardData,
  OperationsSignalType,
  SystemHealthData,
  SystemHealthStatus,
} from '../../types';
import OperationsAlertDetailPanel from './OperationsAlertDetail';

interface OperationsDashboardProps {
  data: OperationsDashboardData | null;
  loading: boolean;
  systemHealth: SystemHealthData | null;
  healthLoading: boolean;
  onRefreshHealth: () => Promise<void>;
  onRefreshOperations: () => Promise<void>;
  onOpenPrompts: () => void;
}

const SIGNAL_CONFIG: Record<OperationsSignalType, { label: string; badge: string; dot: string }> = {
  handoff: { label: '상담 연결', badge: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  cancel: { label: '취소 요청', badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  refund: { label: '환불 요청', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  safety: { label: '안전 확인', badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  error: { label: '처리 오류', badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-500' },
  quality: { label: '답변 품질', badge: 'bg-cyan-50 text-cyan-800 ring-cyan-200', dot: 'bg-cyan-500' },
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLastConversation(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(value: string) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSeconds < 60) return '방금 전';
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}개월 전`;
  return `${Math.floor(months / 12)}년 전`;
}

function MetricCard({
  value,
  badge,
  label,
  caption,
  icon: Icon,
  iconClass,
  iconBg,
}: { value: string; badge: string; label: string; caption: string; icon: typeof Users; iconClass: string; iconBg: string }) {
  return (
    <div className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`h-5 w-5 ${iconClass}`} />
        </div>
        <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500">{badge}</span>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
        </div>
        <p className="pb-1 text-right text-[11px] leading-4 text-slate-400">{caption}</p>
      </div>
    </div>
  );
}

function AttentionRow({
  item,
  onOpenDetail,
}: {
  item: OperationsAttentionItem;
  onOpenDetail: () => void;
}) {
  const config = SIGNAL_CONFIG[item.type];
  const statusLabel = item.status === 'open' ? '미확인' : item.status === 'checking' ? '확인 중' : item.status === 'developer_required' ? '개발자 조치 필요' : '처리 완료';
  return (
    <div className={`group grid w-full gap-3 border-b border-slate-100 px-1 py-4 text-left last:border-0 sm:grid-cols-[128px_1fr_auto] sm:px-3 ${item.status === 'resolved' ? 'opacity-60' : 'hover:bg-slate-50/80'}`}>
      <div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${config.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
          {config.label}
        </span>
        <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${item.status === 'open' ? 'bg-rose-100 text-rose-700' : item.status === 'checking' ? 'bg-blue-100 text-blue-700' : item.status === 'developer_required' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-700'}`}>{statusLabel}</span>
        <p className="mt-2 text-[11px] text-slate-400">{formatDateTime(item.created_at)}</p>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-slate-900">{item.reason}</p>
          {item.severity === 'high' && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">우선 확인</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{item.question || '질문 내용 없음'}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{item.session_id}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button onClick={onOpenDetail} className="inline-flex items-center rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800 hover:bg-cyan-100">상세 확인 <ChevronRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" /></button>
      </div>
    </div>
  );
}

function EmptyPanel({ loading }: { loading: boolean }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
      <Activity className={`h-8 w-8 text-slate-300 ${loading ? 'animate-pulse' : ''}`} />
      <p className="mt-3 text-sm font-medium text-slate-600">{loading ? '운영 데이터를 불러오는 중입니다.' : '이 기간에 확인할 운영 신호가 없습니다.'}</p>
      <p className="mt-1 text-xs text-slate-400">새로운 대화가 시작되면 이곳에 바로 표시됩니다.</p>
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

const HEALTH_ICONS = {
  application: Server,
  database_read: Database,
  database_write: Save,
  ec2: Activity,
};

function SystemHealthPanel({ data, loading, onRefresh }: { data: SystemHealthData | null; loading: boolean; onRefresh: () => Promise<void> }) {
  const isCritical = data?.overall_status === 'critical';
  const isDegraded = data?.overall_status === 'degraded';
  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${isCritical ? 'border-rose-300 shadow-rose-100/60' : isDegraded ? 'border-amber-300 shadow-amber-100/60' : 'border-slate-200'}`}>
      <div className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${isCritical ? 'bg-rose-50' : isDegraded ? 'bg-amber-50' : 'bg-slate-50/70'}`}>
        <div className="flex items-center gap-3">
          {isCritical ? <XCircle className="h-5 w-5 text-rose-600" /> : isDegraded ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          <div>
            <h2 className="font-bold text-slate-950">시스템 상태</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isCritical ? '데이터 조회·저장 또는 서버 장애를 즉시 확인해야 합니다.' : isDegraded ? '서비스는 동작 중이지만 일부 외부 상태를 확인할 권한이 없습니다.' : 'API와 데이터베이스를 20초마다 실제로 점검합니다.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.generated_at && <span className="text-[11px] text-slate-400">최근 점검 {formatDateTime(data.generated_at)}</span>}
          <button onClick={() => void onRefresh()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 다시 점검
          </button>
        </div>
      </div>
      <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        {(data?.checks ?? []).map((check) => {
          const Icon = HEALTH_ICONS[check.key] ?? Server;
          const status = HEALTH_STATUS_STYLE[check.status];
          return (
            <div key={check.key} className="bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-800"><Icon className="h-4 w-4 text-slate-400" />{check.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${status.className}`}>{status.label}</span>
              </div>
              <p className="mt-2 min-h-8 text-xs leading-4 text-slate-500">{check.message}</p>
              {check.key === 'ec2' && check.status !== 'healthy' && (
                <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[10px] leading-4 text-amber-900">
                  <p><b>현재 원인</b> {String(check.details.cause || 'AWS에서 EC2 상태를 조회하지 못했습니다.')}</p>
                  <p><b>해결 방법</b> {String(check.details.action || 'IAM 권한과 인스턴스 설정을 확인하세요.')}</p>
                  {check.details.instance_id && <p className="break-all font-mono text-amber-700">인스턴스 {String(check.details.instance_id)}</p>}
                  {check.details.error_code && <p className="font-mono text-amber-700">오류 코드 {String(check.details.error_code)}</p>}
                </div>
              )}
              <p className="mt-2 text-[10px] text-slate-400">{check.latency_ms !== null ? `${check.latency_ms}ms` : check.status === 'not_configured' ? 'AWS_EC2_INSTANCE_ID 필요' : '응답 시간 없음'}</p>
            </div>
          );
        })}
        {!data && (
          <div className="col-span-full bg-white p-6 text-center text-sm text-slate-500">{loading ? '시스템 상태를 점검하는 중입니다.' : '시스템 상태를 확인하지 못했습니다.'}</div>
        )}
      </div>
    </section>
  );
}

function MonitoringView({ data, loading, filter, onFilterChange, onOpenDetail }: { data: OperationsDashboardData | null; loading: boolean; filter: 'all' | OperationsSignalType; onFilterChange: (filter: 'all' | OperationsSignalType) => void; onOpenDetail: (item: OperationsAttentionItem) => void }) {
  const [query, setQuery] = useState('');
  const items = data?.attention ?? [];
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== 'all' && item.type !== filter) return false;
      if (!keyword) return true;
      return `${item.session_id} ${item.question} ${item.reason}`.toLowerCase().includes(keyword);
    });
  }, [filter, items, query]);

  const filters: { key: 'all' | OperationsSignalType; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'handoff', label: '상담 연결' },
    { key: 'cancel', label: '취소 요청' },
    { key: 'refund', label: '환불 요청' },
    { key: 'safety', label: '안전 확인' },
    { key: 'error', label: '처리 오류' },
  ];

  return (
    <div id="operations-alert-detail" className="scroll-mt-6 space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <Radio className="h-5 w-5" />
            <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-emerald-500 ring-2 ring-white" />
          </span>
          <div>
            <p className="font-semibold text-slate-900">긴급 확인 큐 상세</p>
            <p className="text-xs text-slate-500">관련 대화 확인부터 원인·조치 기록, 수정 후 답변 테스트와 완료 이력까지 관리합니다.</p>
          </div>
        </div>
        <label className="relative block w-full lg:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="세션 ID 또는 대화 내용 검색" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
          {filters.map(({ key, label }) => {
            const count = key === 'all' ? items.length : items.filter((item) => item.type === key).length;
            return (
              <button key={key} onClick={() => onFilterChange(key)} className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${filter === key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {label} <span className={`ml-1 ${filter === key ? 'text-cyan-300' : 'text-slate-400'}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2">
          {filtered.length > 0 ? filtered.map((item) => <AttentionRow key={`${item.id}-${item.type}`} item={item} onOpenDetail={() => onOpenDetail(item)} />) : <EmptyPanel loading={loading} />}
        </div>
      </div>
    </div>
  );
}

export default function OperationsDashboard({ data, loading, systemHealth, healthLoading, onRefreshHealth, onRefreshOperations, onOpenPrompts }: OperationsDashboardProps) {
  const [selectedAlert, setSelectedAlert] = useState<OperationsAttentionItem | null>(null);
  const [detailFilter, setDetailFilter] = useState<'all' | OperationsSignalType>('all');
  const summary = data?.summary;
  const attention = data?.attention ?? [];
  const urgentItems = attention
    .filter((item) => item.status !== 'resolved' && (item.severity === 'high' || (item.type === 'handoff' && item.status === 'open')))
    .sort((a, b) => Number(b.severity === 'high') - Number(a.severity === 'high'));
  const urgentCount = urgentItems.length;
  const urgentCategories = (['handoff', 'cancel', 'refund', 'safety', 'error'] as OperationsSignalType[])
    .map((type) => ({ type, count: urgentItems.filter((item) => item.type === type).length }))
    .filter(({ count }) => count > 0);
  const lastConversationAt = data?.last_conversation_at;
  const changeBadge = (value: number | null | undefined) => value === null || value === undefined ? '비교 없음' : `${value > 0 ? '+' : ''}${value}%`;
  const kpis = [
    { label: '방문자', value: `${summary?.visitors.toLocaleString() ?? 0}명`, badge: changeBadge(data?.changes.visitors), caption: '최근 7일 새 대화 세션', icon: Users, iconClass: 'text-cyan-700', iconBg: 'bg-cyan-50' },
    { label: '채팅', value: `${summary?.chats.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.chats), caption: '최근 7일 사용자 질문', icon: MessageCircle, iconClass: 'text-blue-700', iconBg: 'bg-blue-50' },
    { label: '상담 연결', value: `${summary?.handoffs.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.handoffs), caption: '최근 7일 상담 연결·권유', icon: Headphones, iconClass: 'text-violet-700', iconBg: 'bg-violet-50' },
    { label: '취소 요청', value: `${summary?.cancels.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.cancels), caption: '최근 7일 취소 접수', icon: Ban, iconClass: 'text-amber-700', iconBg: 'bg-amber-50' },
    { label: '환불 요청', value: `${summary?.refunds.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.refunds), caption: '환불·환급 처리 요청', icon: CreditCard, iconClass: 'text-emerald-700', iconBg: 'bg-emerald-50' },
    { label: '홈페이지 요청', value: `${summary?.homepage_requests.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.homepage_requests), caption: '공식 사이트·링크 요청', icon: Globe2, iconClass: 'text-cyan-700', iconBg: 'bg-cyan-50' },
    { label: '안전 위험', value: `${summary?.safety.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.safety), caption: '안전 가드레일 감지', icon: ShieldAlert, iconClass: 'text-rose-700', iconBg: 'bg-rose-50' },
    { label: '처리 오류', value: `${summary?.failed.toLocaleString() ?? 0}건`, badge: changeBadge(data?.changes.failed), caption: '응답 생성·저장 실패', icon: AlertTriangle, iconClass: 'text-slate-700', iconBg: 'bg-slate-100' },
  ];
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#082f49,#0f766e)] px-6 py-5 text-white shadow-lg shadow-cyan-950/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Activity className="h-6 w-6 text-cyan-200" />
            </span>
            <div>
              <p className="text-sm font-semibold text-cyan-100">운영 종합 요약 · 최근 {data?.period_days ?? 7}일</p>
              <p className="mt-1 text-2xl font-bold">긴급 대응 {urgentCount}건 · 전체 알림 {attention.length}건</p>
              <p className="mt-1 text-[11px] text-cyan-100">오늘을 포함한 최근 7일 집계이며 KPI 증감은 직전 7일과 비교합니다.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
              <Clock3 className="h-4 w-4 shrink-0 text-cyan-200" />
              <div>
                <p className="text-[10px] font-semibold text-cyan-100">최근 대화</p>
                {lastConversationAt ? <p className="mt-0.5 text-xs font-bold text-white">{formatLastConversation(lastConversationAt)} <span className="ml-1 text-cyan-200">· {formatRelativeTime(lastConversationAt)}</span></p> : <p className="mt-0.5 text-xs font-bold text-white">아직 저장된 대화가 없습니다.</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              {(['cancel', 'refund', 'safety', 'handoff', 'error'] as OperationsSignalType[]).map((type) => (
                <span key={type} className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">
                  {SIGNAL_CONFIG[type].label} {attention.filter((item) => item.type === type).length}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {urgentItems.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border-2 border-rose-300 bg-white shadow-lg shadow-rose-100/60">
          <div className="flex flex-col gap-3 bg-rose-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-rose-600 text-white">
                <AlertTriangle className="h-5 w-5" />
                <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-rose-500" />
              </span>
              <div>
                <h2 className="font-bold text-rose-950">긴급 확인 큐</h2>
                <p className="mt-0.5 text-xs text-rose-700">즉시 확인할 카테고리만 요약합니다. 대화 내용과 처리는 아래 상세에서 확인하세요.</p>
              </div>
            </div>
            <span className="w-fit rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white">미처리 {urgentItems.length}건</span>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
            {urgentCategories.map(({ type, count }) => {
              const config = SIGNAL_CONFIG[type];
              return (
                <button
                  key={type}
                  onClick={() => {
                    setDetailFilter(type);
                    window.setTimeout(() => document.getElementById('operations-alert-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                  }}
                  className="flex items-center justify-between rounded-xl border border-rose-100 bg-white px-4 py-3 text-left transition hover:border-rose-300 hover:bg-rose-50"
                >
                  <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${config.badge}`}><span className={`h-2 w-2 rounded-full ${config.dot}`} />{config.label}</span>
                  <span className="text-xl font-black text-rose-700">{count}<span className="ml-0.5 text-xs">건</span></span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
          <ShieldAlert className="h-5 w-5" />
          <div><p className="text-sm font-bold">현재 미처리 긴급 항목이 없습니다.</p><p className="mt-0.5 text-xs text-emerald-700">새로운 운영 신호가 생기면 이 영역이 즉시 긴급 큐로 전환됩니다.</p></div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </div>

      <MonitoringView data={data} loading={loading} filter={detailFilter} onFilterChange={setDetailFilter} onOpenDetail={setSelectedAlert} />

      <SystemHealthPanel data={systemHealth} loading={healthLoading} onRefresh={onRefreshHealth} />

      {selectedAlert && (
        <OperationsAlertDetailPanel
          item={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onOpenPrompts={onOpenPrompts}
          onRefresh={onRefreshOperations}
        />
      )}

    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronRight,
  Radio,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  OperationsAttentionItem,
  OperationsDashboardData,
  OperationsSignalType,
  SystemHealthData,
} from '../../types';
import { formatKoreaDateTime } from '../../utils/dateTime';
import OperationsAlertDetailPanel from './OperationsAlertDetail';
import SystemHealthPanel from './SystemHealthPanel';

interface OperationsReviewProps {
  data: OperationsDashboardData | null;
  loading: boolean;
  systemHealth: SystemHealthData | null;
  healthLoading: boolean;
  initialFilter?: 'all' | OperationsSignalType;
  initialSelectedAlertId?: number | null;
  onInitialAlertHandled?: () => void;
  onRefresh: () => Promise<void>;
  onOpenPrompts: () => void;
}

const SIGNAL_CONFIG: Record<OperationsSignalType, { label: string; badge: string; dot: string }> = {
  handoff: { label: '상담 연결', badge: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  cancel: { label: '취소 요청', badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  refund: { label: '환불 요청', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  safety: { label: '안전 확인', badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  error: { label: '처리 오류', badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-500' },
  quality: { label: '직접 등록', badge: 'bg-cyan-50 text-cyan-800 ring-cyan-200', dot: 'bg-cyan-500' },
  intent_deviation: { label: '의도 이탈', badge: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  context_mismatch: { label: '문맥 불일치', badge: 'bg-orange-50 text-orange-800 ring-orange-200', dot: 'bg-orange-500' },
  user_complaint: { label: '답변 불만', badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  repeated_failure: { label: '반복 실패', badge: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200', dot: 'bg-fuchsia-500' },
  safety_failure: { label: '안전 처리 실패', badge: 'bg-red-50 text-red-800 ring-red-200', dot: 'bg-red-500' },
};

function formatDateTime(value: string) {
  return formatKoreaDateTime(value, { year: undefined });
}

function AttentionRow({ item, onOpenDetail }: { item: OperationsAttentionItem; onOpenDetail: () => void }) {
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
        <button onClick={onOpenDetail} className="inline-flex items-center rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800 hover:bg-cyan-100">
          상세 확인 <ChevronRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function EmptyPanel({ loading }: { loading: boolean }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
      <Activity className={`h-8 w-8 text-slate-300 ${loading ? 'animate-pulse' : ''}`} />
      <p className="mt-3 text-sm font-medium text-slate-600">{loading ? '검토 항목을 불러오는 중입니다.' : '조건에 맞는 개선 검토 항목이 없습니다.'}</p>
    </div>
  );
}

export default function OperationsReview({ data, loading, systemHealth, healthLoading, initialFilter = 'all', initialSelectedAlertId = null, onInitialAlertHandled, onRefresh, onOpenPrompts }: OperationsReviewProps) {
  const [selectedAlert, setSelectedAlert] = useState<OperationsAttentionItem | null>(null);
  const [filter, setFilter] = useState<'all' | OperationsSignalType>(initialFilter);
  const [statusFilter, setStatusFilter] = useState<'active' | 'developer_required' | 'all' | 'resolved'>('active');
  const [query, setQuery] = useState('');
  const detailSectionRef = useRef<HTMLDivElement>(null);
  const items = data?.attention ?? [];
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== 'all' && item.type !== filter) return false;
      if (statusFilter === 'active' && item.status === 'resolved') return false;
      if (statusFilter === 'developer_required' && item.status !== 'developer_required') return false;
      if (statusFilter === 'resolved' && item.status !== 'resolved') return false;
      if (!keyword) return true;
      return `${item.session_id} ${item.question} ${item.reason}`.toLowerCase().includes(keyword);
    });
  }, [filter, items, query, statusFilter]);
  const unresolvedCount = items.filter((item) => item.status !== 'resolved').length;
  const highPriorityCount = items.filter((item) => item.status !== 'resolved' && item.severity === 'high').length;
  const developerRequiredCount = items.filter((item) => item.status === 'developer_required').length;
  const filters: { key: 'all' | OperationsSignalType; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'error', label: '처리 오류' },
    { key: 'intent_deviation', label: '의도 이탈' },
    { key: 'context_mismatch', label: '문맥 불일치' },
    { key: 'user_complaint', label: '답변 불만' },
    { key: 'repeated_failure', label: '반복 실패' },
    { key: 'safety_failure', label: '안전 처리 실패' },
    { key: 'quality', label: '직접 등록' },
  ];

  useEffect(() => {
    if (initialSelectedAlertId === null) return;
    const item = items.find((candidate) => candidate.alert_id === initialSelectedAlertId);
    if (!item) return;
    setSelectedAlert(item);
    setFilter('all');
    setStatusFilter(item.status === 'resolved' ? 'all' : 'active');
    setQuery('');
    onInitialAlertHandled?.();
  }, [initialSelectedAlertId, items, onInitialAlertHandled]);

  useEffect(() => {
    if (!selectedAlert) return;
    const frame = window.requestAnimationFrame(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedAlert]);

  return (
    <div className="space-y-5">
      <SystemHealthPanel data={systemHealth} loading={healthLoading} />

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
            <Radio className="h-5 w-5" />
            {unresolvedCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}
          </span>
          <div>
            <p className="font-semibold text-slate-900">답변 개선 검토</p>
            <p className="text-xs text-slate-500">미처리 {unresolvedCount}건 · 개발자 조치 {developerRequiredCount}건 · 우선 확인 {highPriorityCount}건</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="세션 ID 또는 대화 내용 검색" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
          </label>
          <button onClick={() => void onRefresh()} disabled={loading} title="개선 검토 새로고침" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {filters.map(({ key, label }) => {
              const count = key === 'all' ? items.length : items.filter((item) => item.type === key).length;
              return <button key={key} onClick={() => setFilter(key)} className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${filter === key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label} <span className={filter === key ? 'text-cyan-300' : 'text-slate-400'}>{count}</span></button>;
            })}
          </div>
          <div className="inline-flex w-fit rounded-xl bg-slate-100 p-1">
            {([['active', '미처리'], ['developer_required', `개발자 조치 ${developerRequiredCount}`], ['resolved', '완료'], ['all', '전체 상태']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setStatusFilter(key)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${statusFilter === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="mt-2">
          {filtered.length > 0 ? filtered.map((item) => <AttentionRow key={`${item.id}-${item.type}`} item={item} onOpenDetail={() => setSelectedAlert(item)} />) : <EmptyPanel loading={loading} />}
        </div>
      </section>

      {selectedAlert && (
        <div ref={detailSectionRef} className="scroll-mt-24">
          <OperationsAlertDetailPanel
            item={selectedAlert}
            onClose={() => setSelectedAlert(null)}
            onOpenPrompts={onOpenPrompts}
            onRefresh={onRefresh}
          />
        </div>
      )}
    </div>
  );
}

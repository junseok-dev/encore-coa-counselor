import { ArrowRight, BookOpenCheck, Scale, ShieldAlert } from 'lucide-react';
import { OperationsAnalyticsData } from '../../types';

export type OperationsDashboardView = 'traffic' | 'interest' | 'withdrawal' | 'risk';

interface Props {
  data: OperationsAnalyticsData | null;
  loading: boolean;
  view: OperationsDashboardView;
}

type ChartPoint = {
  label: string;
  visitors: number;
  chats: number;
  courseInquiries: number;
  coursePageViews: number;
  cancels: number;
  refunds: number;
  safety: number;
  failed: number;
};

type MetricKey = Exclude<keyof ChartPoint, 'label'>;

const METRICS: Record<MetricKey, { label: string; description: string; unit: string; color: string }> = {
  visitors: { label: '방문자', description: '새로운 챗봇 대화 세션의 흐름입니다.', unit: '명', color: '#0891b2' },
  chats: { label: '채팅 수', description: '사용자가 실제로 남긴 질문의 흐름입니다.', unit: '건', color: '#2563eb' },
  courseInquiries: { label: '수강 문의', description: '세션 전체 맥락에서 과정 관심이 확인된 대화입니다.', unit: '건', color: '#7c3aed' },
  coursePageViews: { label: '과정 페이지 이동', description: '챗봇 답변의 과정 상세 링크를 실제로 누른 세션입니다.', unit: '건', color: '#0d9488' },
  cancels: { label: '수강 취소 문의', description: '취소 의도가 확인되어 접수된 요청입니다.', unit: '건', color: '#d97706' },
  refunds: { label: '환불 요청', description: '환불·환급 의도가 확인되어 접수된 요청입니다.', unit: '건', color: '#059669' },
  safety: { label: '안전 감지', description: '안전 가드레일이 개입한 대화입니다.', unit: '건', color: '#e11d48' },
  failed: { label: '처리 오류', description: '답변 생성이나 저장 과정에서 실패한 요청입니다.', unit: '건', color: '#475569' },
};

function chartPoints(data: OperationsAnalyticsData): ChartPoint[] {
  const mapPoint = (item: OperationsAnalyticsData['monthly'][number] | OperationsAnalyticsData['daily'][number] | OperationsAnalyticsData['hourly'][number], label: string): ChartPoint => ({
    label,
    visitors: item.visitors,
    chats: item.chats,
    courseInquiries: item.course_inquiries ?? 0,
    coursePageViews: item.course_page_views ?? 0,
    cancels: item.cancels,
    refunds: item.refunds,
    safety: item.safety,
    failed: item.failed,
  });
  if (data.period_mode === 'year') {
    return data.monthly.map((item) => mapPoint(item, data.period_months > 12 ? `${item.month.slice(0, 4)}.${Number(item.month.slice(5))}` : `${Number(item.month.slice(5))}월`));
  }
  if (data.period_mode === 'day') return data.hourly.map((item) => mapPoint(item, item.label));
  return data.daily.map((item) => mapPoint(item, `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`));
}

function LineChart({ points, metric }: { points: ChartPoint[]; metric: MetricKey }) {
  const meta = METRICS[metric];
  const width = Math.max(680, points.length * 44);
  const height = 250;
  const left = 42;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...points.map((point) => point[metric]));
  const coordinates = points.map((point, index) => ({
    ...point,
    x: left + (points.length <= 1 ? plotWidth / 2 : index / (points.length - 1) * plotWidth),
    y: top + plotHeight - point[metric] / maxValue * plotHeight,
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = coordinates.length ? `${left},${top + plotHeight} ${line} ${coordinates[coordinates.length - 1]?.x},${top + plotHeight}` : '';
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const gradientId = `line-${metric}`;

  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-black text-slate-950">{meta.label} 추이</h2><p className="mt-1 text-xs leading-5 text-slate-500">{meta.description}</p></div>
      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">합계 {points.reduce((sum, point) => sum + point[metric], 0).toLocaleString()}{meta.unit}</span>
    </div>
    <div className="mt-4 overflow-x-auto pb-1">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${meta.label} 선그래프`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={meta.color} stopOpacity="0.22" /><stop offset="1" stopColor={meta.color} stopOpacity="0.01" /></linearGradient></defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = top + plotHeight * ratio;
          const value = Math.round(maxValue * (1 - ratio));
          return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 5" /><text x={left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{value}</text></g>;
        })}
        {area && <polygon points={area} fill={`url(#${gradientId})`} />}
        {line && <polyline points={line} fill="none" stroke={meta.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {coordinates.map((point, index) => <g key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.y} r="4" fill="white" stroke={meta.color} strokeWidth="2.5"><title>{point.label} · {meta.label} {point[metric].toLocaleString()}{meta.unit}</title></circle>
          {(index % labelEvery === 0 || index === coordinates.length - 1) && <text x={point.x} y={height - 14} textAnchor="middle" fontSize="10" fill="#64748b">{point.label}</text>}
        </g>)}
      </svg>
    </div>
  </section>;
}

function InterestFunnel({ data }: { data: OperationsAnalyticsData }) {
  const summary = data.period_summary;
  const stages = [
    { label: '채팅 시작', value: summary.visitors, color: 'bg-cyan-600', description: '고유 대화 세션' },
    { label: '수강 문의', value: summary.course_inquiries ?? 0, color: 'bg-violet-600', description: '전체 맥락에서 과정 관심 확인' },
    { label: '과정 페이지 이동', value: summary.course_page_views ?? 0, color: 'bg-teal-600', description: '과정 상세 링크 실제 클릭' },
  ];
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center gap-2"><BookOpenCheck className="h-5 w-5 text-violet-600" /><h2 className="font-black text-slate-950">수강 관심 흐름</h2></div>
    <p className="mt-1 text-xs text-slate-500">상담 연결 버튼이 아니라 실제 과정 질문과 홈페이지 이동 행동을 연결합니다.</p>
    <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
      {stages.map((stage, index) => <div key={stage.label} className="contents">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><span className={`block h-1.5 rounded-full ${stage.color}`} /><p className="mt-3 text-xs font-bold text-slate-500">{stage.label}</p><p className="mt-1 text-3xl font-black text-slate-950">{stage.value.toLocaleString()}<span className="ml-1 text-sm">건</span></p><p className="mt-2 text-[11px] text-slate-400">{stage.description}</p></div>
        {index < stages.length - 1 && <ArrowRight className="mx-auto hidden h-5 w-5 text-slate-300 lg:block" />}
      </div>)}
    </div>
  </section>;
}

function RiskImpact({ data }: { data: OperationsAnalyticsData }) {
  const summary = data.period_summary;
  return <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 shadow-sm">
    <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-600" /><h2 className="font-black text-slate-950">오류 영향 범위</h2></div>
    <p className="mt-1 text-xs leading-5 text-slate-500">금액 손실이 아니라 대화 중단과 수강 문의 기회에 미친 영향을 계산합니다.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-white p-4 ring-1 ring-rose-100"><p className="text-xs font-bold text-slate-500">영향받은 세션</p><p className="mt-1 text-2xl font-black text-slate-950">{(summary.affected_sessions ?? 0).toLocaleString()}건</p><p className="mt-1 text-[11px] text-slate-400">안전 감지 또는 처리 오류가 발생한 대화</p></div>
      <div className="rounded-xl bg-white p-4 ring-1 ring-rose-100"><p className="text-xs font-bold text-slate-500">잠재 문의 손실</p><p className="mt-1 text-2xl font-black text-rose-700">{(summary.potential_inquiry_loss ?? 0).toLocaleString()}건</p><p className="mt-1 text-[11px] text-slate-400">과정 관심 대화가 오류 이후 정상 복구되지 않은 세션</p></div>
    </div>
  </section>;
}

function InterestWithdrawalBalance({ data }: { data: OperationsAnalyticsData }) {
  const visitors = data.period_summary.visitors;
  const interest = data.period_summary.course_inquiries ?? 0;
  const withdrawal = data.period_summary.withdrawal_sessions ?? 0;
  const interestRate = visitors ? Math.round(interest / visitors * 1000) / 10 : 0;
  const withdrawalRate = visitors ? Math.round(withdrawal / visitors * 1000) / 10 : 0;
  const difference = Math.round(Math.abs(interestRate - withdrawalRate) * 10) / 10;
  const state = interestRate > withdrawalRate
    ? { label: '수강 관심 우세', className: 'bg-emerald-100 text-emerald-800', description: `수강 관심 도달률이 취소·환불 문의율보다 ${difference}%p 높습니다.` }
    : interestRate < withdrawalRate
      ? { label: '취소·환불 주의', className: 'bg-rose-100 text-rose-800', description: `취소·환불 문의율이 수강 관심 도달률보다 ${difference}%p 높습니다.` }
      : { label: '두 신호가 동일', className: 'bg-slate-100 text-slate-700', description: '관심과 이탈 신호의 비중이 같습니다.' };
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><Scale className="h-5 w-5" /></span><div><h2 className="font-black text-slate-950">상담 성과 요약</h2><p className="mt-1 text-xs text-slate-500">같은 기간의 방문 세션을 기준으로 수강 관심과 취소·환불 도달률을 비교합니다.</p></div></div><span className={`rounded-full px-3 py-1.5 text-xs font-black ${state.className}`}>{state.label}</span></div>
    <div className="mt-5 space-y-4">
      <div><div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-xs font-black text-violet-700">수강 관심 도달률</p><p className="mt-0.5 text-[11px] text-slate-400">{interest.toLocaleString()}개 관심 세션 / {visitors.toLocaleString()}개 방문 세션</p></div><strong className="text-2xl font-black text-violet-950">{interestRate}%</strong></div><div className="h-3 overflow-hidden rounded-full bg-violet-50"><div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${Math.min(100, interestRate)}%` }} /></div></div>
      <div><div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-xs font-black text-rose-700">취소·환불 문의율</p><p className="mt-0.5 text-[11px] text-slate-400">{withdrawal.toLocaleString()}개 취소·환불 세션 / {visitors.toLocaleString()}개 방문 세션</p></div><strong className="text-2xl font-black text-rose-950">{withdrawalRate}%</strong></div><div className="h-3 overflow-hidden rounded-full bg-rose-50"><div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${Math.min(100, withdrawalRate)}%` }} /></div></div>
    </div>
    <p className="mt-5 text-sm font-bold text-slate-700">{visitors > 0 ? state.description : '비교할 방문 세션이 아직 없습니다.'}</p><p className="mt-1 text-[11px] leading-5 text-slate-400">실제 수강 등록·취소 완료율이 아니라 챗봇 대화에서 감지된 관심 및 취소·환불 문의 세션의 비율입니다.</p>
  </section>;
}

export default function OperationsAnalytics({ data, loading, view }: Props) {
  if (!data) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-24 text-center text-sm text-slate-400">{loading ? '기간 통계를 불러오는 중입니다.' : '표시할 통계가 없습니다.'}</div>;
  const points = chartPoints(data);
  if (view === 'traffic') return <div className="space-y-5"><div className="grid gap-5 xl:grid-cols-2"><LineChart points={points} metric="visitors" /><LineChart points={points} metric="chats" /></div><InterestWithdrawalBalance data={data} /></div>;
  if (view === 'interest') return <div className="space-y-5"><InterestFunnel data={data} /><div className="grid gap-5 xl:grid-cols-2"><LineChart points={points} metric="courseInquiries" /><LineChart points={points} metric="coursePageViews" /></div></div>;
  if (view === 'withdrawal') return <div className="grid gap-5 xl:grid-cols-2"><LineChart points={points} metric="cancels" /><LineChart points={points} metric="refunds" /></div>;
  return <div className="space-y-5"><RiskImpact data={data} /><div className="grid gap-5 xl:grid-cols-2"><LineChart points={points} metric="safety" /><LineChart points={points} metric="failed" /></div></div>;
}

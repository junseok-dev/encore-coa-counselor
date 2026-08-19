import { Bot, Headphones, HelpCircle } from 'lucide-react';
import { OperationsAnalyticsData } from '../../types';

interface OperationsAnalyticsProps {
  data: OperationsAnalyticsData | null;
  loading: boolean;
  view: 'usage' | 'analysis';
  usageMetrics?: OperationsUsageMetricKey[];
}

type ChartPoint = {
  label: string;
  visitors: number;
  chats: number;
  handoffs: number;
  consultationRequests: number;
  cancels: number;
  refunds: number;
  homepage: number;
  safety: number;
  failed: number;
};

export type OperationsUsageMetricKey = Exclude<keyof ChartPoint, 'label'>;

const METRIC_META: Record<OperationsUsageMetricKey, { label: string; description: string; unit: string; color: string }> = {
  visitors: { label: '방문자', description: '새로 시작된 대화 세션의 변화입니다.', unit: '명', color: '#0891b2' },
  chats: { label: '채팅 수', description: '저장된 사용자 질문 수의 변화입니다.', unit: '건', color: '#2563eb' },
  homepage: { label: '홈페이지 요청', description: '공식 홈페이지나 링크를 요청한 대화입니다.', unit: '건', color: '#0d9488' },
  consultationRequests: { label: '상담 요청', description: '챗봇이 상담 연결을 제안한 요청입니다.', unit: '건', color: '#d946ef' },
  handoffs: { label: '상담 연결', description: '실제로 상담 채널로 연결된 요청입니다.', unit: '건', color: '#7c3aed' },
  cancels: { label: '취소 요청', description: '과정이나 신청 취소 요청의 변화입니다.', unit: '건', color: '#d97706' },
  refunds: { label: '환불 요청', description: '환불이나 환급 처리 요청의 변화입니다.', unit: '건', color: '#059669' },
  safety: { label: '안전 감지', description: '안전 가드레일이 감지한 대화입니다.', unit: '건', color: '#e11d48' },
  failed: { label: '처리 오류', description: '답변 생성이나 저장에 실패한 요청입니다.', unit: '건', color: '#475569' },
};

function chartPoints(data: OperationsAnalyticsData): ChartPoint[] {
  if (data.period_mode === 'year') {
    return data.monthly.map((item) => ({
      label: `${Number(item.month.slice(5))}월`, visitors: item.visitors, chats: item.chats,
      handoffs: item.handoffs, consultationRequests: item.consultation_requests,
      cancels: item.cancels, refunds: item.refunds, homepage: item.homepage_requests,
      safety: item.safety, failed: item.failed,
    }));
  }
  if (data.period_mode === 'day') {
    return data.hourly.map((item) => ({
      label: item.label, visitors: item.visitors, chats: item.chats,
      handoffs: item.handoffs, consultationRequests: item.consultation_requests,
      cancels: item.cancels, refunds: item.refunds, homepage: item.homepage_requests,
      safety: item.safety, failed: item.failed,
    }));
  }
  return data.daily.map((item) => ({
    label: `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`,
    visitors: item.visitors, chats: item.chats, handoffs: item.handoffs,
    consultationRequests: item.consultation_requests, cancels: item.cancels,
    refunds: item.refunds, homepage: item.homepage_requests, safety: item.safety, failed: item.failed,
  }));
}

function UsageCharts({ data, metrics }: { data: OperationsAnalyticsData; metrics: OperationsUsageMetricKey[] }) {
  const points = chartPoints(data);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {metrics.map((metric) => {
        const meta = METRIC_META[metric];
        const maxValue = Math.max(1, ...points.map((point) => point[metric]));
        const total = points.reduce((sum, point) => sum + point[metric], 0);
        const minWidth = `${Math.max(360, points.length * 30)}px`;
        return <section key={metric} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-950">{meta.label} 변화</h2><p className="mt-1 text-xs leading-5 text-slate-500">{meta.description}</p></div><span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">합계 {total.toLocaleString()}{meta.unit}</span></div>
          <div className="mt-4 overflow-x-auto pb-2"><div className="flex h-56 items-end gap-1.5 border-b border-slate-200 px-1" style={{ minWidth }}>
            {points.map((point) => <div key={point.label} className="flex h-full min-w-7 flex-1 flex-col items-center justify-end gap-1"><div className="flex h-44 w-full flex-col items-center justify-end" title={`${point.label} · ${meta.label} ${point[metric].toLocaleString()}${meta.unit}`}><span className="mb-1 whitespace-nowrap text-[9px] font-black text-slate-700">{point[metric].toLocaleString()}</span><span className="w-[68%] min-w-2 shrink rounded-t" style={{ height: `${Math.max(point[metric] ? 3 : 0, point[metric] / maxValue * 100)}%`, backgroundColor: meta.color }} /></div><span className="whitespace-nowrap text-[9px] text-slate-500">{point.label}</span></div>)}
          </div></div>
        </section>;
      })}
    </div>
  );
}

function AnalysisPanels({ data }: { data: OperationsAnalyticsData }) {
  const categories = data.question_categories_top5;
  const categoryMax = Math.max(1, ...categories.map((item) => item.count));
  const sources = data.answer_source_summary;
  const compared = sources.faq + sources.llm;
  const faqRatio = compared ? Math.round(sources.faq / compared * 100) : 0;
  const llmRatio = compared ? 100 - faqRatio : 0;
  const handoffMax = Math.max(1, ...data.handoff_categories.map((item) => item.count));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-cyan-600" /><h2 className="font-bold text-slate-950">질문 카테고리 TOP 5</h2></div><p className="mt-1 text-xs text-slate-500">{data.period_label}에 저장된 사용자 질문을 분류했습니다.</p><div className="mt-5 space-y-4">{categories.length ? categories.map((item, index) => <div key={item.key} className="grid grid-cols-[24px_minmax(90px,140px)_1fr_40px] items-center gap-3"><span className="text-xs font-black text-slate-400">{index + 1}</span><span className="truncate text-sm font-semibold text-slate-700">{item.label}</span><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${Math.max(5, item.count / categoryMax * 100)}%` }} /></div><span className="text-right text-sm font-black">{item.count}</span></div>) : <p className="py-12 text-center text-sm text-slate-400">질문 데이터가 없습니다.</p>}</div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Bot className="h-4 w-4 text-violet-600" /><h2 className="font-bold text-slate-950">FAQ · LLM 답변 비중</h2></div><p className="mt-1 text-xs text-slate-500">선택 기간에 사용된 답변 방식을 비교합니다.</p><div className="mt-6 flex h-5 overflow-hidden rounded-full bg-slate-100">{compared > 0 && <><span className="bg-emerald-500" style={{ width: `${faqRatio}%` }} /><span className="bg-violet-500" style={{ width: `${llmRatio}%` }} /></>}</div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">FAQ</p><p className="mt-1 text-xl font-black text-emerald-950">{sources.faq}건 <span className="text-xs">{faqRatio}%</span></p></div><div className="rounded-xl bg-violet-50 p-3"><p className="text-xs font-bold text-violet-700">LLM</p><p className="mt-1 text-xl font-black text-violet-950">{sources.llm}건 <span className="text-xs">{llmRatio}%</span></p></div></div><p className="mt-3 text-[11px] text-slate-400">상담 연결·가드레일·오류 등 기타 처리 {sources.other}건</p></section>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Headphones className="h-4 w-4 text-violet-600" /><h2 className="font-bold text-slate-950">상담 연결·요청 사유</h2></div><p className="mt-1 text-xs text-slate-500">같은 세션의 문맥을 합쳐 실제 연결과 상담 권유 사유를 분류합니다.</p>{data.handoff_categories.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.handoff_categories.map((item) => <div key={item.key}><div className="mb-1.5 flex justify-between text-sm"><span className="font-medium text-slate-600">{item.label}</span><span className="font-black text-slate-950">{item.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(6, item.count / handoffMax * 100)}%` }} /></div></div>)}</div> : <p className="py-12 text-center text-sm text-slate-400">상담 연결 데이터가 없습니다.</p>}</section>
    </div>
  );
}

export default function OperationsAnalytics({ data, loading, view, usageMetrics = ['visitors', 'chats', 'homepage'] }: OperationsAnalyticsProps) {
  if (!data) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-24 text-center text-sm text-slate-400">{loading ? '기간 통계를 불러오는 중입니다.' : '표시할 통계가 없습니다.'}</div>;
  return view === 'usage' ? <UsageCharts data={data} metrics={usageMetrics} /> : <AnalysisPanels data={data} />;
}

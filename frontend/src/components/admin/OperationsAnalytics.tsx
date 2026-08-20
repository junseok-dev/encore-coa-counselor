import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { BarChart3, Bot, ChevronDown } from 'lucide-react';
import { OperationsAnalyticsData, QuestionCategoryMetric } from '../../types';

interface Props {
  data: OperationsAnalyticsData | null;
  loading: boolean;
}

type AnalysisView = 'sources' | 'categories' | 'courses' | 'handoffs';
type ChartPoint = { label: string; visitors: number; chats: number };

const ANALYSIS_OPTIONS: { key: AnalysisView; label: string }[] = [
  { key: 'sources', label: 'FAQ·LLM 응답 비율' },
  { key: 'categories', label: '질문 카테고리 TOP 5' },
  { key: 'courses', label: '과정별 문의' },
  { key: 'handoffs', label: '상담 요청 사유 TOP 5' },
];

function chartPoints(data: OperationsAnalyticsData): ChartPoint[] {
  const mapPoint = (
    item: OperationsAnalyticsData['monthly'][number] | OperationsAnalyticsData['daily'][number] | OperationsAnalyticsData['hourly'][number],
    label: string,
  ): ChartPoint => ({ label, visitors: item.visitors, chats: item.chats });
  if (data.period_mode === 'year') {
    return data.monthly.map((item) => mapPoint(
      item,
      data.period_months > 12 ? `${item.month.slice(0, 4)}.${Number(item.month.slice(5))}` : `${Number(item.month.slice(5))}월`,
    ));
  }
  if (data.period_mode === 'day') return data.hourly.map((item) => mapPoint(item, item.label));
  return data.daily.map((item) => mapPoint(item, `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`));
}

function MetricTrend({
  points, metric, title, description, color, dotClass, unit,
}: {
  points: ChartPoint[];
  metric: 'visitors' | 'chats';
  title: string;
  description: string;
  color: string;
  dotClass: string;
  unit: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = Math.max(620, points.length * 34);
  const height = 250;
  const left = 44;
  const right = 20;
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
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));
  const total = points.reduce((sum, point) => sum + point[metric], 0);
  const hoveredPoint = hoveredIndex === null ? null : coordinates[hoveredIndex];
  const tooltipWidth = 116;
  const tooltipX = hoveredPoint
    ? Math.max(left, Math.min(width - right - tooltipWidth, hoveredPoint.x - tooltipWidth / 2))
    : 0;
  const tooltipY = hoveredPoint
    ? (hoveredPoint.y > top + 52 ? hoveredPoint.y - 48 : hoveredPoint.y + 14)
    : 0;

  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="font-black text-slate-950">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div>
      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><i className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />총 {total.toLocaleString()}{unit}</span>
    </div>
    <div className="mt-4 overflow-x-auto pb-1">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} 선그래프`}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = top + plotHeight * ratio;
          return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 5" /><text x={left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{Math.round(maxValue * (1 - ratio))}</text></g>;
        })}
        <polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {hoveredPoint && <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={top} y2={top + plotHeight} stroke={color} strokeWidth="1" strokeDasharray="3 4" opacity="0.35" />}
        {coordinates.map((point, index) => <g key={`${point.label}-${index}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}>
          <circle cx={point.x} cy={point.y} r="12" fill="transparent" className="cursor-pointer outline-none" aria-label={`${point.label} ${point[metric].toLocaleString()}${unit}`} />
          <circle cx={point.x} cy={point.y} r={hoveredIndex === index ? 5.5 : 4} fill={hoveredIndex === index ? color : 'white'} stroke={color} strokeWidth="2.5" pointerEvents="none" />
          {(index % labelEvery === 0 || index === coordinates.length - 1) && <text x={point.x} y={height - 14} textAnchor="middle" fontSize="10" fill="#64748b">{point.label}</text>}
        </g>)}
        {hoveredPoint && <g transform={`translate(${tooltipX},${tooltipY})`} pointerEvents="none">
          <rect width={tooltipWidth} height="38" rx="8" fill="#0f172a" opacity="0.96" />
          <text x="10" y="15" fontSize="9" fontWeight="600" fill="#94a3b8">{hoveredPoint.label}</text>
          <text x="10" y="30" fontSize="12" fontWeight="800" fill="white">{hoveredPoint[metric].toLocaleString()}{unit}</text>
        </g>}
      </svg>
    </div>
  </section>;
}

function SourceDonut({ data }: { data: OperationsAnalyticsData }) {
  const [sourceTooltip, setSourceTooltip] = useState<{ source: 'faq' | 'llm'; x: number; y: number; pinned: boolean } | null>(null);
  const faq = data.answer_source_summary.faq;
  const llm = data.answer_source_summary.llm;
  const total = faq + llm;
  const faqRate = total ? Math.round(faq / total * 100) : 0;
  const tooltipPosition = (event: ReactMouseEvent<SVGCircleElement>) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    return bounds ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null;
  };
  const showSourceTooltip = (source: 'faq' | 'llm', event: ReactMouseEvent<SVGCircleElement>) => {
    if (sourceTooltip?.pinned) return;
    const position = tooltipPosition(event);
    if (position) setSourceTooltip({ source, ...position, pinned: false });
  };
  const toggleSourceTooltip = (source: 'faq' | 'llm', event: ReactMouseEvent<SVGCircleElement>) => {
    const position = tooltipPosition(event);
    if (!position) return;
    setSourceTooltip((current) => current?.pinned && current.source === source
      ? null
      : { source, ...position, pinned: true });
  };
  const tooltipDetails = sourceTooltip?.source === 'faq'
    ? { label: 'FAQ 직접답변', count: faq, rate: faqRate }
    : sourceTooltip?.source === 'llm'
      ? { label: 'LLM 상담답변', count: llm, rate: 100 - faqRate }
      : null;
  return <div className="grid min-h-72 place-items-center gap-6 py-2 sm:grid-cols-[minmax(220px,0.8fr)_1fr]">
    <div className="relative h-48 w-48">
      <svg viewBox="0 0 120 120" className="h-full w-full" role="img" aria-label="FAQ와 LLM 답변 비율 도넛 그래프">
        <circle cx="60" cy="60" r="46" fill="none" stroke="#e2e8f0" strokeWidth="22" />
        {total > 0 && <circle cx="60" cy="60" r="46" fill="none" stroke={llm > 0 ? '#2563eb' : '#0891b2'} strokeWidth="22" pathLength="100" transform="rotate(-90 60 60)" className="cursor-pointer outline-none focus:outline-none" tabIndex={0} aria-label={`${llm > 0 ? 'LLM 상담답변' : 'FAQ 직접답변'} ${(llm > 0 ? llm : faq).toLocaleString()}건`} onMouseEnter={(event) => showSourceTooltip(llm > 0 ? 'llm' : 'faq', event)} onMouseMove={(event) => showSourceTooltip(llm > 0 ? 'llm' : 'faq', event)} onMouseLeave={() => setSourceTooltip((current) => current?.pinned ? current : null)} onClick={(event) => toggleSourceTooltip(llm > 0 ? 'llm' : 'faq', event)} onFocus={() => setSourceTooltip((current) => current?.pinned ? current : { source: llm > 0 ? 'llm' : 'faq', x: 96, y: 28, pinned: false })} onBlur={() => setSourceTooltip((current) => current?.pinned ? current : null)} />}
        {faq > 0 && llm > 0 && <circle cx="60" cy="60" r="46" fill="none" stroke="#0891b2" strokeWidth="22" pathLength="100" strokeDasharray={`${faqRate} ${100 - faqRate}`} transform="rotate(-90 60 60)" className="cursor-pointer outline-none focus:outline-none" tabIndex={0} aria-label={`FAQ 직접답변 ${faq.toLocaleString()}건`} onMouseEnter={(event) => showSourceTooltip('faq', event)} onMouseMove={(event) => showSourceTooltip('faq', event)} onMouseLeave={() => setSourceTooltip((current) => current?.pinned ? current : null)} onClick={(event) => toggleSourceTooltip('faq', event)} onFocus={() => setSourceTooltip((current) => current?.pinned ? current : { source: 'faq', x: 96, y: 28, pinned: false })} onBlur={() => setSourceTooltip((current) => current?.pinned ? current : null)} />}
      </svg>
      <div className="pointer-events-none absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white text-center"><span className="text-[11px] font-bold text-slate-400">정상 응답</span><strong className="mt-1 text-2xl font-black text-slate-950">{total.toLocaleString()}건</strong><span className="mt-0.5 text-[10px] font-bold text-slate-400">전체</span></div>
      {sourceTooltip && tooltipDetails && <div className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-left text-white shadow-xl" style={{ left: Math.max(64, Math.min(128, sourceTooltip.x)), top: sourceTooltip.y < 72 ? sourceTooltip.y + 14 : sourceTooltip.y - 10, transform: sourceTooltip.y < 72 ? 'translateX(-50%)' : 'translate(-50%, -100%)' }}><p className="text-[10px] font-semibold text-slate-300">{tooltipDetails.label}</p><p className="mt-0.5 text-xs font-black">{tooltipDetails.count.toLocaleString()}건 <span className="ml-1 text-[10px] font-bold text-slate-300">{tooltipDetails.rate}%</span></p></div>}
    </div>
    <div className="w-full max-w-sm space-y-3">
      <div className="flex items-center justify-between rounded-xl bg-cyan-50 px-4 py-3"><span className="flex items-center gap-2 text-sm font-bold text-cyan-900"><i className="h-3 w-3 rounded-full bg-cyan-600" />FAQ 직접답변</span><strong className="text-lg text-cyan-900">{faq.toLocaleString()}건</strong></div>
      <div className="flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3"><span className="flex items-center gap-2 text-sm font-bold text-blue-900"><i className="h-3 w-3 rounded-full bg-blue-600" />LLM 상담답변</span><strong className="text-lg text-blue-900">{llm.toLocaleString()}건</strong></div>
      <p className="text-[11px] leading-5 text-slate-400">문서 기반 RAG 답변은 LLM 상담답변에 포함하며, 상담 연결·안전 차단·처리 오류는 비율에서 제외합니다.</p>
    </div>
  </div>;
}

function HorizontalBars({ items, emptyText }: { items: QuestionCategoryMetric[]; emptyText: string }) {
  const maxValue = Math.max(1, ...items.map((item) => item.count));
  if (!items.length) return <div className="grid min-h-72 place-items-center text-sm text-slate-400">{emptyText}</div>;
  return <div className="flex min-h-72 flex-col justify-center gap-4 py-3">
    {items.map((item, index) => <div key={item.key} className="grid gap-2 sm:grid-cols-[minmax(150px,220px)_1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-black text-slate-500">{index + 1}</span><span className="text-xs font-bold leading-5 text-slate-700">{item.label}</span></div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[linear-gradient(90deg,#0891b2,#2563eb)]" style={{ width: `${Math.max(3, item.count / maxValue * 100)}%` }} /></div>
      <strong className="text-sm tabular-nums text-slate-900">{item.count.toLocaleString()}건</strong>
    </div>)}
  </div>;
}

export default function OperationsAnalytics({ data, loading }: Props) {
  const [analysisView, setAnalysisView] = useState<AnalysisView>('sources');
  const points = useMemo(() => data ? chartPoints(data) : [], [data]);
  if (!data) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-24 text-center text-sm text-slate-400">{loading ? '기간 통계를 불러오는 중입니다.' : '표시할 통계가 없습니다.'}</div>;

  const selected = ANALYSIS_OPTIONS.find((option) => option.key === analysisView)!;
  const barItems = analysisView === 'categories'
    ? (data.question_categories_top5 ?? [])
    : analysisView === 'courses'
      ? (data.course_inquiries_by_course ?? [])
      : (data.handoff_categories ?? []).slice(0, 5);
  const description = analysisView === 'categories'
    ? '일반·기타·미분류 없이 의미가 확인된 상담 주제만 표시합니다.'
    : analysisView === 'courses'
      ? '전체 과정과 과정 비교 문의는 세 과정 모두에 포함되므로 중복 집계될 수 있습니다.'
      : analysisView === 'handoffs'
        ? '사용자가 실제로 사람 상담을 요청한 대화의 맥락을 기준으로 집계합니다.'
        : '정상적으로 생성된 답변이 어떤 방식으로 제공됐는지 확인합니다.';

  return <div className="space-y-5">
    <div className="grid gap-5 xl:grid-cols-2">
      <MetricTrend points={points} metric="visitors" title="방문자 추이" description="선택한 기간에 챗봇을 방문한 사용자 흐름입니다." color="#0891b2" dotClass="bg-cyan-600" unit="명" />
      <MetricTrend points={points} metric="chats" title="채팅 추이" description="선택한 기간에 사용자가 보낸 질문 흐름입니다." color="#2563eb" dotClass="bg-blue-600" unit="건" />
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">{analysisView === 'sources' ? <Bot className="h-5 w-5" /> : <BarChart3 className="h-5 w-5" />}</span><div><h2 className="font-black text-slate-950">상세 분석</h2><p className="mt-0.5 text-[11px] text-slate-500">{description}</p></div></div>
        <label className="relative min-w-56"><span className="sr-only">상세 분석 선택</span><select value={analysisView} onChange={(event) => setAnalysisView(event.target.value as AnalysisView)} className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 pr-9 text-xs font-bold text-slate-700 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100">{ANALYSIS_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" /></label>
      </div>
      {analysisView === 'sources'
        ? <SourceDonut data={data} />
        : <HorizontalBars items={barItems} emptyText={`${selected.label} 데이터가 없습니다.`} />}
    </section>
  </div>;
}

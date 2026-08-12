import {
  BarChart3,
  Bot,
  CalendarDays,
  Clock3,
  Headphones,
  HelpCircle,
  MessageCircle,
  RefreshCw,
  Users,
} from 'lucide-react';
import { OperationsAnalyticsData } from '../../types';

interface OperationsAnalyticsProps {
  data: OperationsAnalyticsData | null;
  loading: boolean;
  selectedYear: string;
  selectedMonth: string;
  onYearChange: (year: string) => void;
  onMonthChange: (month: string) => void;
  onRefresh: () => Promise<void>;
}

function monthLabel(value: string) {
  const [year, month] = value.split('-');
  return `${year.slice(2)}.${month}`;
}

function monthTitle(value?: string) {
  if (!value) return undefined;
  const [year, month] = value.split('-');
  return `${year}년 ${Number(month)}월`;
}

function PeakCard({ label, value, count, unit, icon: Icon, color }: { label: string; value?: string; count?: number; unit: string; icon: typeof Users; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Icon className={`h-4 w-4 ${color}`} />{label}</div>
      <p className="mt-3 text-xl font-black text-slate-950">{value ?? '-'}</p>
      <p className="mt-1 text-xs text-slate-400">{count !== undefined ? `${count.toLocaleString('ko-KR')}${unit}` : '집계 데이터 없음'}</p>
    </div>
  );
}

function MonthlyChart({ data }: { data: OperationsAnalyticsData['monthly'] }) {
  const width = 960;
  const height = 270;
  const left = 48;
  const right = 18;
  const top = 20;
  const bottom = 44;
  const chartHeight = height - top - bottom;
  const chartWidth = width - left - right;
  const maxValue = Math.max(1, ...data.flatMap((item) => [item.visitors, item.chats]));
  const groupWidth = chartWidth / Math.max(1, data.length);
  const barWidth = Math.min(22, groupWidth * 0.3);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[760px]" role="img" aria-label="월별 방문자와 채팅 수 차트">
        {[0, 0.5, 1].map((ratio) => {
          const y = top + chartHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 5" />
              <text x={left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{Math.round(maxValue * ratio)}</text>
            </g>
          );
        })}
        {data.map((item, index) => {
          const center = left + groupWidth * index + groupWidth / 2;
          const visitorHeight = (item.visitors / maxValue) * chartHeight;
          const chatHeight = (item.chats / maxValue) * chartHeight;
          return (
            <g key={item.month}>
              <rect x={center - barWidth - 2} y={top + chartHeight - visitorHeight} width={barWidth} height={visitorHeight} rx="4" fill="#7c3aed"><title>{`${item.month} 방문자 ${item.visitors}명`}</title></rect>
              <rect x={center + 2} y={top + chartHeight - chatHeight} width={barWidth} height={chatHeight} rx="4" fill="#0891b2"><title>{`${item.month} 채팅 ${item.chats}건`}</title></rect>
              <text x={center} y={height - 17} textAnchor="middle" fontSize="10" fill="#64748b">{monthLabel(item.month)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HourlyChart({ data }: { data: OperationsAnalyticsData['hourly'] }) {
  const maxValue = Math.max(1, ...data.flatMap((item) => [item.visitors, item.chats]));
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex h-60 min-w-[920px] items-end gap-2 border-b border-slate-200 px-2">
        {data.map((item) => (
          <div key={item.hour} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-[190px] w-full items-end justify-center gap-0.5">
              <span className="w-[42%] rounded-t bg-violet-500" style={{ height: `${Math.max(item.visitors ? 4 : 0, (item.visitors / maxValue) * 100)}%` }} title={`${item.label} 방문자 ${item.visitors}명`} />
              <span className="w-[42%] rounded-t bg-cyan-600" style={{ height: `${Math.max(item.chats ? 4 : 0, (item.chats / maxValue) * 100)}%` }} title={`${item.label} 채팅 ${item.chats}건`} />
            </div>
            <span className={`text-[9px] ${item.hour % 2 === 0 ? 'text-slate-500' : 'text-slate-300'}`}>{String(item.hour).padStart(2, '0')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OperationsAnalytics({ data, loading, selectedYear, selectedMonth, onYearChange, onMonthChange, onRefresh }: OperationsAnalyticsProps) {
  const highlights = data?.highlights;
  const isAllPeriod = selectedYear === 'all';
  const isSingleMonth = selectedYear !== 'all' && selectedMonth !== 'all';
  const periodLabel = isAllPeriod
    ? (data?.period_label ?? '전체 기간')
    : isSingleMonth ? monthTitle(`${selectedYear}-${selectedMonth}`) : `${selectedYear}년`;
  const hasData = Boolean(data?.monthly.some((item) => item.visitors || item.chats || item.handoffs || item.cancels));
  const categories = data?.question_categories_top5 ?? [];
  const categoryMax = Math.max(1, ...categories.map((item) => item.count));
  const sources = data?.answer_source_summary ?? { faq: 0, llm: 0, other: 0, total: 0 };
  const compared = sources.faq + sources.llm;
  const faqRatio = compared ? Math.round((sources.faq / compared) * 100) : 0;
  const llmRatio = compared ? 100 - faqRatio : 0;
  const handoffMax = Math.max(1, ...(data?.handoff_categories ?? []).map((item) => item.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-[linear-gradient(120deg,#172554,#0e7490)] px-6 py-5 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><BarChart3 className="h-6 w-6 text-cyan-200" /></span>
          <div><p className="text-sm font-semibold text-cyan-100">운영 데이터 분석</p><h1 className="mt-1 text-2xl font-black">방문·채팅 이용 패턴</h1><p className="mt-1 text-xs text-blue-100">{isAllPeriod ? '보유한 전체 기간' : periodLabel}의 방문·채팅과 질문·답변 패턴을 함께 봅니다.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="analytics-year">분석 연도 선택</label>
          <select
            id="analytics-year"
            value={selectedYear}
            onChange={(event) => onYearChange(event.target.value)}
            disabled={loading}
            className="min-w-32 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-bold text-white outline-none hover:bg-white/15 disabled:opacity-50 [&>option]:text-slate-900"
          >
            <option value="all">전체 연도</option>
            {(data?.available_years ?? []).map((year) => <option key={year} value={year}>{year}년</option>)}
          </select>
          <label className="sr-only" htmlFor="analytics-month">분석 월 선택</label>
          <select
            id="analytics-month"
            value={selectedMonth}
            onChange={(event) => onMonthChange(event.target.value)}
            disabled={loading || selectedYear === 'all'}
            className="min-w-28 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-bold text-white outline-none hover:bg-white/15 disabled:opacity-50 [&>option]:text-slate-900"
          >
            <option value="all">전체 월</option>
            {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map((month) => <option key={month} value={month}>{Number(month)}월</option>)}
          </select>
          <button onClick={() => void onRefresh()} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold ring-1 ring-white/20 hover:bg-white/15 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />분석 새로고침</button>
        </div>
      </div>

      {data && !hasData && (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-slate-600">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <div>
            <p className="text-sm font-bold text-slate-800">{periodLabel} 데이터가 없습니다.</p>
            <p className="mt-1 text-xs leading-5">해당 기간에 저장된 방문, 채팅, 질문 또는 상담 연결 기록이 없습니다. 다른 월이나 전체 기간을 선택해 확인할 수 있습니다.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PeakCard label={isSingleMonth ? '선택 월 방문자' : '방문자가 가장 많았던 달'} value={monthTitle(highlights?.busiest_visitor_month?.label)} count={highlights?.busiest_visitor_month?.count} unit="명" icon={CalendarDays} color="text-violet-600" />
        <PeakCard label={isSingleMonth ? '선택 월 채팅' : '채팅이 가장 많았던 달'} value={monthTitle(highlights?.busiest_chat_month?.label)} count={highlights?.busiest_chat_month?.count} unit="건" icon={MessageCircle} color="text-cyan-600" />
        <PeakCard label="방문이 많은 시간" value={highlights?.busiest_visitor_hour?.label} count={highlights?.busiest_visitor_hour?.count} unit="명" icon={Users} color="text-violet-600" />
        <PeakCard label="채팅이 많은 시간" value={highlights?.busiest_chat_hour?.label} count={highlights?.busiest_chat_hour?.count} unit="건" icon={Clock3} color="text-cyan-600" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-slate-950">월별 방문자·채팅 수</h2><p className="mt-1 text-xs text-slate-500">{isAllPeriod ? `보유 데이터 전체 ${data?.period_months ?? 0}개월` : isSingleMonth ? `${periodLabel} 한 달` : `${periodLabel} 1월부터 12월`} 기준입니다.</p></div><div className="flex gap-4 text-xs font-bold text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-violet-600" />방문자</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-cyan-600" />채팅</span></div></div>
        <div className="mt-4">{data && hasData ? <MonthlyChart data={data.monthly} /> : <p className="py-20 text-center text-sm text-slate-400">{loading ? '분석 중입니다.' : `${periodLabel} 방문·채팅 데이터가 없습니다.`}</p>}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-slate-950">시간대별 방문·채팅 패턴</h2><p className="mt-1 text-xs text-slate-500">{periodLabel} 누적 기준이며, 00시부터 23시까지 표시합니다.</p></div><div className="flex gap-4 text-xs font-bold text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-violet-500" />방문자</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-cyan-600" />채팅</span></div></div>
        <div className="mt-4">{data && hasData ? <HourlyChart data={data.hourly} /> : <p className="py-20 text-center text-sm text-slate-400">{loading ? '시간대 데이터를 불러오는 중입니다.' : `${periodLabel} 시간대 데이터가 없습니다.`}</p>}</div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-cyan-600" /><h2 className="font-bold text-slate-950">질문 카테고리 TOP 5</h2></div>
          <p className="mt-1 text-xs text-slate-500">FAQ·LLM 여부와 무관한 전체 질문 주제 순위입니다.</p>
          <div className="mt-5 space-y-4">{categories.length > 0 ? categories.map((item, index) => <div key={item.key} className="grid grid-cols-[24px_120px_1fr_40px] items-center gap-3"><span className="text-xs font-black text-slate-400">{index + 1}</span><span className="truncate text-sm font-semibold text-slate-700">{item.label}</span><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${Math.max(5, (item.count / categoryMax) * 100)}%` }} /></div><span className="text-right text-sm font-black text-slate-900">{item.count}</span></div>) : <p className="py-12 text-center text-sm text-slate-400">{periodLabel} 질문 데이터가 없습니다.</p>}</div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-violet-600" /><h2 className="font-bold text-slate-950">FAQ · LLM 답변 비중</h2></div>
          <p className="mt-1 text-xs text-slate-500">질문 카테고리와 독립된 답변 방식 비교입니다.</p>
          <div className="mt-6 flex h-5 overflow-hidden rounded-full bg-slate-100">{compared > 0 && <><span className="bg-emerald-500" style={{ width: `${faqRatio}%` }} /><span className="bg-violet-500" style={{ width: `${llmRatio}%` }} /></>}</div>
          <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">FAQ</p><p className="mt-1 text-xl font-black text-emerald-950">{sources.faq}건 <span className="text-xs text-emerald-700">{faqRatio}%</span></p></div><div className="rounded-xl bg-violet-50 p-3"><p className="text-xs font-bold text-violet-700">LLM</p><p className="mt-1 text-xl font-black text-violet-950">{sources.llm}건 <span className="text-xs text-violet-700">{llmRatio}%</span></p></div></div>
          <p className="mt-3 text-[11px] text-slate-400">기타 응답 {sources.other}건은 상담 연결·가드레일·오류 응답입니다.</p>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><Headphones className="h-4 w-4 text-violet-600" /><h2 className="font-bold text-slate-950">상담 연결 사유</h2></div>
        {(data?.handoff_categories ?? []).some((item) => item.count > 0) ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{(data?.handoff_categories ?? []).map((item) => <div key={item.key}><div className="mb-1.5 flex justify-between text-sm"><span className="font-medium text-slate-600">{item.label}</span><span className="font-black text-slate-950">{item.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${item.count ? Math.max(6, (item.count / handoffMax) * 100) : 0}%` }} /></div></div>)}</div> : <p className="py-12 text-center text-sm text-slate-400">{periodLabel} 상담 연결 데이터가 없습니다.</p>}
      </section>
    </div>
  );
}

import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  Globe2,
  Headphones,
  HelpCircle,
  MessageCircle,
  RefreshCw,
  CreditCard,
  ShieldAlert,
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

function periodTitle(selectedYear: string, selectedMonth: string, fallback?: string) {
  if (selectedYear === 'all') return fallback ?? '전체 기간';
  if (selectedMonth === 'all') return `${selectedYear}년 전체`;
  return `${selectedYear}년 ${Number(selectedMonth)}월`;
}

function SummaryCard({ label, value, description, tone, icon: Icon }: { label: string; value: string; description: string; tone: string; icon: typeof Users }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Icon className={`h-4 w-4 ${tone}`} />{label}</div>
      <p className="mt-3 text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-400">{description}</p>
    </div>
  );
}

function OperationsSignalChart({ data, singleMonth }: { data: OperationsAnalyticsData; singleMonth: boolean }) {
  const points = singleMonth
    ? data.daily.map((item) => ({ label: `${Number(item.date.slice(-2))}일`, handoffs: item.handoffs, cancels: item.cancels, refunds: item.refunds, homepage: item.homepage_requests, safety: item.safety, failed: item.failed }))
    : data.monthly.map((item) => ({ label: `${item.month.slice(2, 4)}.${item.month.slice(5)}`, handoffs: item.handoffs, cancels: item.cancels, refunds: item.refunds, homepage: item.homepage_requests, safety: item.safety, failed: item.failed }));
  const maxValue = Math.max(1, ...points.map((item) => item.handoffs + item.cancels + item.refunds + item.homepage + item.safety + item.failed));

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex h-64 items-end gap-2 border-b border-slate-200 px-2" style={{ minWidth: `${Math.max(760, points.length * 34)}px` }}>
        {points.map((item) => (
          <div key={item.label} className="flex h-full min-w-6 flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-52 w-[72%] flex-col-reverse overflow-hidden rounded-t bg-slate-100" title={`${item.label} · 상담 ${item.handoffs} · 취소 ${item.cancels} · 환불 ${item.refunds} · 홈페이지 ${item.homepage} · 안전 ${item.safety} · 오류 ${item.failed}`}>
              <span className="w-full bg-violet-500" style={{ height: `${item.handoffs / maxValue * 100}%` }} />
              <span className="w-full bg-amber-500" style={{ height: `${item.cancels / maxValue * 100}%` }} />
              <span className="w-full bg-emerald-500" style={{ height: `${item.refunds / maxValue * 100}%` }} />
              <span className="w-full bg-cyan-500" style={{ height: `${item.homepage / maxValue * 100}%` }} />
              <span className="w-full bg-rose-500" style={{ height: `${item.safety / maxValue * 100}%` }} />
              <span className="w-full bg-slate-600" style={{ height: `${item.failed / maxValue * 100}%` }} />
            </div>
            <span className="whitespace-nowrap text-[9px] text-slate-500">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OperationsAnalytics({ data, loading, selectedYear, selectedMonth, onYearChange, onMonthChange, onRefresh }: OperationsAnalyticsProps) {
  const isSingleMonth = selectedYear !== 'all' && selectedMonth !== 'all';
  const label = periodTitle(selectedYear, selectedMonth, data?.period_label);
  const summary = data?.period_summary ?? { visitors: 0, chats: 0, handoffs: 0, cancels: 0, refunds: 0, homepage_requests: 0, safety: 0, failed: 0 };
  const hasData = summary.visitors > 0 || summary.chats > 0 || summary.handoffs > 0 || summary.cancels > 0 || summary.refunds > 0 || summary.homepage_requests > 0 || summary.safety > 0 || summary.failed > 0;
  const categories = data?.question_categories_top5 ?? [];
  const categoryMax = Math.max(1, ...categories.map((item) => item.count));
  const sources = data?.answer_source_summary ?? { faq: 0, llm: 0, other: 0, total: 0 };
  const compared = sources.faq + sources.llm;
  const faqRatio = compared ? Math.round(sources.faq / compared * 100) : 0;
  const llmRatio = compared ? 100 - faqRatio : 0;
  const handoffs = data?.handoff_categories ?? [];
  const handoffMax = Math.max(1, ...handoffs.map((item) => item.count));

  const insights = [
    summary.safety > 0
      ? `선택 기간에 안전 위험 신호가 ${summary.safety}건 감지됐습니다. 긴급 확인 큐에서 대화 맥락을 확인해 주세요.`
      : '선택 기간에 안전 위험 신호가 없습니다.',
    summary.handoffs > 0
      ? `상담 연결 ${summary.handoffs}건의 세부 이유는 아래 상담 연결 사유에서 확인할 수 있습니다.`
      : '선택 기간에 상담 연결 기록이 없습니다.',
    summary.failed > 0
      ? `처리 오류 ${summary.failed}건이 기록됐습니다. 운영 신호 추이에서 발생 시점을 확인해 주세요.`
      : '선택 기간에 기록된 응답 처리 오류가 없습니다.',
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-[linear-gradient(120deg,#172554,#0e7490)] px-6 py-5 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><BarChart3 className="h-6 w-6 text-cyan-200" /></span><div><p className="text-sm font-semibold text-cyan-100">운영 데이터 분석</p><h1 className="mt-1 text-2xl font-black">운영 KPI와 신호 분석</h1><p className="mt-1 text-xs text-blue-100">{label}에 실제 저장된 데이터만 집계합니다. 전체를 선택하면 보유한 전체 기간이 합산됩니다.</p></div></div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="분석 연도 선택" value={selectedYear} onChange={(event) => onYearChange(event.target.value)} disabled={loading} className="min-w-32 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-bold text-white outline-none disabled:opacity-50 [&>option]:text-slate-900"><option value="all">전체 연도</option>{(data?.available_years ?? []).map((year) => <option key={year} value={year}>{year}년</option>)}</select>
          <select aria-label="분석 월 선택" value={selectedMonth} onChange={(event) => onMonthChange(event.target.value)} disabled={loading || selectedYear === 'all'} className="min-w-28 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-bold text-white outline-none disabled:opacity-50 [&>option]:text-slate-900"><option value="all">전체 월</option>{Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map((month) => <option key={month} value={month}>{Number(month)}월</option>)}</select>
          <button onClick={() => void onRefresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold ring-1 ring-white/20 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />새로고침</button>
        </div>
      </div>

      {data && !hasData && <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4"><CalendarDays className="mt-0.5 h-5 w-5 text-slate-400" /><div><p className="text-sm font-bold text-slate-800">{label} 데이터가 없습니다.</p><p className="mt-1 text-xs leading-5 text-slate-500">선택한 기간에 저장된 방문·질문·상담 기록이 없습니다. 다른 연도·월 또는 전체 기간을 선택해 주세요.</p></div></div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="방문자" value={`${summary.visitors.toLocaleString()}명`} description={`${label} 새 대화 세션`} icon={Users} tone="text-violet-600" />
        <SummaryCard label="채팅" value={`${summary.chats.toLocaleString()}건`} description="실제 저장된 사용자 질문" icon={MessageCircle} tone="text-cyan-600" />
        <SummaryCard label="상담 연결" value={`${summary.handoffs.toLocaleString()}건`} description="상담 연결 및 상담 권유" icon={Headphones} tone="text-violet-600" />
        <SummaryCard label="취소 요청" value={`${summary.cancels.toLocaleString()}건`} description="취소 요청 접수 건수" icon={CalendarDays} tone="text-amber-600" />
        <SummaryCard label="환불 요청" value={`${summary.refunds.toLocaleString()}건`} description="환불·환급 처리 요청" icon={CreditCard} tone="text-emerald-600" />
        <SummaryCard label="홈페이지 요청" value={`${summary.homepage_requests.toLocaleString()}건`} description="공식 사이트·링크 요청" icon={Globe2} tone="text-cyan-600" />
        <SummaryCard label="안전 위험" value={`${summary.safety.toLocaleString()}건`} description="안전 가드레일 감지" icon={ShieldAlert} tone="text-rose-600" />
        <SummaryCard label="처리 오류" value={`${summary.failed.toLocaleString()}건`} description="응답 생성·저장 실패" icon={AlertTriangle} tone="text-slate-600" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-slate-950">{isSingleMonth ? '일별 운영 신호 발생 추이' : '월별 운영 신호 발생 추이'}</h2><p className="mt-1 text-xs text-slate-500">{label}의 주요 요청과 위험·오류 신호가 언제 증가했는지 확인합니다.</p></div><div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-violet-500" />상담 연결</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-amber-500" />취소</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-emerald-500" />환불</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-cyan-500" />홈페이지</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-rose-500" />안전</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-slate-600" />오류</span></div></div><div className="mt-4">{data && hasData ? <OperationsSignalChart data={data} singleMonth={isSingleMonth} /> : <p className="py-20 text-center text-sm text-slate-400">{loading ? '분석 중입니다.' : `${label} 운영 신호 데이터가 없습니다.`}</p>}</div></section>

      {hasData && <section className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5"><h2 className="font-bold text-cyan-950">선택 기간 운영 해석</h2><div className="mt-3 grid gap-3 lg:grid-cols-3">{insights.map((item) => <p key={item} className="rounded-xl bg-white px-4 py-3 text-xs leading-5 text-slate-600 shadow-sm">{item}</p>)}</div></section>}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-cyan-600" /><h2 className="font-bold text-slate-950">질문 카테고리 TOP 5</h2></div><p className="mt-1 text-xs text-slate-500">{label}의 전체 질문을 FAQ·LLM 답변 방식과 무관하게 분류했습니다.</p><div className="mt-5 space-y-4">{categories.length ? categories.map((item, index) => <div key={item.key} className="grid grid-cols-[24px_120px_1fr_40px] items-center gap-3"><span className="text-xs font-black text-slate-400">{index + 1}</span><span className="truncate text-sm font-semibold text-slate-700">{item.label}</span><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${Math.max(5, item.count / categoryMax * 100)}%` }} /></div><span className="text-right text-sm font-black">{item.count}</span></div>) : <p className="py-12 text-center text-sm text-slate-400">질문 데이터가 없습니다.</p>}</div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Bot className="h-4 w-4 text-violet-600" /><h2 className="font-bold text-slate-950">FAQ · LLM 답변 비중</h2></div><p className="mt-1 text-xs text-slate-500">질문 주제와 별도로 어떤 답변 방식을 많이 사용했는지 보여줍니다.</p><div className="mt-6 flex h-5 overflow-hidden rounded-full bg-slate-100">{compared > 0 && <><span className="bg-emerald-500" style={{ width: `${faqRatio}%` }} /><span className="bg-violet-500" style={{ width: `${llmRatio}%` }} /></>}</div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">FAQ</p><p className="mt-1 text-xl font-black text-emerald-950">{sources.faq}건 <span className="text-xs">{faqRatio}%</span></p></div><div className="rounded-xl bg-violet-50 p-3"><p className="text-xs font-bold text-violet-700">LLM</p><p className="mt-1 text-xl font-black text-violet-950">{sources.llm}건 <span className="text-xs">{llmRatio}%</span></p></div></div><p className="mt-3 text-[11px] text-slate-400">상담 연결·가드레일·오류 등 기타 처리 {sources.other}건</p></section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Headphones className="h-4 w-4 text-violet-600" /><h2 className="font-bold text-slate-950">상담 연결 사유</h2></div><p className="mt-1 text-xs text-slate-500">단일 문장만 보지 않고 같은 세션의 질문·답변 문맥을 합쳐 과정, 일정·출결, 신청·등록, 취업, 결제, 기술 문제, 서류·행정 등으로 분류합니다.</p>{handoffs.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{handoffs.map((item) => <div key={item.key}><div className="mb-1.5 flex justify-between text-sm"><span className="font-medium text-slate-600">{item.label}</span><span className="font-black text-slate-950">{item.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(6, item.count / handoffMax * 100)}%` }} /></div></div>)}</div> : <p className="py-12 text-center text-sm text-slate-400">{label} 상담 연결 데이터가 없습니다.</p>}</section>
    </div>
  );
}

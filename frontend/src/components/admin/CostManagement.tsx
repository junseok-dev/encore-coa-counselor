import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CalendarDays, Download, ExternalLink, FileSpreadsheet, Info, RefreshCw, Upload, WalletCards } from 'lucide-react';
import { adminApi } from '../../services/api';
import { CostManagementData, OpenAiCostData } from '../../types';

const SERVICE_COLORS = ['#7dd3fc', '#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#94a3b8', '#f43f5e', '#6366f1', '#8b5cf6', '#14b8a6'];
const TARGET_ACCOUNT_ID = '249173798473';
const TARGET_ACCOUNT_NAME = '엔코아 동작 캠퍼스 5반 30번 학생';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function krw(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}

function usd(value: number | null | undefined) {
  return value === null || value === undefined
    ? '-'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

function fileSize(value: number) {
  if (value < 1024) return `${value.toLocaleString()} B`;
  return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function ServiceDonut({ data }: { data: CostManagementData }) {
  const total = Math.max(1, data.usage_total_krw);
  const radius = 66;
  const circumference = Math.PI * 2 * radius;
  let offset = 0;
  let angleOffset = 0;
  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(230px,1fr)_minmax(145px,0.65fr)] md:items-center">
      <div className="relative mx-auto h-60 w-60 shrink-0">
        <svg viewBox="0 0 180 180" className="h-full w-full">
          <circle cx="90" cy="90" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="28" />
          {data.service_totals.map((service, index) => {
            const ratio = service.amount_krw / total;
            const length = ratio * circumference;
            const node = <circle key={service.service_name} cx="90" cy="90" r={radius} fill="none" stroke={SERVICE_COLORS[index % SERVICE_COLORS.length]} strokeWidth="28" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)" />;
            offset += length;
            return node;
          })}
          {data.service_totals.map((service) => {
            const ratio = service.amount_krw / total;
            const midAngle = -90 + angleOffset + ratio * 180;
            angleOffset += ratio * 360;
            if (ratio < 0.035) return null;
            const radians = (midAngle * Math.PI) / 180;
            const x = 90 + Math.cos(radians) * radius;
            const y = 90 + Math.sin(radians) * radius;
            return <text key={`${service.service_name}-ratio`} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="9" fontWeight="800">{(ratio * 100).toFixed(1)}%</text>;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-sm font-medium text-slate-500">Total</span><strong className="mt-1 text-2xl font-black tracking-tight text-red-500">{data.usage_total_krw.toLocaleString()}</strong><span className="mt-0.5 text-[11px] font-bold text-slate-400">KRW</span></div>
      </div>
      <div className="grid min-w-0 content-center gap-2.5">
        {data.service_totals.map((service, index) => (
          <div key={service.service_name} className="flex min-w-0 items-center gap-2 text-[11px] text-slate-600" title={`${service.service_name}: ${krw(service.amount_krw)}`}><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: SERVICE_COLORS[index % SERVICE_COLORS.length] }} /><span className="min-w-0 break-words font-medium leading-4">{service.service_name}</span></div>
        ))}
        {data.service_totals.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-400">업로드된 서비스 비용이 없습니다.</p>}
      </div>
    </div>
  );
}

function DailyStackedChart({ data }: { data: CostManagementData }) {
  const maxValue = Math.max(1, ...data.daily_totals.map((item) => item.total_krw));
  const scaleMax = Math.ceil(maxValue / 1000) * 1000 || 1000;
  const ticks = Array.from({ length: 6 }, (_, index) => Math.round(scaleMax - (scaleMax / 5) * index));
  const services = data.service_totals.map((item) => item.service_name);
  return (
    <div className="max-w-full overflow-x-auto pb-1">
      <div className="grid min-w-[640px] grid-cols-[44px_minmax(570px,1fr)] gap-3">
        <div className="flex h-56 flex-col justify-between pb-0 text-right text-[10px] tabular-nums text-slate-500">{ticks.map((tick) => <span key={tick}>{tick.toLocaleString()}</span>)}</div>
        <div className="relative h-64">
          <div className="absolute inset-x-0 top-0 h-56 border-b border-slate-300">
            {ticks.map((tick, index) => <span key={tick} className="absolute inset-x-0 border-t border-slate-200" style={{ top: `${(index / (ticks.length - 1)) * 100}%` }} />)}
          </div>
          <div className="absolute inset-0 flex items-end gap-1.5">
            {data.daily_totals.map((day) => {
              const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(new Date(`${day.date}T00:00:00`));
              return (
                <div key={day.date} className="flex h-full min-w-4 flex-1 flex-col items-center justify-end">
                  <div className="flex w-full max-w-7 flex-col-reverse overflow-hidden" style={{ height: `${Math.max(day.total_krw ? 4 : 0, (day.total_krw / scaleMax) * 224)}px` }} title={`${day.date} ${krw(day.total_krw)}`}>
                    {services.map((service, index) => {
                      const value = day.services[service] ?? 0;
                      if (!value || !day.total_krw) return null;
                      return <span key={service} style={{ height: `${(value / day.total_krw) * 100}%`, background: SERVICE_COLORS[index % SERVICE_COLORS.length] }} />;
                    })}
                  </div>
                  <span className="mt-2 h-6 -rotate-45 whitespace-nowrap text-[9px] text-slate-500">{String(day.day).padStart(2, '0')}({weekday.replace('요일', '')})</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CostManagement() {
  const [billingMonth, setBillingMonth] = useState(currentMonth);
  const [data, setData] = useState<CostManagementData | null>(null);
  const [openAiData, setOpenAiData] = useState<OpenAiCostData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [importBillingMonth, setImportBillingMonth] = useState(currentMonth);
  const [importAccountId] = useState(TARGET_ACCOUNT_ID);
  const [importAccountName] = useState(TARGET_ACCOUNT_NAME);
  const [importing, setImporting] = useState(false);
  const skipNextBillingMonthLoad = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAllPeriod = billingMonth === 'all';

  const load = async (month = billingMonth) => {
    setLoading(true);
    const openAiMonth = month === 'all' ? currentMonth() : month;
    const [costResult, openAiResult] = await Promise.allSettled([
      adminApi.getCostManagement(month, TARGET_ACCOUNT_ID),
      adminApi.getOpenAiCosts(openAiMonth),
    ]);
    if (costResult.status === 'fulfilled') {
      setData(costResult.value);
      setMessage('');
    } else {
      setMessage('비용 데이터를 불러오지 못했습니다.');
    }
    setOpenAiData(openAiResult.status === 'fulfilled' ? openAiResult.value : null);
    setLoading(false);
  };

  useEffect(() => {
    if (skipNextBillingMonthLoad.current) {
      skipNextBillingMonthLoad.current = false;
      return;
    }
    void load();
  }, [billingMonth]);

  const importFile = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const result = await adminApi.importBillingCosts(file, importBillingMonth, importAccountId, importAccountName);
      if (billingMonth !== importBillingMonth) {
        skipNextBillingMonthLoad.current = true;
        setBillingMonth(importBillingMonth);
      }
      await load(importBillingMonth);
      const [year, month] = importBillingMonth.split('-');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      const replaced = result.replaced_rows > 0 ? ` 기존 ${result.replaced_rows.toLocaleString()}개 항목을 교체했습니다.` : '';
      setMessage(`${year}년 ${Number(month)}월 비용을 최신 파일의 ${result.imported_rows.toLocaleString()}개 항목으로 반영했습니다.${replaced}`);
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setMessage(detail || '파일을 반영하지 못했습니다. 반영 월과 파일 내용을 확인하세요.');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = async () => {
    const blob = await adminApi.downloadCostTemplate(importBillingMonth);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cost_import_template_${importBillingMonth}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadUploadedFile = async () => {
    if (!data?.uploaded_file) return;
    try {
      const blob = await adminApi.downloadUploadedCostFile(billingMonth, TARGET_ACCOUNT_ID);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = data.uploaded_file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage('업로드 원본 파일을 내려받지 못했습니다.');
    }
  };

  const monthlyMax = Math.max(1, ...(data?.monthly_history ?? []).map((item) => item.amount_krw));
  const history = useMemo(() => [...(data?.monthly_history ?? [])], [data?.monthly_history]);
  const activeDays = data?.daily_totals.filter((item) => item.total_krw > 0).length ?? 0;
  const monthlyAverage = history.length ? Math.round((data?.usage_total_krw ?? 0) / history.length) : 0;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#0f172a,#1d4ed8)] px-6 py-5 text-white shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><WalletCards className="h-6 w-6 text-blue-200" /></span><div><p className="text-sm font-semibold text-blue-100">n·Xavis 실제 원화 기준</p><h1 className="mt-1 text-2xl font-black">비용 관리</h1><p className="mt-1 text-xs text-blue-100">청구 자료를 전체 또는 월별로 확인합니다.</p></div></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/20">{TARGET_ACCOUNT_ID} · {TARGET_ACCOUNT_NAME}</span><button onClick={() => setBillingMonth('all')} className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${isAllPeriod ? 'bg-white text-blue-700 ring-white' : 'bg-white/10 text-white ring-white/20'}`}>전체</button><label className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${isAllPeriod ? 'bg-white/10 ring-white/20' : 'bg-white text-blue-700 ring-white'}`}>월 <input type="month" value={isAllPeriod ? '' : billingMonth} onChange={(event) => event.target.value && setBillingMonth(event.target.value)} className="ml-2 bg-transparent outline-none" /></label><button onClick={() => void load()} className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/20"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Info className="h-5 w-5" /></span><div><h2 className="text-sm font-black text-amber-950">자동 연동이 아닌 월별 수동 업로드 방식입니다.</h2><p className="mt-1 text-xs leading-5 text-amber-800">n·Xavis에서 계정 <strong>{TARGET_ACCOUNT_ID}</strong>의 해당 월 일자별 사용 현황을 내려받은 뒤, 아래의 <strong>n·Xavis 월별 원화 자료 반영</strong>에서 직접 업로드해야 합니다. 업로드하지 않은 월은 비용이 자동으로 추가되지 않습니다.</p></div></div>
        <a href="https://nxavis.com/layout/usageReport/usageDailyReport" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-800">n·Xavis 비용 자료 열기<ExternalLink className="h-4 w-4" /></a>
      </section>

      {message && <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">{message}</div>}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Bot className="h-5 w-5" /></span>
            <div><h2 className="font-black text-slate-950">OpenAI API 비용</h2><p className="mt-0.5 text-xs text-slate-500">{isAllPeriod ? `${currentMonth()} 청구 비용` : `${billingMonth} 청구 비용`} · {openAiData?.project_name ?? 'AIcampus_Chatbot'}</p></div>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${openAiData?.status === 'available' ? 'bg-emerald-100 text-emerald-700' : openAiData?.status === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
            {openAiData?.status === 'available' ? '연동됨' : openAiData?.status === 'error' ? '조회 오류' : '설정 필요'}
          </span>
        </div>
        <div className="grid gap-px bg-slate-200 lg:grid-cols-[0.7fr_1fr_1.3fr]">
          <div className="bg-white p-5"><p className="text-xs font-bold text-slate-500">월 누적 청구 비용</p><p className="mt-2 text-3xl font-black text-emerald-700">{usd(openAiData?.total_usd)}</p><p className="mt-3 text-xs leading-5 text-slate-400">{openAiData?.message ?? 'OpenAI 비용 상태를 확인하는 중입니다.'}</p></div>
          <div className="bg-white p-5"><p className="text-xs font-bold text-slate-500">비용 항목</p><div className="mt-3 space-y-2">{openAiData?.line_items.length ? openAiData.line_items.slice(0, 5).map((item) => <div key={item.line_item} className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-slate-600">{item.line_item}</span><b className="shrink-0 text-slate-900">{usd(item.amount_usd)}</b></div>) : <p className="py-5 text-sm text-slate-400">표시할 비용 항목이 없습니다.</p>}</div></div>
          <div className="bg-white p-5"><p className="text-xs font-bold text-slate-500">일별 비용 추이</p><div className="mt-4 flex h-28 items-end gap-1">{openAiData?.daily.length ? openAiData.daily.map((item) => { const max = Math.max(...openAiData.daily.map((day) => day.amount_usd), 0.000001); return <div key={item.date} className="group flex h-full min-w-1 flex-1 items-end" title={`${item.date} ${usd(item.amount_usd)}`}><span className="block w-full rounded-t bg-emerald-400 transition group-hover:bg-emerald-600" style={{ height: `${Math.max(4, item.amount_usd / max * 100)}%` }} /></div>; }) : <p className="m-auto text-sm text-slate-400">표시할 일별 비용이 없습니다.</p>}</div></div>
        </div>
        {openAiData?.status !== 'available' && (
          <div className="flex flex-col gap-3 border-t border-amber-200 bg-amber-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-xs leading-5 text-amber-900"><strong>playdata@playdata.io 계정으로 로그인</strong>하면 OpenAI Platform에서 API 키를 확인할 수 있습니다. 비용 자동 연동에는 일반 프로젝트 키가 아닌 조직 Admin Key가 필요합니다.</p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900">API 키 확인<ExternalLink className="h-3.5 w-3.5" /></a>
              <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-800 px-3 py-2 text-xs font-black text-white">Admin Key 발급<ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">{isAllPeriod ? '전체 사용 비용' : `${billingMonth} 사용 비용`}</p><p className="mt-2 text-3xl font-black text-slate-950">{krw(data?.usage_total_krw)}</p><p className="mt-3 text-xs text-slate-400">업로드된 원화 비용 자료 기준</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">사용 서비스</p><p className="mt-2 text-3xl font-black text-blue-700">{data?.service_totals.length.toLocaleString() ?? 0}개</p><p className="mt-3 text-xs text-slate-400">{TARGET_ACCOUNT_NAME} · {isAllPeriod ? '전체 기간' : billingMonth}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">{isAllPeriod ? '월평균 사용 비용' : '비용 발생 일수'}</p><p className="mt-2 text-3xl font-black text-emerald-600">{isAllPeriod ? krw(monthlyAverage) : `${activeDays.toLocaleString()}일`}</p><p className="mt-3 text-xs text-slate-400">{isAllPeriod ? `비용 자료가 있는 ${history.length.toLocaleString()}개월 기준` : '0원 초과 사용일 기준'}</p></div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" /><div><h2 className="font-bold text-slate-950">월별 사용 비용</h2><p className="mt-1 text-xs text-slate-500">업로드한 일별 서비스 비용을 월별로 합산했습니다. 막대를 누르면 해당 월 상세로 이동합니다.</p></div></div>{history.length ? <div className="mt-5 overflow-x-auto"><div className="flex h-48 items-end gap-3 border-b border-slate-200 px-2" style={{ minWidth: `${Math.max(600, history.length * 86)}px` }}>{history.map((item) => <button type="button" key={item.billing_month} onClick={() => setBillingMonth(item.billing_month)} className="group flex h-full min-w-16 flex-1 flex-col items-center justify-end gap-1" title={`${item.billing_month} ${krw(item.amount_krw)}`}><span className="whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-600">{item.amount_krw.toLocaleString()}원</span><span className={`w-full max-w-16 rounded-t transition ${billingMonth === item.billing_month ? 'bg-blue-700' : 'bg-blue-400 group-hover:bg-blue-600'}`} style={{ height: `${Math.max(8, (item.amount_krw / monthlyMax) * 120)}px` }} /><span className="text-[10px] font-semibold text-slate-500">{item.billing_month}</span></button>)}</div></div> : <p className="py-14 text-center text-sm text-slate-400">업로드된 월별 비용 데이터가 없습니다.</p>}</section>

      <div className={`grid min-w-0 gap-5 ${isAllPeriod ? '' : 'xl:grid-cols-[minmax(460px,0.85fr)_minmax(0,1.35fr)]'}`}>
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 bg-slate-50 px-5 py-3"><h2 className="font-bold text-slate-950">{isAllPeriod ? '전체 기간' : billingMonth} 서비스별 사용 금액</h2></div><div className="min-w-0 p-5">{data && <ServiceDonut data={data} />}</div></section>
        {!isAllPeriod && <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 bg-slate-50 px-5 py-3"><h2 className="font-bold text-slate-950">일자별 사용금액 그래프</h2></div><div className="min-w-0 p-5">{data && <DailyStackedChart data={data} />}</div></section>}
      </div>

      {!isAllPeriod && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3"><div className="flex items-center gap-3"><h2 className="font-bold text-slate-950">서비스별 사용금액 리스트</h2><span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-black text-white">KRW</span></div><p className="hidden text-xs text-slate-500 sm:block">{billingMonth} · {TARGET_ACCOUNT_NAME}</p></div><div className="overflow-x-auto p-4"><table className="min-w-max border-separate border-spacing-0 text-xs"><thead><tr className="text-slate-700"><th className="sticky left-0 z-10 min-w-44 border-y border-l border-slate-300 bg-slate-100 px-4 py-3 text-left">서비스</th><th className="min-w-24 border-y border-l border-slate-300 bg-slate-100 px-3 py-3 text-right">합계</th>{data?.daily_totals.map((day, index) => <th key={day.date} className={`min-w-20 border-y border-l border-slate-300 bg-slate-100 px-3 py-3 text-right ${index === data.daily_totals.length - 1 ? 'border-r' : ''}`}>{String(day.day).padStart(2, '0')}일</th>)}</tr></thead><tbody><tr className="font-black text-cyan-950"><td className="sticky left-0 border-b border-l border-cyan-200 bg-cyan-200 px-4 py-3">Total</td><td className="border-b border-l border-cyan-200 bg-cyan-200 px-3 py-3 text-right tabular-nums">{data?.usage_total_krw.toLocaleString()}</td>{data?.daily_totals.map((day, index) => <td key={day.date} className={`border-b border-l border-cyan-200 bg-cyan-200 px-3 py-3 text-right tabular-nums ${index === data.daily_totals.length - 1 ? 'border-r' : ''}`}>{day.total_krw.toLocaleString()}</td>)}</tr>{data?.service_daily_rows.map((row, rowIndex) => <tr key={row.service_name} className="hover:bg-blue-50"><td className={`sticky left-0 border-b border-l border-slate-200 px-4 py-3 font-semibold text-slate-700 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}`}>{row.service_name}</td><td className={`border-b border-l border-slate-200 px-3 py-3 text-right font-bold tabular-nums ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}`}>{row.total_krw.toLocaleString()}</td>{data.daily_totals.map((day, index) => <td key={day.date} className={`border-b border-l border-slate-200 px-3 py-3 text-right tabular-nums text-slate-700 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'} ${index === data.daily_totals.length - 1 ? 'border-r' : ''}`}>{(row.daily[String(day.day).padStart(2, '0')] ?? 0).toLocaleString()}</td>)}</tr>)}</tbody></table></div></section>}

      {!isAllPeriod && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-950">{billingMonth} 반영 파일</h2>{data?.uploaded_file ? <p className="mt-1 text-xs text-slate-500">{data.uploaded_file.filename} · {data.uploaded_file.imported_rows.toLocaleString()}개 항목 · {fileSize(data.uploaded_file.size_bytes)} · {dateTime(data.uploaded_file.uploaded_at)} 업로드</p> : <p className="mt-1 text-xs text-slate-400">이 월에 업로드된 원본 파일이 없습니다.</p>}</div></div>{data?.uploaded_file && <button onClick={() => void downloadUploadedFile()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700"><Download className="h-4 w-4" />원본 파일 보기</button>}</div></section>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><div><h2 className="font-bold text-slate-950">n·Xavis 월별 원화 자료 반영</h2><p className="mt-1 text-xs text-slate-500">같은 월을 다시 업로드하면 기존 월 데이터 전체가 최신 파일 기준으로 교체됩니다. 다른 월 날짜가 섞이면 반영되지 않습니다.</p></div></div><div className="mt-5 grid gap-3 lg:grid-cols-[0.8fr_1fr_1fr_1.4fr_auto_auto] lg:items-end"><label className="text-xs font-bold text-slate-600">반영 월<input type="month" value={importBillingMonth} onChange={(event) => setImportBillingMonth(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600">계정 ID<input value={importAccountId} readOnly className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600" /></label><label className="text-xs font-bold text-slate-600">계정명<input value={importAccountName} readOnly className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600" /></label><label className="text-xs font-bold text-slate-600">비용 파일<input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" /></label><button onClick={() => void downloadTemplate()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600"><Download className="h-4 w-4" />양식</button><button onClick={() => void importFile()} disabled={!file || !importBillingMonth || importing} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" />{importing ? '반영 중' : '월별 업로드'}</button></div></section>
    </div>
  );
}

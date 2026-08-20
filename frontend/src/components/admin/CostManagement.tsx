import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CalendarDays, Download, ExternalLink, FileSpreadsheet, Info, RefreshCw, Upload, WalletCards } from 'lucide-react';
import { adminApi } from '../../services/api';
import { CostManagementData, OpenAiManualCostData } from '../../types';
import { DailyStackedChart, MonthlyCostChart, OpenAiMonthlyChart, ServiceDonut } from './CostInteractiveCharts';
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

export default function CostManagement() {
  const [costTab, setCostTab] = useState<'aws' | 'openai'>('aws');
  const [hiddenServices, setHiddenServices] = useState<Set<string>>(new Set());
  const [billingMonth, setBillingMonth] = useState(currentMonth);
  const [data, setData] = useState<CostManagementData | null>(null);
  const [openAiData, setOpenAiData] = useState<OpenAiManualCostData | null>(null);
  const [openAiAmount, setOpenAiAmount] = useState('');
  const [openAiNote, setOpenAiNote] = useState('');
  const [openAiSaving, setOpenAiSaving] = useState(false);
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
    const [costResult, openAiResult] = await Promise.allSettled([
      adminApi.getCostManagement(month, TARGET_ACCOUNT_ID),
      adminApi.getManualOpenAiCosts(month),
    ]);
    if (costResult.status === 'fulfilled') {
      setData(costResult.value);
      setMessage('');
    } else {
      setMessage('비용 데이터를 불러오지 못했습니다.');
    }
    if (openAiResult.status === 'fulfilled') {
      setOpenAiData(openAiResult.value);
      setOpenAiAmount(openAiResult.value.record ? String(openAiResult.value.record.amount_usd) : '');
      setOpenAiNote(openAiResult.value.record?.note ?? '');
    } else {
      setOpenAiData(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (skipNextBillingMonthLoad.current) {
      skipNextBillingMonthLoad.current = false;
      return;
    }
    void load();
  }, [billingMonth]);

  useEffect(() => {
    setHiddenServices(new Set());
  }, [billingMonth, costTab]);

  const toggleServiceVisibility = (serviceName: string) => {
    setHiddenServices((current) => {
      const next = new Set(current);
      if (next.has(serviceName)) next.delete(serviceName);
      else next.add(serviceName);
      return next;
    });
  };

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

  const saveOpenAiCost = async () => {
    if (isAllPeriod) return;
    const amount = Number(openAiAmount);
    if (!openAiAmount.trim() || !Number.isFinite(amount) || amount < 0) {
      setMessage('OpenAI 비용은 0 이상의 숫자로 입력해 주세요.');
      return;
    }
    setOpenAiSaving(true);
    try {
      const result = await adminApi.saveManualOpenAiCost(billingMonth, amount, openAiNote);
      setMessage(result.message);
      await load(billingMonth);
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setMessage(detail || 'OpenAI 실제 비용을 저장하지 못했습니다.');
    } finally {
      setOpenAiSaving(false);
    }
  };

  const deleteOpenAiCost = async () => {
    if (isAllPeriod || !openAiData?.record || !window.confirm(`${billingMonth} OpenAI 비용 입력값을 삭제할까요?`)) return;
    setOpenAiSaving(true);
    try {
      const result = await adminApi.deleteManualOpenAiCost(billingMonth);
      setMessage(result.message);
      await load(billingMonth);
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setMessage(detail || 'OpenAI 실제 비용을 삭제하지 못했습니다.');
    } finally {
      setOpenAiSaving(false);
    }
  };

  const monthlyMax = Math.max(1, ...(data?.monthly_history ?? []).map((item) => item.amount_krw));
  const history = useMemo(() => [...(data?.monthly_history ?? [])], [data?.monthly_history]);
  const activeDays = data?.daily_totals.filter((item) => item.total_krw > 0).length ?? 0;
  const monthlyAverage = history.length ? Math.round((data?.usage_total_krw ?? 0) / history.length) : 0;
  const openAiMonthlyMax = Math.max(0.000001, ...(openAiData?.monthly_history ?? []).map((item) => item.amount_usd));

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#0f172a,#1d4ed8)] px-6 py-5 text-white shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><WalletCards className="h-6 w-6 text-blue-200" /></span><div><p className="text-sm font-semibold text-blue-100">{costTab === 'aws' ? 'n·Xavis 실제 원화 기준' : 'API Key Usage 실제 달러 기준'}</p><h1 className="mt-1 text-2xl font-black">비용 관리</h1><p className="mt-1 text-xs text-blue-100">{costTab === 'aws' ? 'AWS 청구 자료를 전체 또는 월별로 확인합니다.' : 'OpenAI 챗봇 실제 비용을 월별로 기록합니다.'}</p></div></div><div className="flex flex-wrap items-center gap-2">{costTab === 'aws' && <span className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/20">{TARGET_ACCOUNT_ID} · {TARGET_ACCOUNT_NAME}</span>}<button onClick={() => setBillingMonth('all')} className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${isAllPeriod ? 'bg-white text-blue-700 ring-white' : 'bg-white/10 text-white ring-white/20'}`}>전체</button><label className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${isAllPeriod ? 'bg-white/10 ring-white/20' : 'bg-white text-blue-700 ring-white'}`}>월 <input type="month" value={isAllPeriod ? '' : billingMonth} onChange={(event) => event.target.value && setBillingMonth(event.target.value)} className="ml-2 bg-transparent outline-none" /></label><button onClick={() => void load()} className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/20"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"><div className="grid gap-2 sm:grid-cols-2"><button onClick={() => setCostTab('aws')} className={`rounded-xl px-5 py-3 text-left transition ${costTab === 'aws' ? 'bg-blue-700 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}><span className="block text-sm font-black">AWS 비용</span><span className={`mt-0.5 block text-[11px] ${costTab === 'aws' ? 'text-blue-100' : 'text-slate-400'}`}>n·Xavis 엑셀 업로드 및 원화 분석</span></button><button onClick={() => setCostTab('openai')} className={`rounded-xl px-5 py-3 text-left transition ${costTab === 'openai' ? 'bg-emerald-700 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}><span className="block text-sm font-black">OpenAI API 비용</span><span className={`mt-0.5 block text-[11px] ${costTab === 'openai' ? 'text-emerald-100' : 'text-slate-400'}`}>챗봇 API Key Usage 월 실제 비용 입력</span></button></div></section>

      {message && <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">{message}</div>}

      {costTab === 'aws' && <section className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Info className="h-5 w-5" /></span><div><h2 className="text-sm font-black text-amber-950">자동 연동이 아닌 월별 수동 업로드 방식입니다.</h2><p className="mt-1 text-xs leading-5 text-amber-800">n·Xavis에서 계정 <strong>{TARGET_ACCOUNT_ID}</strong>의 해당 월 일자별 사용 현황을 내려받은 뒤, 아래의 <strong>n·Xavis 월별 원화 자료 반영</strong>에서 직접 업로드해야 합니다. 업로드하지 않은 월은 비용이 자동으로 추가되지 않습니다.</p></div></div>
        <a href="https://nxavis.com/layout/usageReport/usageDailyReport" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-800">n·Xavis 비용 자료 열기<ExternalLink className="h-4 w-4" /></a>
      </section>}

      {costTab === 'openai' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Bot className="h-5 w-5" /></span>
            <div><h2 className="font-black text-slate-950">OpenAI API 실제 비용</h2><p className="mt-0.5 text-xs text-slate-500">챗봇 API Key Usage에서 확인한 월 금액을 직접 기록합니다.</p></div>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${isAllPeriod || openAiData?.record ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
            {isAllPeriod ? `${openAiData?.monthly_history.length ?? 0}개월 입력` : openAiData?.record ? '입력 완료' : '입력 필요'}
          </span>
        </div>
        <div className="grid gap-px bg-slate-200 lg:grid-cols-[0.72fr_1.28fr]">
          <div className="bg-white p-5"><p className="text-xs font-bold text-slate-500">{isAllPeriod ? '전체 입력 합계' : `${billingMonth} 실제 비용`}</p><p className="mt-2 text-3xl font-black text-emerald-700">{usd(openAiData?.total_usd)}</p><p className="mt-3 text-xs leading-5 text-slate-400">{openAiData?.record?.updated_at ? `${dateTime(openAiData.record.updated_at)} 수정 · ${openAiData.record.updated_by ?? '관리자'}` : isAllPeriod ? '저장된 월별 OpenAI 비용의 합계입니다.' : '아직 이 월의 실제 비용이 입력되지 않았습니다.'}</p>{openAiData?.record?.note && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{openAiData.record.note}</p>}</div>
          {isAllPeriod ? <div className="bg-white p-5"><p className="text-xs font-bold text-slate-500">월별 입력 내역</p>{openAiData?.monthly_history.length ? <OpenAiMonthlyChart history={openAiData.monthly_history} maxValue={openAiMonthlyMax} onSelectMonth={setBillingMonth} /> : <p className="py-12 text-center text-sm text-slate-400">입력된 OpenAI 월 비용이 없습니다.</p>}</div> : <div className="bg-white p-5"><div className="grid gap-3 sm:grid-cols-[0.7fr_1.3fr_auto] sm:items-end"><label className="text-xs font-bold text-slate-600">실제 비용(USD)<input type="number" min="0" step="0.000001" inputMode="decimal" value={openAiAmount} onChange={(event) => setOpenAiAmount(event.target.value)} placeholder="예: 32.41" className="mt-2 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600">메모<input value={openAiNote} onChange={(event) => setOpenAiNote(event.target.value)} maxLength={1000} placeholder="API Key Usage 확인값" className="mt-2 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><button onClick={() => void saveOpenAiCost()} disabled={openAiSaving || !openAiAmount.trim()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">{openAiSaving ? '저장 중' : openAiData?.record ? '수정 저장' : '비용 저장'}</button></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">OpenAI Usage 확인<ExternalLink className="h-3.5 w-3.5" /></a>{openAiData?.record && <button onClick={() => void deleteOpenAiCost()} disabled={openAiSaving} className="text-xs font-bold text-rose-600 disabled:opacity-40">입력값 삭제</button>}</div></div>}
        </div>
      </section>}

      {costTab === 'aws' && <>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">{isAllPeriod ? '전체 사용 비용' : `${billingMonth} 사용 비용`}</p><p className="mt-2 text-3xl font-black text-slate-950">{krw(data?.usage_total_krw)}</p><p className="mt-3 text-xs text-slate-400">업로드된 원화 비용 자료 기준</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">사용 서비스</p><p className="mt-2 text-3xl font-black text-blue-700">{data?.service_totals.length.toLocaleString() ?? 0}개</p><p className="mt-3 text-xs text-slate-400">{TARGET_ACCOUNT_NAME} · {isAllPeriod ? '전체 기간' : billingMonth}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">{isAllPeriod ? '월평균 사용 비용' : '비용 발생 일수'}</p><p className="mt-2 text-3xl font-black text-emerald-600">{isAllPeriod ? krw(monthlyAverage) : `${activeDays.toLocaleString()}일`}</p><p className="mt-3 text-xs text-slate-400">{isAllPeriod ? `비용 자료가 있는 ${history.length.toLocaleString()}개월 기준` : '0원 초과 사용일 기준'}</p></div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" /><div><h2 className="font-bold text-slate-950">월별 사용 비용</h2><p className="mt-1 text-xs text-slate-500">막대에 마우스를 올리면 금액을 확인하고, 누르면 해당 월 상세로 이동합니다.</p></div></div>{history.length ? <MonthlyCostChart history={history} maxValue={monthlyMax} selectedMonth={billingMonth} onSelectMonth={setBillingMonth} /> : <p className="py-14 text-center text-sm text-slate-400">업로드된 월별 비용 데이터가 없습니다.</p>}</section>

      <div className={`grid min-w-0 gap-5 ${isAllPeriod ? '' : 'xl:grid-cols-[minmax(460px,0.85fr)_minmax(0,1.35fr)]'}`}>
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 bg-slate-50 px-5 py-3"><h2 className="font-bold text-slate-950">{isAllPeriod ? '전체 기간' : billingMonth} 서비스별 사용 금액</h2><p className="mt-1 text-[11px] text-slate-500">차트 항목은 상세 금액을 표시하고, 우측 범례를 누르면 서비스를 표시하거나 숨깁니다.</p></div><div className="min-w-0 p-5">{data && <ServiceDonut data={data} hiddenServices={hiddenServices} onToggleService={toggleServiceVisibility} />}</div></section>
        {!isAllPeriod && <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 bg-slate-50 px-5 py-3"><h2 className="font-bold text-slate-950">일자별 사용금액 그래프</h2><p className="mt-1 text-[11px] text-slate-500">n·Xavis와 같이 막대 상세 툴팁과 스크롤 범례를 함께 제공합니다.</p></div><div className="min-w-0 p-5">{data && <DailyStackedChart data={data} hiddenServices={hiddenServices} onToggleService={toggleServiceVisibility} />}</div></section>}
      </div>

      {!isAllPeriod && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3"><div className="flex items-center gap-3"><h2 className="font-bold text-slate-950">서비스별 사용금액 리스트</h2><span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-black text-white">KRW</span></div><p className="hidden text-xs text-slate-500 sm:block">{billingMonth} · {TARGET_ACCOUNT_NAME}</p></div><div className="overflow-x-auto p-4"><table className="min-w-max border-separate border-spacing-0 text-xs"><thead><tr className="text-slate-700"><th className="sticky left-0 z-10 min-w-44 border-y border-l border-slate-300 bg-slate-100 px-4 py-3 text-left">서비스</th><th className="min-w-24 border-y border-l border-slate-300 bg-slate-100 px-3 py-3 text-right">합계</th>{data?.daily_totals.map((day, index) => <th key={day.date} className={`min-w-20 border-y border-l border-slate-300 bg-slate-100 px-3 py-3 text-right ${index === data.daily_totals.length - 1 ? 'border-r' : ''}`}>{String(day.day).padStart(2, '0')}일</th>)}</tr></thead><tbody><tr className="font-black text-cyan-950"><td className="sticky left-0 border-b border-l border-cyan-200 bg-cyan-200 px-4 py-3">Total</td><td className="border-b border-l border-cyan-200 bg-cyan-200 px-3 py-3 text-right tabular-nums">{data?.usage_total_krw.toLocaleString()}</td>{data?.daily_totals.map((day, index) => <td key={day.date} className={`border-b border-l border-cyan-200 bg-cyan-200 px-3 py-3 text-right tabular-nums ${index === data.daily_totals.length - 1 ? 'border-r' : ''}`}>{day.total_krw.toLocaleString()}</td>)}</tr>{data?.service_daily_rows.map((row, rowIndex) => <tr key={row.service_name} className="hover:bg-blue-50"><td className={`sticky left-0 border-b border-l border-slate-200 px-4 py-3 font-semibold text-slate-700 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}`}>{row.service_name}</td><td className={`border-b border-l border-slate-200 px-3 py-3 text-right font-bold tabular-nums ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}`}>{row.total_krw.toLocaleString()}</td>{data.daily_totals.map((day, index) => <td key={day.date} className={`border-b border-l border-slate-200 px-3 py-3 text-right tabular-nums text-slate-700 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'} ${index === data.daily_totals.length - 1 ? 'border-r' : ''}`}>{(row.daily[String(day.day).padStart(2, '0')] ?? 0).toLocaleString()}</td>)}</tr>)}</tbody></table></div></section>}

      {!isAllPeriod && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-950">{billingMonth} 반영 파일</h2>{data?.uploaded_file ? <p className="mt-1 text-xs text-slate-500">{data.uploaded_file.filename} · {data.uploaded_file.imported_rows.toLocaleString()}개 항목 · {fileSize(data.uploaded_file.size_bytes)} · {dateTime(data.uploaded_file.uploaded_at)} 업로드</p> : <p className="mt-1 text-xs text-slate-400">이 월에 업로드된 원본 파일이 없습니다.</p>}</div></div>{data?.uploaded_file && <button onClick={() => void downloadUploadedFile()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700"><Download className="h-4 w-4" />원본 파일 보기</button>}</div></section>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><div><h2 className="font-bold text-slate-950">n·Xavis 월별 원화 자료 반영</h2><p className="mt-1 text-xs text-slate-500">같은 월을 다시 업로드하면 기존 월 데이터 전체가 최신 파일 기준으로 교체됩니다. 다른 월 날짜가 섞이면 반영되지 않습니다.</p></div></div><div className="mt-5 grid gap-3 lg:grid-cols-[0.8fr_1fr_1fr_1.4fr_auto_auto] lg:items-end"><label className="text-xs font-bold text-slate-600">반영 월<input type="month" value={importBillingMonth} onChange={(event) => setImportBillingMonth(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600">계정 ID<input value={importAccountId} readOnly className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600" /></label><label className="text-xs font-bold text-slate-600">계정명<input value={importAccountName} readOnly className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600" /></label><label className="text-xs font-bold text-slate-600">비용 파일<input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" /></label><button onClick={() => void downloadTemplate()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600"><Download className="h-4 w-4" />양식</button><button onClick={() => void importFile()} disabled={!file || !importBillingMonth || importing} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" />{importing ? '반영 중' : '월별 업로드'}</button></div></section>
      </>}
    </div>
  );
}

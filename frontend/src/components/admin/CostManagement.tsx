import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, FileSpreadsheet, RefreshCw, Upload, WalletCards } from 'lucide-react';
import { adminApi } from '../../services/api';
import { CostManagementData } from '../../types';

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

function ServiceDonut({ data }: { data: CostManagementData }) {
  const total = Math.max(1, data.usage_total_krw);
  const radius = 72;
  const circumference = Math.PI * 2 * radius;
  let offset = 0;
  return (
    <div className="grid gap-5 lg:grid-cols-[230px_1fr] lg:items-center">
      <div className="relative mx-auto h-52 w-52">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle cx="90" cy="90" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="24" />
          {data.service_totals.map((service, index) => {
            const length = (service.amount_krw / total) * circumference;
            const node = <circle key={service.service_name} cx="90" cy="90" r={radius} fill="none" stroke={SERVICE_COLORS[index % SERVICE_COLORS.length]} strokeWidth="24" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />;
            offset += length;
            return node;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xs font-bold text-slate-400">사용 합계</span><strong className="mt-1 text-xl font-black text-slate-950">{krw(data.usage_total_krw)}</strong></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.service_totals.map((service, index) => (
          <div key={service.service_name} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SERVICE_COLORS[index % SERVICE_COLORS.length] }} /><span className="truncate font-semibold text-slate-600">{service.service_name}</span></span><span className="shrink-0 font-black text-slate-900">{krw(service.amount_krw)}</span></div>
        ))}
        {data.service_totals.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-400">업로드된 서비스 비용이 없습니다.</p>}
      </div>
    </div>
  );
}

function DailyStackedChart({ data }: { data: CostManagementData }) {
  const maxValue = Math.max(1, ...data.daily_totals.map((item) => item.total_krw));
  const services = data.service_totals.map((item) => item.service_name);
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex h-64 min-w-[1100px] items-end gap-2 border-b border-slate-200 px-2">
        {data.daily_totals.map((day) => (
          <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${Math.max(day.total_krw ? 5 : 0, (day.total_krw / maxValue) * 205)}px` }} title={`${day.date} ${krw(day.total_krw)}`}>
              {services.map((service, index) => {
                const value = day.services[service] ?? 0;
                if (!value || !day.total_krw) return null;
                return <span key={service} style={{ height: `${(value / day.total_krw) * 100}%`, background: SERVICE_COLORS[index % SERVICE_COLORS.length] }} />;
              })}
            </div>
            <span className="text-[9px] text-slate-500">{String(day.day).padStart(2, '0')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CostManagement() {
  const [billingMonth, setBillingMonth] = useState(currentMonth);
  const [data, setData] = useState<CostManagementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [importBillingMonth, setImportBillingMonth] = useState(currentMonth);
  const [importAccountId] = useState(TARGET_ACCOUNT_ID);
  const [importAccountName] = useState(TARGET_ACCOUNT_NAME);
  const [importing, setImporting] = useState(false);
  const skipNextBillingMonthLoad = useRef(false);

  const load = async (month = billingMonth) => {
    setLoading(true);
    try {
      const result = await adminApi.getCostManagement(month, TARGET_ACCOUNT_ID);
      setData(result);
      setInvoiceAmount(result.actual_invoice_krw === null ? '' : String(result.actual_invoice_krw));
      setMessage('');
    } catch {
      setMessage('비용 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (skipNextBillingMonthLoad.current) {
      skipNextBillingMonthLoad.current = false;
      return;
    }
    void load();
  }, [billingMonth]);

  const saveInvoice = async () => {
    const amount = Number(invoiceAmount);
    if (!Number.isFinite(amount) || amount < 0) return;
    await adminApi.saveBillingCost(billingMonth, Math.round(amount), 'n·Xavis 실제 원화 청구액');
    setMessage('월 실제 원화 청구액을 저장했습니다.');
    await load();
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
      setMessage(`${year}년 ${Number(month)}월 비용 ${result.imported_rows.toLocaleString()}개 항목을 반영했습니다.`);
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

  const monthlyMax = Math.max(1, ...(data?.monthly_history ?? []).map((item) => item.amount_krw));
  const history = useMemo(() => [...(data?.monthly_history ?? [])].reverse(), [data?.monthly_history]);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#0f172a,#1d4ed8)] px-6 py-5 text-white shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><WalletCards className="h-6 w-6 text-blue-200" /></span><div><p className="text-sm font-semibold text-blue-100">n·Xavis 실제 원화 기준</p><h1 className="mt-1 text-2xl font-black">비용 관리</h1><p className="mt-1 text-xs text-blue-100">청구 자료를 서비스·일자별로 확인합니다.</p></div></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/20">{TARGET_ACCOUNT_ID} · {TARGET_ACCOUNT_NAME}</span><label className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/20">월 <input type="month" value={billingMonth} onChange={(event) => setBillingMonth(event.target.value)} className="ml-2 bg-transparent outline-none" /></label><button onClick={() => void load()} className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/20"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div>
      </div>

      {message && <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">{message}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">대상 계정 실제 청구액</p><p className="mt-2 text-3xl font-black text-slate-950">{krw(data?.actual_invoice_krw)}</p><div className="mt-4 flex gap-2"><input value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value.replace(/[^0-9]/g, ''))} placeholder="실제 청구액 입력" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button onClick={() => void saveInvoice()} disabled={!invoiceAmount} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">저장</button></div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">서비스 사용 합계</p><p className="mt-2 text-3xl font-black text-blue-700">{krw(data?.usage_total_krw)}</p><p className="mt-3 text-xs text-slate-400">{TARGET_ACCOUNT_NAME} · 일별 서비스 합산</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">청구액과 사용 합계 차이</p><p className={`mt-2 text-3xl font-black ${(data?.difference_krw ?? 0) === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{krw(data?.difference_krw)}</p><p className="mt-3 text-xs text-slate-400">세금·할인·조정액 확인용입니다.</p></div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" /><h2 className="font-bold text-slate-950">월별 실제 원화 청구액</h2></div><div className="mt-5 flex h-36 items-end gap-3">{history.map((item) => <div key={item.billing_month} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${item.billing_month} ${krw(item.amount_krw)}`}><span className="w-full max-w-20 rounded-t bg-blue-500" style={{ height: `${Math.max(8, (item.amount_krw / monthlyMax) * 105)}px` }} /><span className="text-[10px] text-slate-500">{item.billing_month.slice(2)}</span></div>)}</div></section>

      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-950">서비스별 사용 금액</h2><p className="mt-1 text-xs text-slate-500">선택한 월과 계정의 실제 원화 비중입니다.</p><div className="mt-4">{data && <ServiceDonut data={data} />}</div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-950">일별 서비스 사용 금액</h2><p className="mt-1 text-xs text-slate-500">막대 색상은 서비스별 금액을 나타냅니다.</p><div className="mt-4">{data && <DailyStackedChart data={data} />}</div></section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4"><div><h2 className="font-bold text-slate-950">일별 서비스 사용 금액 리스트</h2><p className="mt-1 text-xs text-slate-500">서비스 행과 일자 열로 원화 금액을 비교합니다.</p></div></div><div className="overflow-x-auto"><table className="min-w-max text-xs"><thead><tr className="bg-slate-100 text-slate-600"><th className="sticky left-0 z-10 min-w-40 border-r border-slate-200 bg-slate-100 px-4 py-3 text-left">서비스</th><th className="min-w-24 px-3 py-3 text-right">합계</th>{data?.daily_totals.map((day) => <th key={day.date} className="min-w-20 px-3 py-3 text-right">{String(day.day).padStart(2, '0')}일</th>)}</tr></thead><tbody><tr className="bg-cyan-50 font-black text-cyan-900"><td className="sticky left-0 border-r border-cyan-100 bg-cyan-50 px-4 py-3">Total</td><td className="px-3 py-3 text-right">{data?.usage_total_krw.toLocaleString()}</td>{data?.daily_totals.map((day) => <td key={day.date} className="px-3 py-3 text-right">{day.total_krw.toLocaleString()}</td>)}</tr>{data?.service_daily_rows.map((row) => <tr key={row.service_name} className="border-t border-slate-100 hover:bg-slate-50"><td className="sticky left-0 border-r border-slate-100 bg-white px-4 py-3 font-semibold text-slate-700">{row.service_name}</td><td className="px-3 py-3 text-right font-bold">{row.total_krw.toLocaleString()}</td>{data.daily_totals.map((day) => <td key={day.date} className="px-3 py-3 text-right text-slate-600">{(row.daily[String(day.day).padStart(2, '0')] ?? 0).toLocaleString()}</td>)}</tr>)}</tbody></table></div></section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><div><h2 className="font-bold text-slate-950">n·Xavis 월별 원화 자료 반영</h2><p className="mt-1 text-xs text-slate-500">반영 월을 선택한 뒤 해당 월의 XLSX·CSV를 업로드하세요. 다른 월 날짜가 섞이면 반영되지 않습니다.</p></div></div><div className="mt-5 grid gap-3 lg:grid-cols-[0.8fr_1fr_1fr_1.4fr_auto_auto] lg:items-end"><label className="text-xs font-bold text-slate-600">반영 월<input type="month" value={importBillingMonth} onChange={(event) => setImportBillingMonth(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600">계정 ID<input value={importAccountId} readOnly className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600" /></label><label className="text-xs font-bold text-slate-600">계정명<input value={importAccountName} readOnly className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600" /></label><label className="text-xs font-bold text-slate-600">비용 파일<input type="file" accept=".xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" /></label><button onClick={() => void downloadTemplate()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600"><Download className="h-4 w-4" />양식</button><button onClick={() => void importFile()} disabled={!file || !importBillingMonth || importing} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" />{importing ? '반영 중' : '월별 업로드'}</button></div></section>
    </div>
  );
}

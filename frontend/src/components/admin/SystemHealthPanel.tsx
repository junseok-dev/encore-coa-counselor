import { Activity, AlertTriangle, CheckCircle2, Database, Save, Server, XCircle } from 'lucide-react';
import { SystemHealthData, SystemHealthStatus } from '../../types';

interface Props {
  data: SystemHealthData | null;
  loading: boolean;
}

const STATUS_STYLE: Record<SystemHealthStatus, { label: string; className: string }> = {
  healthy: { label: '정상', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  degraded: { label: '주의', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  critical: { label: '장애', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  unknown: { label: '확인 불가', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  not_configured: { label: '설정 필요', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const HEALTH_ICONS = { application: Server, database_read: Database, database_write: Save, ec2: Activity };

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SystemHealthPanel({ data, loading }: Props) {
  const isCritical = data?.overall_status === 'critical';
  const isDegraded = data?.overall_status === 'degraded';
  return <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${isCritical ? 'border-rose-300' : isDegraded ? 'border-amber-300' : 'border-slate-200'}`}>
    <div className={`flex items-center gap-3 px-5 py-4 ${isCritical ? 'bg-rose-50' : isDegraded ? 'bg-amber-50' : 'bg-slate-50/70'}`}>
      {isCritical ? <XCircle className="h-5 w-5 text-rose-600" /> : isDegraded ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
      <div><h2 className="font-bold text-slate-950">시스템 상태</h2><p className="mt-0.5 text-xs text-slate-500">{data?.generated_at ? `최근 점검 ${formatDateTime(data.generated_at)}` : '개선 항목을 보기 전에 시스템 상태를 확인합니다.'}</p></div>
    </div>
    <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
      {(data?.checks ?? []).map((check) => { const Icon = HEALTH_ICONS[check.key] ?? Server; const status = STATUS_STYLE[check.status]; return <div key={check.key} className="bg-white p-4"><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-bold text-slate-800"><Icon className="h-4 w-4 text-slate-400" />{check.label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${status.className}`}>{status.label}</span></div><p className="mt-2 min-h-8 text-xs leading-4 text-slate-500">{check.message}</p><p className="mt-2 text-[10px] text-slate-400">{check.latency_ms !== null ? `${check.latency_ms}ms` : '응답 시간 없음'}</p></div>; })}
      {!data && <div className="col-span-full bg-white p-6 text-center text-sm text-slate-500">{loading ? '시스템 상태를 점검하는 중입니다.' : '시스템 상태를 확인하지 못했습니다.'}</div>}
    </div>
  </section>;
}

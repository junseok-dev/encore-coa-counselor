import { MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CostDailyTotal, CostManagementData, CostMonthlyTotal } from '../../types';

export const SERVICE_COLORS = ['#7dd3fc', '#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#94a3b8', '#f43f5e', '#6366f1', '#8b5cf6', '#14b8a6'];

interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

interface TooltipPoint {
  key: string;
  title: string;
  rows: TooltipRow[];
  note?: string;
  left: number;
  top: number;
}

interface ServicePoint extends TooltipPoint {
  serviceName: string;
}

function krw(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}

function usd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function positionFromEvent(event: ReactMouseEvent<HTMLElement>, container: HTMLElement | null) {
  if (!container) return { left: 50, top: 50 };
  const bounds = container.getBoundingClientRect();
  return {
    left: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100,
    top: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100,
  };
}

function ChartTooltip({ point, pinned = false }: { point: TooltipPoint | null; pinned?: boolean }) {
  if (!point) return null;
  const left = Math.min(82, Math.max(18, point.left));
  const top = Math.min(88, Math.max(10, point.top));
  return (
    <div
      className="pointer-events-none absolute z-30 min-w-[178px] max-w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-xl"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: top < 30 ? 'translate(-50%, 12px)' : 'translate(-50%, calc(-100% - 12px))',
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-3 py-2">
        <strong className="text-xs text-slate-800">{point.title}</strong>
        {pinned && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-black text-blue-700">선택됨</span>}
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {point.rows.map((row) => (
          <div key={`${row.label}-${row.value}`} className="flex items-center gap-2 text-xs">
            {row.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: row.color }} />}
            <span className="min-w-0 flex-1 truncate text-slate-600">{row.label}</span>
            <strong className="whitespace-nowrap tabular-nums text-slate-950">{row.value}</strong>
          </div>
        ))}
        {point.note && <p className="border-t border-slate-100 pt-2 text-[10px] leading-4 text-slate-500">{point.note}</p>}
      </div>
    </div>
  );
}

interface ServiceSelectionProps {
  selectedService: string | null;
  onSelectService: (serviceName: string | null) => void;
}

export function ServiceDonut({ data, selectedService, onSelectService }: { data: CostManagementData } & ServiceSelectionProps) {
  const [hovered, setHovered] = useState<ServicePoint | null>(null);
  const total = Math.max(1, data.usage_total_krw);
  const radius = 66;
  const circumference = Math.PI * 2 * radius;
  const points = useMemo(() => {
    let offset = 0;
    let angleOffset = 0;
    return data.service_totals.map((service, index) => {
      const ratio = service.amount_krw / total;
      const length = ratio * circumference;
      const midAngle = -90 + angleOffset + ratio * 180;
      const radians = (midAngle * Math.PI) / 180;
      const point: ServicePoint & { ratio: number; length: number; offset: number; x: number; y: number; color: string } = {
        key: service.service_name,
        serviceName: service.service_name,
        title: `${data.is_all_period ? '전체 기간' : data.billing_month} 서비스 비용`,
        rows: [{ label: service.service_name, value: krw(service.amount_krw), color: SERVICE_COLORS[index % SERVICE_COLORS.length] }],
        note: `전체 비용의 ${(ratio * 100).toFixed(1)}%`,
        left: 50 + Math.cos(radians) * 38,
        top: 50 + Math.sin(radians) * 38,
        ratio,
        length,
        offset,
        x: 90 + Math.cos(radians) * radius,
        y: 90 + Math.sin(radians) * radius,
        color: SERVICE_COLORS[index % SERVICE_COLORS.length],
      };
      offset += length;
      angleOffset += ratio * 360;
      return point;
    });
  }, [circumference, data.billing_month, data.is_all_period, data.service_totals, total]);
  const selectedPoint = points.find((point) => point.serviceName === selectedService) ?? null;
  const activePoint = hovered ?? selectedPoint;

  const toggleService = (point: ServicePoint) => {
    onSelectService(selectedService === point.serviceName ? null : point.serviceName);
  };

  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(230px,1fr)_minmax(145px,0.65fr)] md:items-center">
      <div className="relative mx-auto h-60 w-60 shrink-0" onMouseLeave={() => setHovered(null)}>
        <svg viewBox="0 0 180 180" className="h-full w-full">
          <circle cx="90" cy="90" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="28" />
          {points.map((point) => {
            const active = !selectedService || selectedService === point.serviceName;
            return (
              <circle
                key={point.key}
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke={point.color}
                strokeWidth={selectedService === point.serviceName || hovered?.serviceName === point.serviceName ? 32 : 28}
                strokeDasharray={`${point.length} ${circumference - point.length}`}
                strokeDashoffset={-point.offset}
                transform="rotate(-90 90 90)"
                opacity={active ? 1 : 0.25}
                className="cursor-pointer transition-all outline-none"
                role="button"
                tabIndex={0}
                aria-label={`${point.serviceName} ${point.rows[0].value}`}
                onMouseEnter={() => setHovered(point)}
                onFocus={() => setHovered(point)}
                onBlur={() => setHovered(null)}
                onClick={() => toggleService(point)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggleService(point); }}
              />
            );
          })}
          {points.map((point) => point.ratio >= 0.035 ? (
            <text key={`${point.key}-ratio`} x={point.x} y={point.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="9" fontWeight="800" className="pointer-events-none">{(point.ratio * 100).toFixed(1)}%</text>
          ) : null)}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-sm font-medium text-slate-500">Total</span><strong className="mt-1 text-2xl font-black tracking-tight text-red-500">{data.usage_total_krw.toLocaleString()}</strong><span className="mt-0.5 text-[11px] font-bold text-slate-400">KRW</span></div>
        <ChartTooltip point={activePoint} pinned={!hovered && Boolean(selectedPoint)} />
      </div>
      <div className="grid min-w-0 content-center gap-1.5">
        {points.map((point) => (
          <button
            type="button"
            key={point.key}
            onMouseEnter={() => setHovered({ ...point, left: 50, top: 50 })}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered({ ...point, left: 50, top: 50 })}
            onBlur={() => setHovered(null)}
            onClick={() => toggleService(point)}
            className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition ${selectedService === point.serviceName ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-200' : 'text-slate-600 hover:bg-slate-50'} ${selectedService && selectedService !== point.serviceName ? 'opacity-40' : ''}`}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: point.color }} />
            <span className="min-w-0 flex-1 break-words font-medium leading-4">{point.serviceName}</span>
            <span className="shrink-0 tabular-nums text-slate-400">{point.rows[0].value}</span>
          </button>
        ))}
        {points.length === 0 && <p className="py-10 text-center text-sm text-slate-400">업로드된 서비스 비용이 없습니다.</p>}
      </div>
    </div>
  );
}

export function DailyStackedChart({ data, selectedService, onSelectService }: { data: CostManagementData } & ServiceSelectionProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<ServicePoint | null>(null);
  const [pinned, setPinned] = useState<ServicePoint | null>(null);
  const maxValue = Math.max(1, ...data.daily_totals.map((item) => item.total_krw));
  const scaleMax = Math.ceil(maxValue / 1000) * 1000 || 1000;
  const ticks = Array.from({ length: 6 }, (_, index) => Math.round(scaleMax - (scaleMax / 5) * index));
  const services = data.service_totals.map((item) => item.service_name);

  useEffect(() => {
    setPinned((current) => current && current.serviceName === selectedService ? current : null);
  }, [selectedService]);

  const pointFor = (day: CostDailyTotal, service: string, index: number, position: { left: number; top: number }): ServicePoint => {
    const value = day.services[service] ?? 0;
    const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(new Date(`${day.date}T00:00:00`));
    return {
      key: `${day.date}-${service}`,
      serviceName: service,
      title: `${day.day}일 (${weekday.replace('요일', '')})`,
      rows: [{ label: service, value: krw(value), color: SERVICE_COLORS[index % SERVICE_COLORS.length] }],
      note: `당일 총 ${krw(day.total_krw)} · ${(value / Math.max(1, day.total_krw) * 100).toFixed(1)}%`,
      ...position,
    };
  };

  const togglePoint = (point: ServicePoint) => {
    const next = pinned?.key === point.key ? null : point;
    setPinned(next);
    onSelectService(next?.serviceName ?? null);
  };

  return (
    <div className="max-w-full overflow-x-auto pb-1">
      <div className="grid min-w-[640px] grid-cols-[44px_minmax(570px,1fr)] gap-3">
        <div className="flex h-56 flex-col justify-between pb-0 text-right text-[10px] tabular-nums text-slate-500">{ticks.map((tick) => <span key={tick}>{tick.toLocaleString()}</span>)}</div>
        <div ref={chartRef} className="relative h-64" onMouseLeave={() => setHovered(null)}>
          <div className="absolute inset-x-0 top-0 h-56 border-b border-slate-300">
            {ticks.map((tick, index) => <span key={tick} className="absolute inset-x-0 border-t border-slate-200" style={{ top: `${(index / (ticks.length - 1)) * 100}%` }} />)}
          </div>
          <div className="absolute inset-0 flex items-end gap-1.5">
            {data.daily_totals.map((day, dayIndex) => {
              const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(new Date(`${day.date}T00:00:00`));
              return (
                <div key={day.date} className="flex h-full min-w-4 flex-1 flex-col items-center justify-end">
                  <div className="flex w-full max-w-7 flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${Math.max(day.total_krw ? 4 : 0, (day.total_krw / scaleMax) * 224)}px` }}>
                    {services.map((service, index) => {
                      const value = day.services[service] ?? 0;
                      if (!value || !day.total_krw) return null;
                      const dimmed = selectedService && selectedService !== service;
                      return (
                        <button
                          type="button"
                          key={service}
                          aria-label={`${day.day}일 ${service} ${krw(value)}`}
                          className="w-full shrink-0 cursor-pointer border-0 p-0 transition-opacity focus:relative focus:z-10 focus:outline-none focus:ring-2 focus:ring-white"
                          style={{ minHeight: '2px', height: `${(value / day.total_krw) * 100}%`, background: SERVICE_COLORS[index % SERVICE_COLORS.length], opacity: dimmed ? 0.22 : 1 }}
                          onMouseEnter={(event) => setHovered(pointFor(day, service, index, positionFromEvent(event, chartRef.current)))}
                          onMouseMove={(event) => setHovered(pointFor(day, service, index, positionFromEvent(event, chartRef.current)))}
                          onFocus={() => setHovered(pointFor(day, service, index, { left: ((dayIndex + 0.5) / data.daily_totals.length) * 100, top: 42 }))}
                          onBlur={() => setHovered(null)}
                          onClick={(event) => togglePoint(pointFor(day, service, index, positionFromEvent(event, chartRef.current)))}
                        />
                      );
                    })}
                  </div>
                  <span className="mt-2 h-6 -rotate-45 whitespace-nowrap text-[9px] text-slate-500">{String(day.day).padStart(2, '0')}({weekday.replace('요일', '')})</span>
                </div>
              );
            })}
          </div>
          <ChartTooltip point={hovered ?? pinned} pinned={!hovered && Boolean(pinned)} />
        </div>
      </div>
      <div className="mt-3 flex min-w-[640px] flex-wrap gap-1.5 pl-14">
        {services.map((service, index) => (
          <button key={service} type="button" onClick={() => onSelectService(selectedService === service ? null : service)} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${selectedService === service ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-200' : 'bg-slate-50 text-slate-500'} ${selectedService && selectedService !== service ? 'opacity-40' : ''}`}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERVICE_COLORS[index % SERVICE_COLORS.length] }} />{service}
          </button>
        ))}
      </div>
    </div>
  );
}

interface MonthlyCostChartProps {
  history: CostMonthlyTotal[];
  maxValue: number;
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}

export function MonthlyCostChart({ history, maxValue, selectedMonth, onSelectMonth }: MonthlyCostChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<TooltipPoint | null>(null);
  const [pinnedMonth, setPinnedMonth] = useState<string | null>(null);

  useEffect(() => {
    setPinnedMonth((current) => current === selectedMonth ? current : null);
  }, [selectedMonth]);
  const pointFor = (item: CostMonthlyTotal, position: { left: number; top: number }): TooltipPoint => ({
    key: item.billing_month,
    title: item.billing_month,
    rows: [{ label: '월 사용 비용', value: krw(item.amount_krw), color: '#3b82f6' }],
    note: '막대를 누르면 해당 월 상세로 이동합니다.',
    ...position,
  });
  const pinnedItem = history.find((item) => item.billing_month === pinnedMonth);
  const pinnedPoint = pinnedItem ? {
    key: pinnedItem.billing_month,
    title: pinnedItem.billing_month,
    rows: [{ label: '월 사용 비용', value: krw(pinnedItem.amount_krw), color: '#3b82f6' }],
    note: '선택한 월의 상세 비용을 표시하고 있습니다.',
    left: ((history.indexOf(pinnedItem) + 0.5) / history.length) * 100,
    top: 42,
  } : null;
  return (
    <div className="mt-5 overflow-x-auto">
      <div ref={chartRef} className="relative flex h-48 items-end gap-3 border-b border-slate-200 px-2" style={{ minWidth: `${Math.max(600, history.length * 86)}px` }} onMouseLeave={() => setHovered(null)}>
        {history.map((item, index) => (
          <button
            type="button"
            key={item.billing_month}
            onMouseEnter={(event) => setHovered(pointFor(item, positionFromEvent(event, chartRef.current)))}
            onMouseMove={(event) => setHovered(pointFor(item, positionFromEvent(event, chartRef.current)))}
            onFocus={() => setHovered(pointFor(item, { left: ((index + 0.5) / history.length) * 100, top: 42 }))}
            onBlur={() => setHovered(null)}
            onClick={() => { setPinnedMonth(item.billing_month); onSelectMonth(item.billing_month); }}
            className="group flex h-full min-w-16 flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-600">{item.amount_krw.toLocaleString()}원</span>
            <span className={`w-full max-w-16 rounded-t transition ${selectedMonth === item.billing_month ? 'bg-blue-700' : 'bg-blue-400 group-hover:bg-blue-600'}`} style={{ height: `${Math.max(8, (item.amount_krw / maxValue) * 120)}px` }} />
            <span className="text-[10px] font-semibold text-slate-500">{item.billing_month}</span>
          </button>
        ))}
        <ChartTooltip point={hovered ?? pinnedPoint} pinned={!hovered && Boolean(pinnedPoint)} />
      </div>
    </div>
  );
}

interface OpenAiMonthlyChartProps {
  history: Array<{ billing_month: string; amount_usd: number }>;
  maxValue: number;
  onSelectMonth: (month: string) => void;
}

export function OpenAiMonthlyChart({ history, maxValue, onSelectMonth }: OpenAiMonthlyChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<TooltipPoint | null>(null);
  const [pinned, setPinned] = useState<TooltipPoint | null>(null);
  const pointFor = (item: { billing_month: string; amount_usd: number }, position: { left: number; top: number }): TooltipPoint => ({
    key: item.billing_month,
    title: item.billing_month,
    rows: [{ label: 'OpenAI 실제 비용', value: usd(item.amount_usd), color: '#10b981' }],
    note: '선택한 막대를 한 번 더 누르면 해당 월 입력 내역으로 이동합니다.',
    ...position,
  });
  return (
    <div className="mt-4 overflow-x-auto">
      <div ref={chartRef} className="relative flex h-36 items-end gap-2 border-b border-slate-200 pb-1" style={{ minWidth: `${Math.max(420, history.length * 70)}px` }} onMouseLeave={() => setHovered(null)}>
        {history.map((item, index) => (
          <button
            key={item.billing_month}
            type="button"
            onMouseEnter={(event) => setHovered(pointFor(item, positionFromEvent(event, chartRef.current)))}
            onMouseMove={(event) => setHovered(pointFor(item, positionFromEvent(event, chartRef.current)))}
            onFocus={() => setHovered(pointFor(item, { left: ((index + 0.5) / history.length) * 100, top: 42 }))}
            onBlur={() => setHovered(null)}
            onClick={(event) => {
              const point = pointFor(item, positionFromEvent(event, chartRef.current));
              if (pinned?.key === point.key) onSelectMonth(item.billing_month);
              else setPinned(point);
            }}
            className={`flex h-full min-w-14 flex-1 flex-col items-center justify-end gap-1 transition ${pinned?.key && pinned.key !== item.billing_month ? 'opacity-40' : ''}`}
          >
            <span className="text-[9px] font-bold text-slate-600">{usd(item.amount_usd)}</span>
            <span className={`w-8 rounded-t transition ${pinned?.key === item.billing_month ? 'bg-emerald-700' : 'bg-emerald-500 hover:bg-emerald-600'}`} style={{ height: `${Math.max(5, item.amount_usd / maxValue * 88)}px` }} />
            <span className="whitespace-nowrap text-[9px] text-slate-500">{item.billing_month}</span>
          </button>
        ))}
        <ChartTooltip point={hovered ?? pinned} pinned={!hovered && Boolean(pinned)} />
      </div>
    </div>
  );
}

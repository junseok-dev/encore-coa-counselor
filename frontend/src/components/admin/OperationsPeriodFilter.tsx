import { RefreshCw, RotateCcw } from 'lucide-react';
import {
  OperationsAnalyticsData,
  OperationsPeriodFilters,
  OperationsPeriodMode,
} from '../../types';

interface Props {
  data: OperationsAnalyticsData | null;
  loading: boolean;
  mode: OperationsPeriodMode;
  filters: OperationsPeriodFilters;
  onChange: (filters: OperationsPeriodFilters) => void;
  onRefresh: () => Promise<void>;
}

const MODE_LEVEL: Record<OperationsPeriodMode, number> = {
  year: 1,
  month: 2,
  week: 3,
  day: 4,
};

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIso(value: Date) {
  return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function monthWeeks(year: number | null, month: number | null) {
  if (!year || !month) return [];
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  let weekStart = addDays(monthStart, -mondayOffset);
  const weeks: { value: string; label: string; visibleStart: string; visibleEnd: string }[] = [];
  let index = 1;

  while (weekStart <= monthEnd) {
    const weekEnd = addDays(weekStart, 6);
    const visibleStart = weekStart < monthStart ? monthStart : weekStart;
    const visibleEnd = weekEnd > monthEnd ? monthEnd : weekEnd;
    weeks.push({
      value: toIso(weekStart),
      label: `${index}주차 · ${visibleStart.getMonth() + 1}.${visibleStart.getDate()}~${visibleEnd.getMonth() + 1}.${visibleEnd.getDate()}`,
      visibleStart: toIso(visibleStart),
      visibleEnd: toIso(visibleEnd),
    });
    weekStart = addDays(weekStart, 7);
    index += 1;
  }
  return weeks;
}

function daysInWeek(weekStart: string | null, year: number | null, month: number | null) {
  if (!weekStart || !year || !month) return [];
  const start = parseIso(weekStart);
  return Array.from({ length: 7 }, (_, offset) => addDays(start, offset))
    .filter((value) => value.getFullYear() === year && value.getMonth() + 1 === month)
    .map((value) => ({
      value: toIso(value),
      label: `${value.getMonth() + 1}월 ${value.getDate()}일`,
    }));
}

function periodReference(data: OperationsAnalyticsData | null, filters: OperationsPeriodFilters) {
  if (!data) return '조회 범위를 불러오는 중';
  const format = (value: string) => value.replace(/-/g, '.');
  const selection = filters.day
    ? format(filters.day)
    : filters.weekStart
      ? '선택 주차'
      : filters.month && filters.year
        ? `${filters.year}.${String(filters.month).padStart(2, '0')}`
        : filters.year
          ? `${filters.year}년`
          : '전체';
  if (data.period_start === data.period_end) return `${selection} · ${format(data.period_start)}`;
  return `${selection} · ${format(data.period_start)} ~ ${format(data.period_end)}`;
}

const SELECT_CLASS = 'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 outline-none disabled:bg-slate-50 disabled:text-slate-400';

export default function OperationsPeriodFilter({ data, loading, mode, filters, onChange, onRefresh }: Props) {
  const level = MODE_LEVEL[mode];
  const currentYear = new Date().getFullYear();
  const years = Array.from(new Set([2026, currentYear, currentYear + 1, ...(data?.available_years ?? [])])).sort((a, b) => a - b);
  const weeks = monthWeeks(filters.year, filters.month);
  const days = daysInWeek(filters.weekStart, filters.year, filters.month);

  const updateYear = (value: string) => onChange({
    year: value ? Number(value) : null,
    month: null,
    weekStart: null,
    day: null,
  });
  const updateMonth = (value: string) => onChange({
    ...filters,
    month: value ? Number(value) : null,
    weekStart: null,
    day: null,
  });
  const updateWeek = (value: string) => onChange({ ...filters, weekStart: value || null, day: null });
  const updateDay = (value: string) => onChange({ ...filters, day: value || null });

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label="조회 연도" value={filters.year ?? ''} onChange={(event) => updateYear(event.target.value)} className={SELECT_CLASS}>
          <option value="">연도 전체</option>
          {years.map((year) => <option key={year} value={year}>{year}년</option>)}
        </select>
        <select aria-label="조회 월" value={level >= 2 ? filters.month ?? '' : ''} onChange={(event) => updateMonth(event.target.value)} disabled={level < 2 || !filters.year} className={SELECT_CLASS}>
          <option value="">월 전체</option>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}월</option>)}
        </select>
        <select aria-label="조회 주차" value={level >= 3 ? filters.weekStart ?? '' : ''} onChange={(event) => updateWeek(event.target.value)} disabled={level < 3 || !filters.month} className={SELECT_CLASS}>
          <option value="">주 전체</option>
          {weeks.map((week) => <option key={week.value} value={week.value}>{week.label}</option>)}
        </select>
        <select aria-label="조회 날짜" value={level >= 4 ? filters.day ?? '' : ''} onChange={(event) => updateDay(event.target.value)} disabled={level < 4 || !filters.weekStart} className={SELECT_CLASS}>
          <option value="">일 전체</option>
          {days.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
        </select>
        <button onClick={() => onChange({ year: null, month: null, weekStart: null, day: null })} title="기간 선택 초기화" className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50">
          <RotateCcw className="h-3.5 w-3.5" />초기화
        </button>
        <button onClick={() => void onRefresh()} disabled={loading} title="통계 새로고침" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="px-1 text-[11px] font-medium text-slate-400">참조 · {periodReference(data, filters)}</p>
    </div>
  );
}

export const KOREA_TIME_ZONE = 'Asia/Seoul';

const HAS_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const HAS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function parseDateTime(value: string | number | Date): Date {
  if (typeof value !== 'string') return new Date(value);
  const normalized = HAS_TIME.test(value) && !HAS_TIMEZONE.test(value) ? `${value}Z` : value;
  return new Date(normalized);
}

export function formatKoreaDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
    timeZone: KOREA_TIME_ZONE,
  }).format(parseDateTime(value));
}

export function formatKoreaDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
    timeZone: KOREA_TIME_ZONE,
  }).format(parseDateTime(value));
}

export function formatKoreaTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
    timeZone: KOREA_TIME_ZONE,
  }).format(parseDateTime(value));
}

export function koreaDateStamp(value: string | number | Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: KOREA_TIME_ZONE,
  }).formatToParts(parseDateTime(value));
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function koreaCurrentMonth() {
  return koreaDateStamp().slice(0, 7);
}

export function koreaCurrentYear() {
  return Number(koreaDateStamp().slice(0, 4));
}

export function dateTimeMillis(value: string | number | Date) {
  return parseDateTime(value).getTime();
}

/**
 * Calendar / 12-hour time helpers for ScheduleDateTimeModal.
 * month is 0-based (Date.getMonth).
 */

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 墨蓝 — month/year, weekday numbers, Time / hint labels */
export const INK = '#1B365D';

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isWeekend(dayOfWeek) {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function isSameYmd(a, b) {
  if (!a || !b) return false;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function todayYmd() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
  };
}

export function toYmd(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
  };
}

/**
 * 6×7 cells covering the visible month, padded with adjacent-month days.
 */
export function buildCalendarCells(year, month) {
  const startDow = new Date(year, month, 1).getDay();
  const daysThis = new Date(year, month + 1, 0).getDate();
  const daysPrev = new Date(year, month, 0).getDate();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;

  const cells = [];
  for (let i = 0; i < startDow; i += 1) {
    cells.push({
      year: prevYear,
      month: prevMonth,
      day: daysPrev - startDow + 1 + i,
      inMonth: false,
    });
  }
  for (let d = 1; d <= daysThis; d += 1) {
    cells.push({ year, month, day: d, inMonth: true });
  }
  const remain = 42 - cells.length;
  for (let d = 1; d <= remain; d += 1) {
    cells.push({ year: nextYear, month: nextMonth, day: d, inMonth: false });
  }
  return cells;
}

export function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function shiftYear(year, month, delta) {
  return { year: year + delta, month };
}

/** hour24 0–23 → { hour12: 1–12, ampm: 'AM'|'PM' } */
export function from24Hour(hour24) {
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, ampm };
}

/** hour12 1–12 + AM/PM → 0–23 */
export function to24Hour(hour12, ampm) {
  const h = Number(hour12);
  if (ampm === 'AM') return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

export function nowTimeParts() {
  const now = new Date();
  const { hour12, ampm } = from24Hour(now.getHours());
  return { hour12, minute: now.getMinutes(), ampm };
}

/**
 * Combine calendar day + 12h time into a Date.
 * Returns null if the time is incomplete / invalid.
 */
export function combineDateTime(ymd, hour12, minute, ampm) {
  if (!ymd) return null;
  const h = Number(hour12);
  const m = Number(minute);
  if (!Number.isInteger(h) || h < 1 || h > 12) return null;
  if (!Number.isInteger(m) || m < 0 || m > 59) return null;
  if (ampm !== 'AM' && ampm !== 'PM') return null;
  return new Date(ymd.year, ymd.month, ymd.day, to24Hour(h, ampm), m, 0, 0);
}

export function formatDateTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:00`;
}

/** Keep only digits; clamp to maxLen / maxVal. Empty string stays empty (typing). */
export function sanitizeDigits(raw, maxLen, maxVal) {
  const digits = String(raw).replace(/\D/g, '').slice(0, maxLen);
  if (digits === '') return '';
  const n = Number(digits);
  if (!Number.isFinite(n)) return '';
  return String(Math.min(n, maxVal));
}

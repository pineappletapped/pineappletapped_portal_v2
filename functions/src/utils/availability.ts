import { Timestamp } from 'firebase-admin/firestore';

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

export function normaliseDateInput(value: unknown): Date | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : cloneDate(value);
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const converted = (value as { toDate: () => Date }).toDate();
      const time = converted.getTime();
      return Number.isNaN(time) ? null : converted;
    } catch (error) {
      console.warn('Failed to convert date-like value via toDate()', error);
      return null;
    }
  }
  return null;
}

export function exclusiveIntervalsOverlap(
  requestStart: Date,
  requestEnd: Date,
  bookingStart: Date,
  bookingEnd: Date,
): boolean {
  const startA = requestStart.getTime();
  const endA = requestEnd.getTime();
  const startB = bookingStart.getTime();
  const endB = bookingEnd.getTime();

  if (!Number.isFinite(startA) || !Number.isFinite(endA) || !Number.isFinite(startB) || !Number.isFinite(endB)) {
    return true;
  }

  if (endA <= startA || endB <= startB) {
    return true;
  }

  return startA < endB && endA > startB;
}

export function bookingConflictsWithRange(
  booking: { start?: unknown; end?: unknown } | null,
  requestStart: Date,
  requestEnd: Date,
): boolean {
  if (!booking) {
    return false;
  }
  const bookingStart = normaliseDateInput(booking.start ?? null);
  const bookingEnd = normaliseDateInput(booking.end ?? null);
  if (!bookingStart || !bookingEnd) {
    return true;
  }
  return exclusiveIntervalsOverlap(requestStart, requestEnd, bookingStart, bookingEnd);
}

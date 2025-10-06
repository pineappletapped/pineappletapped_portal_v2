import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import {
  exclusiveIntervalsOverlap,
  bookingConflictsWithRange,
} from '../lib/utils/availability.js';

test('exclusiveIntervalsOverlap treats back-to-back reservations as non-conflicting', () => {
  const firstStart = new Date('2024-01-01T09:00:00Z');
  const firstEnd = new Date('2024-01-01T10:00:00Z');
  const secondStart = new Date('2024-01-01T10:00:00Z');
  const secondEnd = new Date('2024-01-01T11:00:00Z');

  assert.equal(
    exclusiveIntervalsOverlap(firstStart, firstEnd, secondStart, secondEnd),
    false,
  );
});

test('exclusiveIntervalsOverlap detects overlapping reservations', () => {
  const firstStart = new Date('2024-01-01T09:00:00Z');
  const firstEnd = new Date('2024-01-01T10:30:00Z');
  const secondStart = new Date('2024-01-01T10:00:00Z');
  const secondEnd = new Date('2024-01-01T11:00:00Z');

  assert.equal(
    exclusiveIntervalsOverlap(firstStart, firstEnd, secondStart, secondEnd),
    true,
  );
});

test('bookingConflictsWithRange ignores bookings that end when the new request starts', () => {
  const booking = {
    start: Timestamp.fromDate(new Date('2024-03-01T09:00:00Z')),
    end: Timestamp.fromDate(new Date('2024-03-01T10:00:00Z')),
  };

  const requestStart = new Date('2024-03-01T10:00:00Z');
  const requestEnd = new Date('2024-03-01T12:00:00Z');

  assert.equal(bookingConflictsWithRange(booking, requestStart, requestEnd), false);
});

test('bookingConflictsWithRange flags overlapping bookings returned by Firestore', () => {
  const booking = {
    start: Timestamp.fromDate(new Date('2024-03-01T09:00:00Z')),
    end: Timestamp.fromDate(new Date('2024-03-01T11:00:00Z')),
  };

  const requestStart = new Date('2024-03-01T10:30:00Z');
  const requestEnd = new Date('2024-03-01T12:00:00Z');

  assert.equal(bookingConflictsWithRange(booking, requestStart, requestEnd), true);
});

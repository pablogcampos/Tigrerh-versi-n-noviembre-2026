import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesReportDateRange } from './reportDateRange';

test('includes both boundaries and a single selected day', () => {
  for (const date of ['2026-10-01', '2026-10-15', '2026-10-31']) {
    assert.equal(matchesReportDateRange(date, '2026-10-01', '2026-10-31'), true);
  }
  assert.equal(matchesReportDateRange('2026-10-15', '2026-10-15', '2026-10-15'), true);
  for (const date of ['2026-09-30', '2026-11-01']) {
    assert.equal(matchesReportDateRange(date, '2026-10-01', '2026-10-31'), false);
  }
});

test('supports open boundaries and preserves unfiltered records', () => {
  assert.equal(matchesReportDateRange(undefined, '', ''), true);
  assert.equal(matchesReportDateRange('2026-10-01', '2026-10-01', ''), true);
  assert.equal(matchesReportDateRange('2026-09-30', '2026-10-01', ''), false);
  assert.equal(matchesReportDateRange('2026-10-31', '', '2026-10-31'), true);
  assert.equal(matchesReportDateRange('2026-11-01', '', '2026-10-31'), false);
});

test('rejects inverted ranges and undated or invalid records when filtering', () => {
  assert.equal(matchesReportDateRange('2026-10-15', '2026-10-31', '2026-10-01'), false);
  for (const date of [undefined, '', 'invalid', '2026-02-30', '2026-13-01']) {
    assert.equal(matchesReportDateRange(date, '2026-01-01', '2026-12-31'), false);
  }
});

test('preserves the stored calendar day without timezone offsets', () => {
  assert.equal(matchesReportDateRange('2026-10-01T00:00:00.000Z', '2026-10-01', '2026-10-01'), true);
  assert.equal(matchesReportDateRange('2026-12-31', '2026-12-31', '2027-01-01'), true);
  assert.equal(matchesReportDateRange('2028-02-29', '2028-02-01', '2028-02-29'), true);
});

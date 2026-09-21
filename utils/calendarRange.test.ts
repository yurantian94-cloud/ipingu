import { describe, expect, it } from 'vitest';
import { expandCalendarDateRange } from './calendarRange';

describe('expandCalendarDateRange', () => {
  it('includes every day from start through due date', () => {
    expect(expandCalendarDateRange('2026-09-17', '2026-09-25')).toEqual([
      '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21',
      '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
    ]);
  });

  it('keeps single-day and invalid reversed ranges on the start date', () => {
    expect(expandCalendarDateRange('2026-09-17')).toEqual(['2026-09-17']);
    expect(expandCalendarDateRange('2026-09-17', '2026-09-16')).toEqual(['2026-09-17']);
  });
});

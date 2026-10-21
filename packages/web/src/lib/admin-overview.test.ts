import { describe, expect, it } from 'vitest';
import { feedbackLine, gasPayerLine, waitingLine } from './admin-overview';

describe('waitingLine', () => {
  it('counts what waits, and says when nothing does', () => {
    expect(waitingLine(0, 'order', 'orders')).toBe('Nothing waiting');
    expect(waitingLine(1, 'order', 'orders')).toBe('1 order');
    expect(waitingLine(3, 'order', 'orders')).toBe('3 orders');
  });
});

describe('feedbackLine', () => {
  it('gives the count and the latest date', () => {
    expect(feedbackLine([])).toBe('No feedback yet');
    expect(
      feedbackLine([{ createdAt: '2026-09-30T10:00:00Z' }, { createdAt: '2026-10-03T10:00:00Z' }]),
    ).toBe('2 submissions, the latest on 3 Oct 2026');
  });
});

describe('gasPayerLine', () => {
  it('never reports an unknown balance as healthy', () => {
    expect(gasPayerLine('ok').tone).toBe('ok');
    expect(gasPayerLine('critical')).toEqual({
      text: 'Gas payer balance is critical: top it up',
      tone: 'warn',
    });
    expect(gasPayerLine(undefined).tone).toBe('unknown');
    expect(gasPayerLine('unknown').tone).toBe('unknown');
  });
});

import { describe, expect, it } from 'vitest';
import { gradeBasis, latestIndependent, reportedBy, type ReportForBuyer } from './inspection';

const report = (over: Partial<ReportForBuyer>): ReportForBuyer => ({
  overallGrade: 'B',
  createdAt: '2026-10-01T10:00:00Z',
  source: 'independent',
  inspector: { name: 'Ines Pector', role: 'inspector' },
  ...over,
});

describe('gradeBasis', () => {
  it('says the seller declared a grade nobody has inspected', () => {
    expect(gradeBasis('B', [], 'Stirling Reuse Hub')).toBe(
      'Declared by Stirling Reuse Hub; not yet independently inspected',
    );
    expect(gradeBasis('B', [], null)).toBe(
      'Declared by the seller; not yet independently inspected',
    );
  });

  it('credits an independent inspection that gave the grade shown', () => {
    expect(gradeBasis('C', [report({ overallGrade: 'C' })], 'Stirling Reuse Hub')).toBe(
      'Set by independent inspection on 1 Oct 2026',
    );
  });

  it("never presents the seller's own check as an inspection", () => {
    const own = report({ source: 'seller', inspector: { name: 'Hub Admin', role: 'hub_admin' } });
    expect(gradeBasis('B', [own], 'Stirling Reuse Hub')).toBe(
      'Declared by Stirling Reuse Hub; not yet independently inspected',
    );
  });

  it('uses the latest report that gave the current grade', () => {
    const reports = [
      report({ overallGrade: 'A', createdAt: '2026-09-01T10:00:00Z' }),
      report({ overallGrade: 'C', createdAt: '2026-10-02T10:00:00Z' }),
    ];
    expect(gradeBasis('C', reports, 'Hub')).toBe('Set by independent inspection on 2 Oct 2026');
    // The seller changed the grade after the inspection: it is declared again,
    // though an inspection exists.
    expect(gradeBasis('B', reports, 'Hub')).toBe('Declared by Hub');
  });

  it("keeps crediting the inspection when the seller's later check agrees with it", () => {
    const reports = [
      report({ overallGrade: 'B', createdAt: '2026-10-01T10:00:00Z' }),
      report({ overallGrade: 'B', createdAt: '2026-10-02T10:00:00Z', source: 'seller' }),
      // A later inspection that gave no grade does not unseat the graded one.
      report({ overallGrade: null, createdAt: '2026-10-03T10:00:00Z' }),
    ];
    expect(gradeBasis('B', reports, 'Hub')).toBe('Set by independent inspection on 1 Oct 2026');
  });

  it('has nothing to say without a grade', () => {
    expect(gradeBasis(null, [], 'Hub')).toBeNull();
  });
});

describe('latestIndependent and reportedBy', () => {
  it('picks the newest inspector report and ignores other sources', () => {
    const reports = [
      report({ createdAt: '2026-09-01T10:00:00Z', overallGrade: 'A' }),
      report({ createdAt: '2026-10-02T10:00:00Z', source: 'seller' }),
      report({ createdAt: '2026-09-20T10:00:00Z', overallGrade: 'C' }),
    ];
    expect(latestIndependent(reports)?.overallGrade).toBe('C');
    expect(latestIndependent([reports[1]!])).toBeNull();
  });

  it('names the reporter with their role in plain words', () => {
    expect(reportedBy(report({}))).toBe('Ines Pector, independent quality auditor');
    expect(reportedBy(report({ source: 'seller', inspector: null }))).toBe('the seller');
  });
});

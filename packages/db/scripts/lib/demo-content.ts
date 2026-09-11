/**
 * Demo furniture — the content that makes the non-marketplace parts of the run
 * sheet demo onto something real.
 *
 * WHY THIS EXISTS
 * The catalogue gives the marketplace seven products, but the inspector journey
 * and the governance walk-through (run sheet Part 3) both landed on empty
 * screens: staging had 0 quality reports, and production has 0 quality reports,
 * 0 access requests and 0 feedback. An empty screen is a broken demo beat.
 *
 * Data only, no side effects — same contract as ./catalogue.ts, so it can be
 * imported by demo-restore.ts without executing anything.
 *
 * SCOPING NOTE
 * quality_reports, beta_access_requests and feedback_submissions have no
 * `customAttributes` column, so the `seedSource` tag used for passports cannot
 * be reused here. Adding one purely for demo affordances was rejected — the
 * promotion to production is currently migration-free and that is worth
 * keeping. Instead every row is scoped by a DEMO-OWNED IDENTITY (the inspector
 * persona, the applicant persona), which all three tables have as a foreign
 * key. That bounds convergence exactly as tightly: these rows can only ever
 * belong to a platform-owned demo account, never to a real lead.
 */

/**
 * The inspection shown on /quality and on the passport detail page.
 *
 * `overallGrade` MUST equal the catalogue's conditionGrade for this product.
 * The grade is part of the canonical fingerprint, so a mismatch would leave
 * catalogue convergence and this report permanently fighting each other — and
 * if the seed ever routes through the API service instead of drizzle, it would
 * silently re-grade the passport on every restore.
 *
 * Deliberately a reclaimed product rather than the K-BRIQ: grading a reclaimed
 * staircase is a coherent inspection story, grading a factory-new circular
 * brick is not, and it leaves the headline product untouched.
 */
export const DEMO_QUALITY_REPORT = {
  productName: 'Reclaimed Prefabricated Staircase',
  structuralScore: 8,
  aestheticScore: 6,
  environmentalScore: 9,
  /** Must match the catalogue grade for the product above. */
  overallGrade: 'B' as const,
  reportNotes:
    'Load-bearing capacity verified against original spec; minor surface wear to two treads, ' +
    'no structural defects found. Suitable for reuse in a residential setting.',
  /** Days in the past, applied once on creation and never converged. */
  ageDays: 5,
};

/**
 * The pending request the platform admin reviews in Part 3.
 *
 * `organisationName` must match the seeded hub's name exactly:
 * resolveOrganisationForApproval creates a NEW organisation when the name does
 * not match an existing one, so a typo here means approving it live mints a
 * junk org on the demo box.
 */
export const DEMO_ACCESS_REQUEST = {
  requestedRole: 'hub_staff' as const,
  organisationName: 'Stirling Reuse Hub',
  notes:
    'I run the intake desk at the reuse hub and need to register incoming materials ' +
    'and issue passports.',
  ageDays: 2,
};

/** Feedback shown in /admin/feedback. Ensured present; never deleted. */
export const DEMO_FEEDBACK = [
  {
    rating: 5,
    category: 'general' as const,
    message:
      'The QR passport is exactly what our site team needs — scanned it straight off the pallet.',
    pageUrl: '/marketplace',
    ageDays: 6,
  },
  {
    rating: 4,
    category: 'feature' as const,
    message: 'Would be useful to filter the marketplace by collection radius as well as category.',
    pageUrl: '/marketplace',
    ageDays: 3,
  },
];

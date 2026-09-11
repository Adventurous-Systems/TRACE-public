// Indicative kgCO₂e saved per kg of reused material vs new — used only to
// pre-fill a *suggested* value the user can edit in the registration wizard.
// Not an authoritative figure.
//
// D-08: three keys used to be wrong (cladding, mep, fixings instead of the
// real cladding-facades/mep-components/fixings-fittings slugs), so the
// lookup silently fell back to DEFAULT_CARBON_FACTOR for those three
// categories. Pulled into its own dependency-free module (rather than left
// inline in RegisterWizard.tsx) specifically so it can be unit-tested
// without needing @/ path-alias resolution or a DOM — see
// carbon-factors.test.ts, which asserts every key here is a real slug.
export const CARBON_FACTOR_PER_KG: Record<string, number> = {
  'structural-steel': 1.9,
  'structural-timber': 0.7,
  masonry: 0.22,
  roofing: 0.45,
  'cladding-facades': 0.6,
  insulation: 1.2,
  'doors-windows': 0.8,
  flooring: 0.5,
  'mep-components': 1.5,
  'fixings-fittings': 1.0,
};

export const DEFAULT_CARBON_FACTOR = 0.5;

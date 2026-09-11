import { describe, it, expect } from 'vitest';
import { CATEGORY_L1_SLUGS } from '@trace/core';
import { CARBON_FACTOR_PER_KG } from './carbon-factors';

// D-08: three keys used to be wrong (cladding, mep, fixings instead of the
// real cladding-facades/mep-components/fixings-fittings slugs), so the
// lookup in RegisterWizard silently fell back to the default carbon factor
// for those three categories instead of the intended value. This asserts
// every key is a real slug, so a typo here fails CI instead of silently
// mis-suggesting a carbon figure to a user filling in the wizard.
describe('D-08: CARBON_FACTOR_PER_KG keys are real category slugs', () => {
  it('every key is a member of CATEGORY_L1_SLUGS', () => {
    for (const key of Object.keys(CARBON_FACTOR_PER_KG)) {
      expect(CATEGORY_L1_SLUGS).toContain(key);
    }
  });

  it('covers all ten categories, not a subset', () => {
    expect(Object.keys(CARBON_FACTOR_PER_KG).sort()).toEqual([...CATEGORY_L1_SLUGS].sort());
  });
});

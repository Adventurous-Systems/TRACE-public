/**
 * The curated demo catalogue — the seven products the demo is built around.
 *
 * Extracted from seed-products.ts so it can be defined exactly once and shared
 * with demo-restore.ts. seed-products.ts calls main() at module scope, so it
 * cannot be imported without running the seeder; this module is data only and
 * has no side effects.
 *
 * SEED_TAG stamps every curated passport's customAttributes.seedSource, and is
 * what scopes every subsequent top-up, convergence and teardown. Anything not
 * carrying this tag is treated as visitor-created and never converged.
 */
import type { NewMaterialPassport } from '../../drizzle/schema.js';

export const SEED_TAG = 'workshop-curated-2026-06';

const DAY = 24 * 60 * 60 * 1000;

export type SeedPassport = Omit<
  NewMaterialPassport,
  'organisationId' | 'registeredBy' | 'conditionPhotos'
>;
export interface Product {
  image: string;
  passport: SeedPassport;
  listing: { pricePence: number; quantity: number; note?: string };
}

const RECLAIMED = {
  deconstructionMethod: 'selective',
  reclaimedBy: 'Stirling Community Reuse Hub',
  deconstructionDate: new Date(Date.now() - 120 * DAY),
} as const;

export const CATALOG: Product[] = [
  {
    image: 'kbriq-medero-dark-grey.jpg',
    passport: {
      productName: 'K-BRIQ® — Medero Dark Grey',
      categoryL1: 'masonry',
      categoryL2: 'facing-brick',
      status: 'listed',
      manufacturerName: 'Kenoteq',
      countryOfOrigin: 'GB',
      productionDate: new Date(Date.now() - 30 * DAY),
      materialComposition: [
        {
          material: 'Recycled construction & demolition aggregate',
          percentage: 90,
          recycled: true,
        },
        { material: 'Recycled gypsum (plasterboard)', percentage: 6, recycled: true },
        { material: 'Recycled pigment', percentage: 4, recycled: true },
      ],
      dimensions: {
        length: 215,
        width: 102.5,
        height: 65,
        weight: 2.4,
        unit: 'mm',
        weightUnit: 'kg',
      },
      technicalSpecs: {
        compressiveStrength: '30 N/mm²',
        waterAbsorption: '2% by weight',
        thermalConductivity: '0.74 W/mK',
        durability: 'F2',
        reactionToFire: 'A2-s1,d0',
        certification: 'BBA 25/7367',
      },
      embodiedCarbon: '0.02',
      recycledContent: '96',
      carbonSavingsVsNew: '0.49',
      conditionGrade: 'A',
      conditionNotes:
        'New low-carbon brick — over 96% recycled content, <20g CO₂e embodied per unit.',
      remainingLifeEstimate: 100,
      circularityScore: 96,
      reuseSuitability: ['Facing brickwork', 'Internal walls', 'Landscaping'],
      ceMarking: true,
    },
    listing: {
      pricePence: 360,
      quantity: 5000,
      note: 'From £3.60 each — order quantity by arrangement.',
    },
  },
  {
    image: 'sisalwool-100.jpg',
    passport: {
      productName: 'Sisalwool 100 — Natural Fibre Insulation',
      categoryL1: 'insulation',
      categoryL2: 'natural-fibre',
      status: 'listed',
      manufacturerName: 'Sisalwool',
      countryOfOrigin: 'GB',
      productionDate: new Date(Date.now() - 20 * DAY),
      materialComposition: [
        { material: 'Sisal fibre (recycled coffee sacks)', percentage: 60, recycled: true },
        { material: 'Sheep wool (textile-industry surplus)', percentage: 40, recycled: true },
      ],
      dimensions: { length: 1200, width: 570, height: 100, unit: 'mm' },
      technicalSpecs: {
        thickness: '100mm',
        widths: '370mm / 570mm',
        acoustic: 'Class A sound absorption',
        reactionToFire: 'Euroclass E',
        breathability: 'Absorbs up to 30% of its weight in moisture',
        pestResistance: 'Long-lasting moth deterrent',
      },
      recycledContent: '90',
      carbonSavingsVsNew: '8',
      conditionGrade: 'A',
      conditionNotes:
        'New breathable natural-fibre insulation from recycled coffee sacks and surplus wool.',
      remainingLifeEstimate: 60,
      circularityScore: 90,
      reuseSuitability: ['Walls', 'Floors', 'Roofs', 'Acoustic lining'],
      ceMarking: true,
    },
    listing: {
      pricePence: 8200,
      quantity: 250,
      note: 'From £82 per pack — order quantity by arrangement.',
    },
  },
  {
    image: 'aerated-concrete-blocks.jpg',
    passport: {
      productName: 'Reclaimed Aerated Concrete Blocks',
      categoryL1: 'masonry',
      categoryL2: 'aac-block',
      status: 'listed',
      countryOfOrigin: 'GB',
      ...RECLAIMED,
      materialComposition: [{ material: 'Autoclaved aerated concrete', percentage: 100 }],
      technicalSpecs: { type: 'AAC / aircrete block', grade: 'B' },
      carbonSavingsVsNew: '2.5',
      conditionGrade: 'B',
      conditionNotes: 'Reclaimed aircrete blocks in good reusable condition. B grade.',
      remainingLifeEstimate: 50,
      circularityScore: 85,
      reuseSuitability: ['Internal partitions', 'Infill walls'],
    },
    listing: { pricePence: 150, quantity: 30 },
  },
  {
    image: 'concrete-lintels.jpg',
    passport: {
      productName: 'Reclaimed Concrete Lintels',
      categoryL1: 'masonry',
      categoryL2: 'lintel',
      status: 'listed',
      countryOfOrigin: 'GB',
      ...RECLAIMED,
      materialComposition: [{ material: 'Pre-stressed concrete', percentage: 100 }],
      technicalSpecs: { description: '12 lintels circa 1.2m; 2 lintels circa 2m' },
      carbonSavingsVsNew: '30',
      conditionGrade: 'B',
      conditionNotes: '12 concrete lintels circa 1.2m and 2 concrete lintels circa 2m.',
      remainingLifeEstimate: 60,
      circularityScore: 88,
      reuseSuitability: ['Door & window openings'],
    },
    listing: { pricePence: 1000, quantity: 14 },
  },
  {
    image: 'facing-bricks.jpg',
    passport: {
      productName: 'Reclaimed Facing Bricks',
      categoryL1: 'masonry',
      categoryL2: 'facing-brick',
      status: 'listed',
      countryOfOrigin: 'GB',
      ...RECLAIMED,
      materialComposition: [{ material: 'Fired clay', percentage: 100 }],
      technicalSpecs: { type: 'Perforated facing brick', grade: 'B' },
      carbonSavingsVsNew: '0.5',
      conditionGrade: 'B',
      conditionNotes: 'Reclaimed perforated facing bricks, cleaned and palletised. B grade.',
      remainingLifeEstimate: 80,
      circularityScore: 90,
      reuseSuitability: ['Facing brickwork', 'Feature walls'],
    },
    listing: { pricePence: 100, quantity: 150 },
  },
  {
    image: 'prefabricated-staircase.jpg',
    passport: {
      productName: 'Reclaimed Prefabricated Staircase',
      categoryL1: 'structural-timber',
      categoryL2: 'softwood',
      status: 'listed',
      countryOfOrigin: 'GB',
      ...RECLAIMED,
      materialComposition: [{ material: 'Softwood timber', percentage: 100 }],
      dimensions: { length: 1720, height: 2450, unit: 'mm' },
      technicalSpecs: {
        treadDepth: '270mm',
        riserHeight: '170mm',
        steps: '13',
        height: '2.45m',
        length: '1.72m',
        angle: '55°',
      },
      carbonSavingsVsNew: '80',
      conditionGrade: 'B',
      conditionNotes:
        'Prefabricated timber staircase. Tread depth 270mm, riser 170mm, 13 steps, 55° angle.',
      remainingLifeEstimate: 40,
      circularityScore: 82,
      reuseSuitability: ['Residential stair', 'Mezzanine access'],
    },
    listing: { pricePence: 15000, quantity: 2 },
  },
  {
    image: 'aluminium-stud-walling.jpg',
    passport: {
      productName: 'Reclaimed Aluminium Stud Walling',
      categoryL1: 'structural-steel',
      categoryL2: 'channels',
      status: 'listed',
      countryOfOrigin: 'GB',
      ...RECLAIMED,
      reclaimedBy: 'Reconditioning partners',
      materialComposition: [{ material: 'Aluminium', percentage: 100, recycled: true }],
      technicalSpecs: {
        type: 'Metal stud partition framing',
        source: 'Excess from reconditioning partners',
      },
      carbonSavingsVsNew: '12',
      conditionGrade: 'B',
      conditionNotes: 'Excess aluminium stud walling from reconditioning partners. Unused surplus.',
      remainingLifeEstimate: 30,
      circularityScore: 92,
      reuseSuitability: ['Partition framing', 'Drylining'],
    },
    listing: { pricePence: 100, quantity: 18 },
  },
];

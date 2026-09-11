export interface Subcategory {
  slug: string;
  label: string;
}

export interface Category {
  slug: string;
  label: string;
  subcategories: Subcategory[];
}

export const MATERIAL_CATEGORIES: Category[] = [
  {
    slug: 'structural-steel',
    label: 'Structural Steel',
    subcategories: [
      { slug: 'i-beams', label: 'I-Beams (Universal Beams)' },
      { slug: 'h-beams', label: 'H-Beams (Universal Columns)' },
      { slug: 'channels', label: 'Channels (PFC)' },
      { slug: 'angles', label: 'Angles' },
      { slug: 'plates', label: 'Steel Plates' },
      { slug: 'rhs', label: 'Hollow Sections — RHS' },
      { slug: 'shs', label: 'Hollow Sections — SHS' },
      { slug: 'chs', label: 'Hollow Sections — CHS' },
      { slug: 'connection-plates', label: 'Connection Plates' },
      { slug: 'gussets', label: 'Gusset Plates' },
      { slug: 'end-plates', label: 'End Plates' },
      { slug: 'cleats', label: 'Cleats & Brackets' },
    ],
  },
  {
    slug: 'structural-timber',
    label: 'Structural Timber',
    subcategories: [
      { slug: 'softwood', label: 'Softwood (C16/C24)' },
      { slug: 'hardwood', label: 'Hardwood Structural' },
      { slug: 'glulam', label: 'Glulam Beams' },
      { slug: 'clt', label: 'Cross-Laminated Timber (CLT)' },
      { slug: 'lvl', label: 'Laminated Veneer Lumber (LVL)' },
      { slug: 'plywood', label: 'Structural Plywood' },
      { slug: 'osb', label: 'Oriented Strand Board (OSB)' },
      { slug: 'trusses', label: 'Roof Trusses' },
      { slug: 'purlins', label: 'Purlins' },
      { slug: 'joists', label: 'Floor Joists' },
    ],
  },
  {
    slug: 'masonry',
    label: 'Masonry',
    subcategories: [
      { slug: 'clay-brick', label: 'Clay Brick' },
      { slug: 'facing-brick', label: 'Facing Brick' },
      { slug: 'engineering-brick', label: 'Engineering Brick' },
      { slug: 'concrete-block', label: 'Concrete Block' },
      { slug: 'aac-block', label: 'AAC / Aircrete Block' },
      { slug: 'natural-stone', label: 'Natural Stone' },
      { slug: 'engineered-stone', label: 'Engineered Stone' },
      { slug: 'reconstituted-stone', label: 'Reconstituted Stone' },
      { slug: 'lintel', label: 'Lintels' },
    ],
  },
  {
    slug: 'roofing',
    label: 'Roofing',
    subcategories: [
      { slug: 'natural-slate', label: 'Natural Slate' },
      { slug: 'artificial-slate', label: 'Artificial Slate' },
      { slug: 'clay-tile', label: 'Clay Roof Tile' },
      { slug: 'concrete-tile', label: 'Concrete Roof Tile' },
      { slug: 'metal-sheet', label: 'Metal Sheet Roofing' },
      { slug: 'flat-membrane', label: 'Flat Roof Membrane' },
      { slug: 'green-roof', label: 'Green Roof Components' },
      { slug: 'rooflights', label: 'Rooflights' },
      { slug: 'ridge-tiles', label: 'Ridge Tiles & Verge Units' },
      { slug: 'flashings', label: 'Flashings & Trims' },
    ],
  },
  {
    slug: 'cladding-facades',
    label: 'Cladding & Facades',
    subcategories: [
      { slug: 'brick-slips', label: 'Brick Slips' },
      { slug: 'timber-cladding', label: 'Timber Cladding' },
      { slug: 'metal-panels', label: 'Metal Cladding Panels' },
      { slug: 'curtain-wall', label: 'Curtain Wall Systems' },
      { slug: 'rainscreen', label: 'Rainscreen Cladding' },
      { slug: 'stone-cladding', label: 'Stone Cladding' },
      { slug: 'render-systems', label: 'Render Systems' },
      { slug: 'eifs', label: 'External Insulation (EIFS)' },
      { slug: 'soffit-panels', label: 'Soffit Panels' },
    ],
  },
  {
    slug: 'insulation',
    label: 'Insulation',
    subcategories: [
      { slug: 'mineral-wool-batts', label: 'Mineral Wool Batts' },
      { slug: 'mineral-wool-board', label: 'Mineral Wool Board' },
      { slug: 'pir-board', label: 'Rigid PIR / Polyisocyanurate Board' },
      { slug: 'eps-board', label: 'Rigid EPS Board' },
      { slug: 'xps-board', label: 'Rigid XPS Board' },
      { slug: 'natural-fibre', label: 'Natural Fibre Insulation' },
      { slug: 'spray-foam', label: 'Spray Foam Insulation' },
      { slug: 'reflective-foil', label: 'Reflective Foil Insulation' },
    ],
  },
  {
    slug: 'doors-windows',
    label: 'Doors & Windows',
    subcategories: [
      { slug: 'external-doors', label: 'External Doors' },
      { slug: 'internal-doors', label: 'Internal Doors' },
      { slug: 'fire-doors', label: 'Fire Doors' },
      { slug: 'double-glazed-windows', label: 'Double-Glazed Windows' },
      { slug: 'triple-glazed-windows', label: 'Triple-Glazed Windows' },
      { slug: 'rooflights-windows', label: 'Rooflights & Skylights' },
      { slug: 'bifold-doors', label: 'Bifold & Sliding Doors' },
      { slug: 'curtain-wall-glazing', label: 'Curtain Wall Glazing Units' },
      { slug: 'ironmongery', label: 'Ironmongery & Hardware' },
      { slug: 'door-frames', label: 'Door & Window Frames' },
    ],
  },
  {
    slug: 'flooring',
    label: 'Flooring',
    subcategories: [
      { slug: 'solid-hardwood', label: 'Solid Hardwood Flooring' },
      { slug: 'engineered-hardwood', label: 'Engineered Hardwood Flooring' },
      { slug: 'ceramic-tile', label: 'Ceramic Floor Tile' },
      { slug: 'porcelain-tile', label: 'Porcelain Floor Tile' },
      { slug: 'natural-stone-tile', label: 'Natural Stone Floor Tile' },
      { slug: 'raised-access', label: 'Raised Access Floor Panels' },
      { slug: 'carpet-tile', label: 'Carpet Tiles' },
      { slug: 'industrial-flooring', label: 'Industrial / Resin Flooring' },
    ],
  },
  {
    slug: 'mep-components',
    label: 'MEP Components',
    subcategories: [
      { slug: 'radiators', label: 'Radiators' },
      { slug: 'boilers', label: 'Boilers & Heat Generators' },
      { slug: 'heat-pumps', label: 'Heat Pumps' },
      { slug: 'hvac-units', label: 'HVAC Units & Fan Coils' },
      { slug: 'sanitaryware', label: 'Sanitaryware (WC, Basin, Bath)' },
      { slug: 'electrical-panels', label: 'Electrical Panels & Switchgear' },
      { slug: 'pipework', label: 'Pipework & Fittings' },
      { slug: 'ductwork', label: 'Ductwork & Air Handling' },
      { slug: 'lighting-fixtures', label: 'Lighting Fixtures' },
    ],
  },
  {
    slug: 'fixings-fittings',
    label: 'Fixings & Fittings',
    subcategories: [
      { slug: 'structural-bolts', label: 'Structural Bolts & Fixings' },
      { slug: 'anchor-bolts', label: 'Anchor Bolts & Resin Anchors' },
      { slug: 'brackets', label: 'Brackets & Joist Hangers' },
      { slug: 'shelf-systems', label: 'Shelving & Racking Systems' },
      { slug: 'handrails', label: 'Handrails' },
      { slug: 'balustrades', label: 'Balustrades & Barriers' },
      { slug: 'signage', label: 'Signage & Wayfinding' },
      { slug: 'storage-systems', label: 'Storage & Mezzanine Systems' },
    ],
  },
];

export const CATEGORY_L1_SLUGS = MATERIAL_CATEGORIES.map((c) => c.slug) as [string, ...string[]];

export function getCategoryBySlug(slug: string): Category | undefined {
  return MATERIAL_CATEGORIES.find((c) => c.slug === slug);
}

export function getSubcategoryBySlug(l1Slug: string, l2Slug: string): Subcategory | undefined {
  const category = getCategoryBySlug(l1Slug);
  return category?.subcategories.find((s) => s.slug === l2Slug);
}

export function isValidL2ForL1(l1Slug: string, l2Slug: string): boolean {
  return getSubcategoryBySlug(l1Slug, l2Slug) !== undefined;
}

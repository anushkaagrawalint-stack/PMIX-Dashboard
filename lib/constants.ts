// Channels excluded globally from all dashboard queries
export const EXCLUDED_CHANNELS = ['CATERING', 'OFFSITE'] as const;

// Excluded menu groups from all dashboard queries — fees, catering platforms, non-menu items
export const EXCLUDED_GROUPS = [
  // Fees & markups
  '3PD MARKUPS', 'BAG TAX',
  // EzCater — both legacy spellings (no-space) and current DB spelling (with-space)
  'EzCater + Relish Individually Packaged Bowls', 'Ez Cater + Relish Individually Packaged Bowls',
  'EzCater Additional Items',    'Ez Cater Additional Items',
  'EzCater Catering Packages',   'Ez Cater Catering Packages',
  'EzCater Drinks',              'Ez Cater Drinks',
  'EzCater Sides + Sweets',      'Ez Cater Sides + Sweets',
  'Ez Cater Delivery',
  // Other catering / B2B platforms
  'Aramark', 'Cater Cow', 'Catering Bundles', 'Catering Packages - BYO Bowl Bar',
  'Club Feast', 'Cureate', 'EF Tours', 'Eurest', 'Fooda', 'HUNGRY',
  'Individually Packaged Bowls', 'Individually Packaged Indian Burritos',
  'Individually Packaged Plates', 'Indian Burrito Boxes',
  'Metz', 'Sharebite', 'Taher', 'TERRITORY', 'WCK', 'ZeroCater',
  'Additional Items',
];

export const CHANNELS = [
  { code: 'IN_HOUSE', label: 'In-House', color: '#9f7cef' },
  { code: 'TPD',      label: '3PD',      color: '#ef7ccf' },
  { code: 'APP',      label: 'App',       color: '#7cb9ef' },
];

// Color palette for locations — assigned by index from dim_location (ordered by display_name)
export const LOC_COLOR_PALETTE = [
  '#ef4444', // Ballpark
  '#10b981', // Mosaic
  '#f59e0b', // MVT
  '#3b82f6', // NL
  '#8b5cf6', // Rockville
  '#ec4899', // fallback for any new location
  '#14b8a6',
];

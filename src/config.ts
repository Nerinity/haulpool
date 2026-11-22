/**
 * All tunable numbers live here (spec §19.1). Change a value here, not in lib code.
 * Values marked ESTIMATE are not sourced and must be calibrated before launch.
 */

export type VehicleType =
  | 'pickup' | 'cargo_van' | 'truck_10' | 'truck_15' | 'truck_20' | 'truck_26'
  | 'own_sedan' | 'own_suv'

export interface VehicleSpec {
  label: string
  capacityCuFt: number
  /** U-Haul in-town starting day rate in cents; 0 for own cars (cost-sharing only). */
  baseDayCents: number
  own: boolean
}

// Capacities: movebuddha / U-Haul. Day rates: U-Haul "Truck Rental Price vs Cost".
export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  pickup:    { label: 'Pickup truck',    capacityCuFt: 76,   baseDayCents: 1995, own: false },
  cargo_van: { label: 'Cargo van',       capacityCuFt: 245,  baseDayCents: 1995, own: false },
  truck_10:  { label: "10' truck",       capacityCuFt: 402,  baseDayCents: 1995, own: false },
  truck_15:  { label: "15' truck",       capacityCuFt: 764,  baseDayCents: 2995, own: false },
  truck_20:  { label: "20' truck",       capacityCuFt: 1016, baseDayCents: 3995, own: false },
  truck_26:  { label: "26' truck",       capacityCuFt: 1682, baseDayCents: 4995, own: false },
  own_sedan: { label: 'Own car (sedan)', capacityCuFt: 15,   baseDayCents: 0,    own: true }, // ESTIMATE
  own_suv:   { label: 'Own car (SUV)',   capacityCuFt: 70,   baseDayCents: 0,    own: true }, // ESTIMATE
}

export type ItemKey =
  | 'box_small' | 'box_medium' | 'box_large' | 'sofa_3' | 'dresser_6' | 'fridge_full' | 'bed_full_set'
  | 'mattress_twin' | 'mini_fridge' | 'desk' | 'office_chair' | 'bookshelf' | 'suitcase' | 'bike' | 'tv' | 'microwave'
  | 'monitor' | 'mirror' | 'lamp' | 'plant' | 'artwork' | 'guitar' | 'fragile_box'

/**
 * fragile: rides on top of its owner's stuff, where nothing is stacked on it.
 * It counts as CONFIG.items.fragileFactor × its size, for space and for price.
 */
export interface ItemSpec { label: string; cuFt: number; irregular: boolean; sourced: boolean; fragile?: boolean }

// sourced: Safebound Moving / Moving.com. Others are ESTIMATES (spec §19.3).
export const ITEMS: Record<ItemKey, ItemSpec> = {
  box_small:     { label: 'Small box',          cuFt: 1.5, irregular: false, sourced: true },
  box_medium:    { label: 'Medium box',         cuFt: 3,   irregular: false, sourced: true },
  box_large:     { label: 'Large box',          cuFt: 4.5, irregular: false, sourced: true },
  sofa_3:        { label: '3-seat sofa',        cuFt: 50,  irregular: true,  sourced: true },
  dresser_6:     { label: '6-drawer dresser',   cuFt: 30,  irregular: false, sourced: true },
  fridge_full:   { label: 'Full-size fridge',   cuFt: 50,  irregular: false, sourced: true },
  bed_full_set:  { label: 'Bed set (mattress + frame)', cuFt: 70, irregular: true, sourced: true },
  mattress_twin: { label: 'Twin mattress',      cuFt: 15,  irregular: true,  sourced: false },
  mini_fridge:   { label: 'Mini fridge',        cuFt: 6,   irregular: false, sourced: false },
  desk:          { label: 'Desk',               cuFt: 20,  irregular: true,  sourced: false },
  office_chair:  { label: 'Office chair',       cuFt: 10,  irregular: true,  sourced: false },
  bookshelf:     { label: 'Bookshelf',          cuFt: 15,  irregular: true,  sourced: false },
  suitcase:      { label: 'Suitcase',           cuFt: 5,   irregular: false, sourced: false },
  bike:          { label: 'Bike',               cuFt: 15,  irregular: true,  sourced: false },
  tv:            { label: 'TV',                 cuFt: 5,   irregular: true,  sourced: false, fragile: true },
  microwave:     { label: 'Microwave',          cuFt: 2,   irregular: false, sourced: false },
  monitor:       { label: 'Computer monitor',   cuFt: 3,   irregular: true,  sourced: false, fragile: true },
  mirror:        { label: 'Mirror',             cuFt: 4,   irregular: true,  sourced: false, fragile: true },
  lamp:          { label: 'Lamp',               cuFt: 3,   irregular: true,  sourced: false, fragile: true },
  plant:         { label: 'Plant',              cuFt: 4,   irregular: true,  sourced: false, fragile: true },
  artwork:       { label: 'Framed art',         cuFt: 3,   irregular: true,  sourced: false, fragile: true },
  guitar:        { label: 'Guitar / instrument', cuFt: 4,  irregular: true,  sourced: false, fragile: true },
  fragile_box:   { label: 'Glass / kitchen box', cuFt: 3,  irregular: false, sourced: false, fragile: true },
}

/** Friendly icons for the item list (display only). */
export const ITEM_ICONS: Record<ItemKey, string> = {
  box_small: '📦', box_medium: '📦', box_large: '📦', sofa_3: '🛋️', dresser_6: '🗄️', fridge_full: '🧊',
  bed_full_set: '🛏️', mattress_twin: '🛏️', mini_fridge: '🧊', desk: '🪑', office_chair: '💺', bookshelf: '📚',
  suitcase: '🧳', bike: '🚲', tv: '📺', microwave: '🍿',
  monitor: '🖥️', mirror: '🪞', lamp: '💡', plant: '🪴', artwork: '🖼️', guitar: '🎸', fragile_box: '🍷',
}

/** Groups for the item list, in display order. */
export const ITEM_GROUPS: { label: string; keys: ItemKey[] }[] = [
  { label: 'Boxes & bags', keys: ['box_small', 'box_medium', 'box_large', 'suitcase'] },
  { label: 'Furniture', keys: ['mattress_twin', 'bed_full_set', 'desk', 'office_chair', 'dresser_6', 'bookshelf', 'sofa_3'] },
  { label: 'Appliances & bikes', keys: ['mini_fridge', 'fridge_full', 'microwave', 'bike'] },
  { label: 'Fragile — handle with care', keys: ['tv', 'monitor', 'mirror', 'lamp', 'plant', 'artwork', 'guitar', 'fragile_box'] },
]

/**
 * One-tap starting points. Rough typical contents (ESTIMATES) — people adjust after.
 * Each stays under CONFIG.items.maxPerPerson items.
 */
export const ROOM_PRESETS: { key: string; icon: string; label: string; hint: string; items: Partial<Record<ItemKey, number>> }[] = [
  { key: 'boxes', icon: '🎒', label: 'Just boxes', hint: 'A few boxes and suitcases', items: { box_medium: 6, suitcase: 2 } },
  { key: 'dorm', icon: '🏫', label: 'Dorm room', hint: '10 boxes, mini fridge, twin mattress', items: { box_medium: 10, mini_fridge: 1, mattress_twin: 1, suitcase: 2 } },
  { key: 'studio', icon: '🏠', label: 'Studio', hint: 'Bed, desk, dresser, 12 boxes', items: { box_medium: 12, bed_full_set: 1, desk: 1, office_chair: 1, dresser_6: 1, tv: 1, microwave: 1 } },
  { key: 'one_bed', icon: '🏡', label: '1-bedroom', hint: 'Adds a sofa and bookshelf', items: { box_medium: 15, box_large: 3, sofa_3: 1, bed_full_set: 1, dresser_6: 1, desk: 1, office_chair: 1, bookshelf: 1, tv: 1 } },
]

export const CONFIG = {
  buffer: { defaultPct: 20, minPct: 15, maxPct: 35 },
  items: { maxPerPerson: 30, maxCustomCuFt: 100, mediumBoxCuFt: 3, fragileFactor: 1.5 },
  route: {
    roadFactor: 1.3,            // ASSUMPTION: straight-line -> road miles, calibrate
    detourPct: 0.15, detourMinMi: 3, detourMaxMi: 25,
    sameDestinationMi: 0.5,
    // City-to-city (route > longDistanceMi): riders only need the same destination METRO;
    // the extra drop-off counts as detour, and the detour cap is allowed to grow to longDetourMaxMi.
    longDistanceMi: 50, cityDestinationMi: 15, longDetourMaxMi: 40,
    mpg: 10, fuelPerGallonCents: 350, // ESTIMATES for the auto fuel default
    maxStops: 8,
  },
  score: {
    weights: { detour: 40, cost: 30, time: 20, fill: 10 },
    storageMonthMismatchFactor: 0.95,
    nearMiss: { detourMultiplier: 1.5, dayWindow: 1, capacitySlackPct: 10 },
  },
  split: { organizerDiscountPct: 10, organizerDiscountMaxPct: 25, discountMinMembers: 2 },
  // Platform money rules (11/19, Nerin): everyone pays HaulPool from a prepaid wallet.
  fees: {
    servicePct: 8, serviceMinCents: 100,      // HaulPool's fee on each person's share
    cancelCents: 1000,                         // leaving a locked pool; goes to the people left as credit
    // Test-mode wallet. A city-to-city share can be $700+, so one top-up must cover it (changed 11/20).
    topUpMinCents: 500, topUpMaxCents: 300_000, topUpDailyMaxCents: 1_000_000,
  },
  eta: { cityMph: 20, loadBaseMin: 10, loadPerCuFtMin: 0.4, slackMin: 15 },
  dates: { flexMaxDays: 3, flexDefaultDays: 3, scorePenaltyPerDay: 6 }, // match trucks up to ±3 days from your date
  deadline: { daysBefore: 3, minLeadHours: 2 }, // pools auto-lock (2+ people) or close (alone) at the deadline
  lock: { maxRetries: 5, backoffMinMs: 50, backoffMaxMs: 150, pendingSeatTimeoutMs: 2 * 60_000 },
  privacy: { distanceRoundMi: 0.5, addressRetentionDays: 30 },
  payment: { dueHours: 48 },
  quoteBoundsCents: { min: 0, max: 200_000 },
} as const

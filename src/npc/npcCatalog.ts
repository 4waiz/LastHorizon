import type { NamedNpcDefinition } from './NpcDefinition';

/**
 * The twenty named residents.
 *
 * Eight in the village, twelve across the three city districts, which is the
 * MVP target. Every anchor is a real point in its zone — home anchors sit on
 * the doorstep of a building that exists in `PLACEMENTS` or in the district
 * manifest, not at a plausible-looking coordinate — because an anchor inside a
 * wall is an NPC who spends the working day trying to reach somewhere the
 * navmesh does not go.
 *
 * Colours come from the same wardrobe palettes the player picks from, so a
 * resident and the player never look like they came from different games.
 *
 * `combatCapable` is false for all twenty. Phase 9 owns arming anyone, and the
 * two teenagers here are `teen` rather than `child` only because they are 16
 * and 17; nothing in this catalogue may ever be targetable while it is a child.
 */

// Wardrobe palettes, matching src/ui/HUD.ts.
const SHIRT = {
  cream: '#efede2',
  sand: '#e6d3b8',
  ice: '#cfd9e4',
  rose: '#d8c3c8',
  sage: '#c9d8c2',
  slate: '#b9c4d6',
} as const;
const TROUSER = {
  violet: '#9b8fc7',
  olive: '#8a9455',
  steel: '#7f8a9c',
  tan: '#b08b6a',
  navy: '#5f6b7a',
  clay: '#c2a2a8',
} as const;
const HAT = {
  straw: '#dcc177',
  red: '#c9584b',
  blue: '#7f9ec4',
  green: '#8fae7a',
  pale: '#e3ded0',
} as const;

// ---------------------------------------------------------------------------
// village_coast — doorsteps taken from PLACEMENTS in src/world/World.ts
// ---------------------------------------------------------------------------

/** Shared public places. Named so a change moves everybody who uses them. */
const V = {
  stall: { id: 'v_stall', x: 10, z: 14 },
  bench: { id: 'v_bench', x: -7, z: 55 },
  junction: { id: 'v_junction', x: 14, z: 8 },
  field: { id: 'v_field', x: 44, z: -8 },
  hill: { id: 'v_hill', x: 58, z: -32 },
  yard: { id: 'v_yard', x: -13, z: 30 },
  hall: { id: 'v_hall', x: 2, z: 22 },
  garage: { id: 'v_garage', x: 49, z: -16 },
} as const;

const village: NamedNpcDefinition[] = [
  {
    id: 'v_maryam',
    displayName: 'Maryam Haddad',
    zone: 'village_coast',
    role: 'shopkeeper',
    ageBand: 'adult',
    startAge: 44,
    appearance: { shirt: SHIRT.sand, trousers: TROUSER.olive, hat: HAT.straw, scale: 0.99, build: 'average' },
    anchors: {
      // HouseSolar's doorstep.
      home: { id: 'v_home_solar', x: -12.9, z: 42.6 },
      work: V.stall,
      leisure: V.bench,
      social: V.junction,
    },
    scheduleId: 'early_trade',
    initialRelationship: { familiarity: 0.55, trust: 0.4, affection: 0.3, respect: 0.35 },
    questRoles: ['grocery_employer', 'chapter2_first_pay'],
    inventoryHooks: ['grocery_bag', 'bread', 'coin_purse'],
    barkSet: 'trader',
    combatCapable: false,
  },
  {
    id: 'v_noor',
    displayName: 'Noor Haddad',
    zone: 'village_coast',
    role: 'student',
    ageBand: 'teen',
    startAge: 16,
    appearance: { shirt: SHIRT.rose, trousers: TROUSER.violet, hat: null, scale: 0.95, build: 'slight' },
    anchors: {
      // Maryam's daughter, so the same doorstep.
      home: { id: 'v_home_solar', x: -12.9, z: 42.6 },
      work: V.hall,
      leisure: V.bench,
      social: V.stall,
    },
    scheduleId: 'student',
    initialRelationship: { familiarity: 0.7, trust: 0.5, affection: 0.45, respect: 0.3 },
    questRoles: ['chapter2_friend', 'chapter3_choice'],
    inventoryHooks: ['notebook', 'cassette'],
    barkSet: 'friend',
    combatCapable: false,
  },
  {
    id: 'v_tomas',
    displayName: 'Tomás Ferreira',
    zone: 'village_coast',
    role: 'mechanic',
    ageBand: 'adult',
    startAge: 51,
    appearance: { shirt: SHIRT.slate, trousers: TROUSER.navy, hat: HAT.red, scale: 1.04, build: 'stocky' },
    anchors: {
      // HouseLarge on the side road.
      home: { id: 'v_home_sideroad', x: 55.4, z: -19.5 },
      work: V.garage,
      leisure: V.hill,
      social: V.junction,
    },
    scheduleId: 'early_trade',
    initialRelationship: { familiarity: 0.3, trust: 0.25, respect: 0.4 },
    questRoles: ['bicycle_repair', 'chapter3_mentor_trade'],
    inventoryHooks: ['spanner', 'bike_parts', 'vehicle_keys'],
    barkSet: 'gruff',
    combatCapable: false,
  },
  {
    id: 'v_bashir',
    displayName: 'Bashir Adeyemi',
    zone: 'village_coast',
    role: 'farmer',
    ageBand: 'adult',
    startAge: 46,
    appearance: { shirt: SHIRT.cream, trousers: TROUSER.tan, hat: HAT.straw, scale: 1.02, build: 'stocky' },
    anchors: {
      // The shed on the side road.
      home: { id: 'v_home_shed_east', x: 67.4, z: -37.9 },
      work: V.field,
      leisure: V.hill,
      social: V.junction,
    },
    scheduleId: 'shore_day',
    initialRelationship: { familiarity: 0.25, trust: 0.3 },
    questRoles: ['parcel_delivery', 'chapter6_land'],
    inventoryHooks: ['crate', 'produce_box'],
    barkSet: 'warm',
    combatCapable: false,
  },
  {
    id: 'v_eleni',
    displayName: 'Eleni Sarkis',
    zone: 'village_coast',
    role: 'teacher',
    ageBand: 'adult',
    startAge: 34,
    appearance: { shirt: SHIRT.ice, trousers: TROUSER.steel, hat: null, scale: 0.98, build: 'slight' },
    anchors: {
      // PorchHouse.
      home: { id: 'v_home_porch', x: 15.7, z: -1.5 },
      work: V.hall,
      leisure: V.bench,
      social: V.stall,
    },
    scheduleId: 'office_day',
    initialRelationship: { familiarity: 0.4, trust: 0.45, respect: 0.5 },
    questRoles: ['chapter1_keepsakes', 'chapter7_letter'],
    inventoryHooks: ['notebook', 'photograph'],
    barkSet: 'warm',
    combatCapable: false,
  },
  {
    id: 'v_gita',
    displayName: 'Gita Rao',
    zone: 'village_coast',
    role: 'homemaker',
    ageBand: 'adult',
    startAge: 39,
    appearance: { shirt: SHIRT.sage, trousers: TROUSER.clay, hat: null, scale: 0.97, build: 'average' },
    anchors: {
      // HouseSmall, south.
      home: { id: 'v_home_small_south', x: 15.2, z: -24.1 },
      work: { id: 'v_home_small_south', x: 15.2, z: -24.1 },
      leisure: V.yard,
      social: V.junction,
    },
    scheduleId: 'home_keeper',
    initialRelationship: { familiarity: 0.35, trust: 0.35, affection: 0.2 },
    questRoles: ['neighbour_errand'],
    inventoryHooks: ['grocery_bag', 'blanket'],
    barkSet: 'warm',
    combatCapable: false,
  },
  {
    id: 'v_hamid',
    displayName: 'Hamid Qureshi',
    zone: 'village_coast',
    role: 'retired',
    ageBand: 'elder',
    startAge: 71,
    appearance: { shirt: SHIRT.cream, trousers: TROUSER.steel, hat: HAT.pale, scale: 0.94, build: 'slight' },
    anchors: {
      // The shed by the hero row.
      home: { id: 'v_home_shed_west', x: -12.8, z: 32 },
      work: { id: 'v_home_shed_west', x: -12.8, z: 32 },
      leisure: V.bench,
      social: V.stall,
    },
    scheduleId: 'retired',
    initialRelationship: { familiarity: 0.5, trust: 0.55, respect: 0.6 },
    questRoles: ['chapter1_keepsakes', 'village_history'],
    inventoryHooks: ['photograph', 'radio'],
    barkSet: 'elder',
    combatCapable: false,
  },
  {
    id: 'v_liya',
    displayName: 'Liya Bekele',
    zone: 'village_coast',
    role: 'courier',
    ageBand: 'teen',
    startAge: 17,
    appearance: { shirt: SHIRT.slate, trousers: TROUSER.olive, hat: HAT.blue, scale: 0.96, build: 'slight' },
    anchors: {
      // HouseSmall, north — the enterable one.
      home: { id: 'v_home_small_north', x: 12.2, z: 32.5 },
      work: V.stall,
      leisure: V.junction,
      social: V.bench,
    },
    scheduleId: 'student',
    initialRelationship: { familiarity: 0.45, trust: 0.35, affection: 0.25 },
    questRoles: ['chapter2_deliveries', 'bicycle_rival'],
    inventoryHooks: ['parcel', 'bike_parts'],
    barkSet: 'friend',
    combatCapable: false,
  },
];

// ---------------------------------------------------------------------------
// city_old_market
// ---------------------------------------------------------------------------

const OM = {
  grocery: { id: 'om_grocery', x: 18, z: 20 },
  garage: { id: 'om_garage', x: -28, z: 14 },
  square: { id: 'om_square', x: 12, z: 26 },
  highStreet: { id: 'om_high_street', x: 0, z: 58 },
  parking: { id: 'om_parking', x: -30, z: 8 },
  cafe: { id: 'om_cafe', x: 22, z: 34 },
  office: { id: 'om_office', x: 24, z: 40 },
} as const;

const oldMarket: NamedNpcDefinition[] = [
  {
    id: 'c_yusuf',
    displayName: 'Yusuf Demir',
    zone: 'city_old_market',
    role: 'shopkeeper',
    ageBand: 'adult',
    startAge: 49,
    appearance: { shirt: SHIRT.sand, trousers: TROUSER.navy, hat: null, scale: 1.01, build: 'stocky' },
    anchors: {
      home: { id: 'om_home_yusuf', x: 30, z: 52 },
      work: OM.grocery,
      leisure: OM.square,
      social: OM.highStreet,
    },
    scheduleId: 'early_trade',
    questRoles: ['grocery_employer_city', 'chapter4_first_job'],
    inventoryHooks: ['grocery_bag', 'stock_crate'],
    barkSet: 'trader',
    combatCapable: false,
  },
  {
    id: 'c_priya',
    displayName: 'Priya Nair',
    zone: 'city_old_market',
    role: 'mechanic',
    ageBand: 'adult',
    startAge: 33,
    appearance: { shirt: SHIRT.slate, trousers: TROUSER.olive, hat: HAT.red, scale: 0.99, build: 'average' },
    anchors: {
      home: { id: 'om_home_priya', x: -40, z: 40 },
      work: OM.garage,
      leisure: OM.parking,
      social: OM.square,
    },
    scheduleId: 'early_trade',
    questRoles: ['garage_employer', 'vehicle_recovery'],
    inventoryHooks: ['spanner', 'vehicle_keys', 'paint_can'],
    barkSet: 'gruff',
    combatCapable: false,
  },
  {
    id: 'c_dawit',
    displayName: 'Dawit Mengistu',
    zone: 'city_old_market',
    role: 'clerk',
    ageBand: 'adult',
    startAge: 28,
    appearance: { shirt: SHIRT.cream, trousers: TROUSER.steel, hat: null, scale: 1.0, build: 'slight' },
    anchors: {
      home: { id: 'om_home_dawit', x: -44, z: 62 },
      work: OM.office,
      leisure: OM.highStreet,
      social: OM.square,
    },
    scheduleId: 'office_day',
    questRoles: ['paperwork', 'chapter5_contact'],
    inventoryHooks: ['documents', 'coin_purse'],
    barkSet: 'brisk',
    combatCapable: false,
  },
  {
    id: 'c_sana',
    displayName: 'Sana Iqbal',
    zone: 'city_old_market',
    role: 'barista',
    ageBand: 'adult',
    startAge: 24,
    appearance: { shirt: SHIRT.rose, trousers: TROUSER.clay, hat: HAT.pale, scale: 0.96, build: 'slight' },
    anchors: {
      home: { id: 'om_home_sana', x: 36, z: 10 },
      work: OM.cafe,
      leisure: OM.square,
      social: OM.highStreet,
    },
    scheduleId: 'early_trade',
    initialRelationship: { familiarity: 0.1 },
    questRoles: ['cafe_service', 'chapter5_relationship'],
    inventoryHooks: ['coffee', 'pastry'],
    barkSet: 'friend',
    combatCapable: false,
  },
  {
    id: 'c_george',
    displayName: 'George Anand',
    zone: 'city_old_market',
    role: 'retired',
    ageBand: 'elder',
    startAge: 68,
    appearance: { shirt: SHIRT.ice, trousers: TROUSER.tan, hat: HAT.straw, scale: 0.93, build: 'average' },
    anchors: {
      home: { id: 'om_home_george', x: -38, z: -20 },
      work: { id: 'om_home_george', x: -38, z: -20 },
      leisure: OM.square,
      social: OM.highStreet,
    },
    scheduleId: 'retired',
    questRoles: ['city_history', 'chapter6_witness'],
    inventoryHooks: ['newspaper', 'photograph'],
    barkSet: 'elder',
    combatCapable: false,
  },
];

// ---------------------------------------------------------------------------
// city_downtown
// ---------------------------------------------------------------------------

const DT = {
  police: { id: 'dt_police', x: 26, z: 150 },
  plaza: { id: 'dt_plaza', x: 20, z: 160 },
  north: { id: 'dt_north', x: 0, z: 206 },
  clinic: { id: 'dt_clinic', x: 34, z: 176 },
  school: { id: 'dt_school', x: -30, z: 178 },
  depot: { id: 'dt_depot', x: 20, z: 120 },
} as const;

const downtown: NamedNpcDefinition[] = [
  {
    id: 'c_amina',
    displayName: 'Amina Sesay',
    zone: 'city_downtown',
    role: 'officer',
    ageBand: 'adult',
    startAge: 36,
    appearance: { shirt: SHIRT.slate, trousers: TROUSER.navy, hat: HAT.blue, scale: 1.0, build: 'average' },
    anchors: {
      home: { id: 'dt_home_amina', x: -22, z: 142 },
      work: DT.police,
      leisure: DT.plaza,
      social: DT.north,
    },
    scheduleId: 'office_day',
    questRoles: ['police_desk', 'chapter6_law_route'],
    inventoryHooks: ['fine_notice', 'impound_slip'],
    barkSet: 'brisk',
    // Phase 9 owns arming anyone, including the officer.
    combatCapable: false,
  },
  {
    id: 'c_kenji',
    displayName: 'Kenji Watanabe',
    zone: 'city_downtown',
    role: 'nurse',
    ageBand: 'adult',
    startAge: 41,
    appearance: { shirt: SHIRT.cream, trousers: TROUSER.steel, hat: null, scale: 1.0, build: 'average' },
    anchors: {
      home: { id: 'dt_home_kenji', x: -26, z: 132 },
      work: DT.clinic,
      leisure: DT.plaza,
      social: DT.north,
    },
    scheduleId: 'night_shift',
    questRoles: ['clinic_recovery', 'chapter5_favour'],
    inventoryHooks: ['bandage', 'clinic_note'],
    barkSet: 'warm',
    combatCapable: false,
  },
  {
    id: 'c_rosa',
    displayName: 'Rosa Delgado',
    zone: 'city_downtown',
    role: 'teacher',
    ageBand: 'adult',
    startAge: 30,
    appearance: { shirt: SHIRT.sage, trousers: TROUSER.violet, hat: null, scale: 0.98, build: 'slight' },
    anchors: {
      home: { id: 'dt_home_rosa', x: -18, z: 146 },
      work: DT.school,
      leisure: DT.plaza,
      social: DT.north,
    },
    scheduleId: 'office_day',
    questRoles: ['chapter5_community', 'chapter6_petition'],
    inventoryHooks: ['notebook', 'documents'],
    barkSet: 'warm',
    combatCapable: false,
  },
  {
    id: 'c_omar',
    displayName: 'Omar Farouk',
    zone: 'city_downtown',
    role: 'courier',
    ageBand: 'adult',
    startAge: 22,
    appearance: { shirt: SHIRT.sand, trousers: TROUSER.olive, hat: HAT.green, scale: 1.01, build: 'slight' },
    anchors: {
      home: { id: 'dt_home_omar', x: -22, z: 138 },
      work: DT.depot,
      leisure: DT.plaza,
      social: DT.north,
    },
    scheduleId: 'office_day',
    questRoles: ['courier_chain', 'chapter5_shortcut'],
    inventoryHooks: ['parcel', 'scooter_keys'],
    barkSet: 'brisk',
    combatCapable: false,
  },
  {
    id: 'c_hana',
    displayName: 'Hana Kovač',
    zone: 'city_downtown',
    role: 'student',
    ageBand: 'teen',
    startAge: 17,
    appearance: { shirt: SHIRT.ice, trousers: TROUSER.clay, hat: null, scale: 0.95, build: 'slight' },
    anchors: {
      home: { id: 'dt_home_hana', x: -26, z: 144 },
      work: DT.school,
      leisure: DT.plaza,
      social: DT.north,
    },
    scheduleId: 'student',
    questRoles: ['chapter5_friend'],
    inventoryHooks: ['notebook', 'cassette'],
    barkSet: 'friend',
    combatCapable: false,
  },
];

// ---------------------------------------------------------------------------
// city_waterfront
// ---------------------------------------------------------------------------

const WF = {
  dock: { id: 'wf_dock', x: -24, z: -120 },
  promenade: { id: 'wf_promenade', x: 0, z: -78 },
  market: { id: 'wf_market', x: -20, z: -100 },
} as const;

const waterfront: NamedNpcDefinition[] = [
  {
    id: 'c_marcel',
    displayName: 'Marcel Dubois',
    zone: 'city_waterfront',
    role: 'dockhand',
    ageBand: 'adult',
    startAge: 44,
    appearance: { shirt: SHIRT.slate, trousers: TROUSER.tan, hat: HAT.red, scale: 1.05, build: 'stocky' },
    anchors: {
      home: { id: 'wf_home_marcel', x: -30, z: -78 },
      work: WF.dock,
      leisure: WF.promenade,
      social: WF.market,
    },
    scheduleId: 'shore_day',
    questRoles: ['dock_work', 'chapter6_cargo'],
    inventoryHooks: ['crate', 'rope'],
    barkSet: 'gruff',
    combatCapable: false,
  },
  {
    id: 'c_ines',
    displayName: 'Inês Cardoso',
    zone: 'city_waterfront',
    role: 'homemaker',
    ageBand: 'adult',
    startAge: 37,
    appearance: { shirt: SHIRT.rose, trousers: TROUSER.steel, hat: null, scale: 0.97, build: 'average' },
    anchors: {
      home: { id: 'wf_home_ines', x: -34, z: -84 },
      work: { id: 'wf_home_ines', x: -34, z: -84 },
      leisure: WF.promenade,
      social: WF.market,
    },
    scheduleId: 'home_keeper',
    questRoles: ['neighbour_errand_city'],
    inventoryHooks: ['grocery_bag', 'blanket'],
    barkSet: 'warm',
    combatCapable: false,
  },
];

export const NPC_CATALOGUE: readonly NamedNpcDefinition[] = [
  ...village,
  ...oldMarket,
  ...downtown,
  ...waterfront,
];

const BY_ID = new Map(NPC_CATALOGUE.map((n) => [n.id, n]));

export function npcById(id: string): NamedNpcDefinition | null {
  return BY_ID.get(id) ?? null;
}

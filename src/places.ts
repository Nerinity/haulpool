/**
 * Pickup points and storage facilities (spec §9.3 fallback: the platform's
 * openweathermap/geocoding resolves cities, not street addresses — tested 2026-11-19, 404).
 *
 * Coordinates: OpenStreetMap Nominatim, looked up 2026-11-19.
 * Storage prices: 10×10 street rates shown on RentCafe listings, Nov 2026 — a STARTING estimate;
 * the organizer types the real quote.
 *
 * Users pick the nearest building/neighborhood; the exact unit or entrance is a private note
 * only pool members see. Picking from a list also keeps exact home coordinates out of the system.
 */
export interface PlaceDef { key: string; label: string; lat: number; lng: number; kind: 'building' | 'neighborhood' }
export interface AreaDef { key: string; label: string; lat: number; lng: number }
export interface CityDef { key: string; label: string; lat: number; lng: number; areas: AreaDef[] }
export interface StorageDef { key: string; label: string; address: string; lat: number; lng: number; tenByTenCents: number }

export const PICKUP_PLACES: PlaceDef[] = [
  { key: 'cmu', label: 'CMU campus (Forbes Ave)', lat: 40.44392, lng: -79.94283, kind: 'building' },
  { key: 'morewood', label: 'Morewood Gardens', lat: 40.44554, lng: -79.94323, kind: 'building' },
  { key: 'stever', label: 'Stever House', lat: 40.44627, lng: -79.94267, kind: 'building' },
  { key: 'mudge', label: 'Mudge House', lat: 40.44692, lng: -79.94268, kind: 'building' },
  { key: 'fifth-clyde', label: 'Fifth and Clyde', lat: 40.4476, lng: -79.94569, kind: 'building' },
  { key: 'webster', label: 'Webster Hall', lat: 40.44713, lng: -79.95124, kind: 'building' },
  { key: 'amberson', label: 'Amberson Plaza', lat: 40.45381, lng: -79.94299, kind: 'building' },
  { key: 'pitt-cathedral', label: 'Pitt, Cathedral of Learning area', lat: 40.4443, lng: -79.95319, kind: 'building' },
  { key: 'n-oakland', label: 'North Oakland', lat: 40.44704, lng: -79.95336, kind: 'neighborhood' },
  { key: 'c-oakland', label: 'Central Oakland', lat: 40.43862, lng: -79.95466, kind: 'neighborhood' },
  { key: 's-oakland', label: 'South Oakland', lat: 40.43326, lng: -79.95987, kind: 'neighborhood' },
  { key: 'shadyside', label: 'Shadyside', lat: 40.45152, lng: -79.93655, kind: 'neighborhood' },
  { key: 'sqh-north', label: 'Squirrel Hill North', lat: 40.44352, lng: -79.93076, kind: 'neighborhood' },
  { key: 'sqh-south', label: 'Squirrel Hill South', lat: 40.42839, lng: -79.91728, kind: 'neighborhood' },
  { key: 'bloomfield', label: 'Bloomfield', lat: 40.46176, lng: -79.94955, kind: 'neighborhood' },
  { key: 'lawrenceville', label: 'Lower Lawrenceville', lat: 40.46451, lng: -79.9644, kind: 'neighborhood' },
  { key: 'east-liberty', label: 'East Liberty', lat: 40.46207, lng: -79.92395, kind: 'neighborhood' },
  { key: 'greenfield', label: 'Greenfield', lat: 40.42165, lng: -79.94363, kind: 'neighborhood' },
  // Added 11/19 (round 3). Approximate centers (±0.3 mi) — fine for matching, which rounds to 0.5 mi.
  { key: 'pitt-towers', label: 'Pitt, Litchfield Towers', lat: 40.4425, lng: -79.9563, kind: 'building' },
  { key: 'pitt-sutherland', label: 'Pitt, Sutherland Hall (upper campus)', lat: 40.4458, lng: -79.9637, kind: 'building' },
  { key: 'pitt-nordenberg', label: 'Pitt, Nordenberg Hall', lat: 40.4436, lng: -79.9575, kind: 'building' },
  { key: 'carlow', label: 'Carlow University', lat: 40.4404, lng: -79.9644, kind: 'building' },
  { key: 'duquesne', label: 'Duquesne University', lat: 40.4363, lng: -79.991, kind: 'building' },
  { key: 'chatham', label: 'Chatham University', lat: 40.4486, lng: -79.9238, kind: 'building' },
  { key: 'point-park', label: 'Point Park University', lat: 40.4387, lng: -80.0019, kind: 'building' },
  { key: 'downtown', label: 'Downtown', lat: 40.4406, lng: -79.9959, kind: 'neighborhood' },
  { key: 'strip-district', label: 'Strip District', lat: 40.4517, lng: -79.9806, kind: 'neighborhood' },
  { key: 'polish-hill', label: 'Polish Hill', lat: 40.4558, lng: -79.9665, kind: 'neighborhood' },
  { key: 'upper-lawrenceville', label: 'Upper Lawrenceville', lat: 40.476, lng: -79.956, kind: 'neighborhood' },
  { key: 'friendship', label: 'Friendship', lat: 40.456, lng: -79.937, kind: 'neighborhood' },
  { key: 'garfield', label: 'Garfield', lat: 40.463, lng: -79.937, kind: 'neighborhood' },
  { key: 'highland-park', label: 'Highland Park', lat: 40.477, lng: -79.915, kind: 'neighborhood' },
  { key: 'morningside', label: 'Morningside', lat: 40.484, lng: -79.93, kind: 'neighborhood' },
  { key: 'point-breeze', label: 'Point Breeze', lat: 40.444, lng: -79.902, kind: 'neighborhood' },
  { key: 'regent-square', label: 'Regent Square', lat: 40.432, lng: -79.896, kind: 'neighborhood' },
  { key: 'wilkinsburg', label: 'Wilkinsburg', lat: 40.442, lng: -79.882, kind: 'neighborhood' },
  { key: 'hazelwood', label: 'Hazelwood', lat: 40.41, lng: -79.945, kind: 'neighborhood' },
  { key: 'south-side-flats', label: 'South Side Flats', lat: 40.4285, lng: -79.9772, kind: 'neighborhood' },
  { key: 'mt-washington', label: 'Mount Washington', lat: 40.431, lng: -80.008, kind: 'neighborhood' },
  { key: 'north-shore', label: 'North Shore', lat: 40.447, lng: -80.008, kind: 'neighborhood' },
  { key: 'brookline', label: 'Brookline', lat: 40.394, lng: -80.017, kind: 'neighborhood' },
  { key: 'dormont', label: 'Dormont', lat: 40.396, lng: -80.033, kind: 'neighborhood' },
]

export const STORAGE_PLACES: StorageDef[] = [
  { key: 'st-extra-sawmill', label: 'Extra Space Storage — Saw Mill Run', address: '880 Saw Mill Run Blvd', lat: 40.41161, lng: -80.00703, tenByTenCents: 13400 },
  { key: 'st-keep-springgarden', label: 'Keep Self Storage — Spring Garden', address: '1414 Spring Garden Ave', lat: 40.46224, lng: -79.98726, tenByTenCents: 9000 },
  { key: 'st-storexpress-22nd', label: 'STORExpress — South Side', address: '200 S 22nd St', lat: 40.4256, lng: -79.97503, tenByTenCents: 13900 },
  { key: 'st-stash-26th', label: 'Stash & Store — South Side', address: '157 S 26th St', lat: 40.42898, lng: -79.96767, tenByTenCents: 14000 },
  { key: 'st-extra-braddock', label: 'Extra Space Storage — Point Breeze', address: '141 N Braddock Ave', lat: 40.44737, lng: -79.89513, tenByTenCents: 12100 },
  { key: 'st-citycenter', label: 'City Center Self Storage', address: '20 S 4th St', lat: 40.42966, lng: -79.99601, tenByTenCents: 14500 },
]

export const pickupByKey = (k: string) => PICKUP_PLACES.find((p) => p.key === k)
export const storageByKey = (k: string) => STORAGE_PLACES.find((p) => p.key === k)

/** Home city. Its areas are PICKUP_PLACES (keys stay unprefixed for old drafts). */
export const HOME_CITY_KEY = 'pittsburgh'

const a = (city: string, key: string, label: string, lat: number, lng: number): AreaDef => ({ key: `${city}:${key}`, label, lat, lng })

/**
 * Popular city-to-city destinations (and origins) with a few areas each.
 * Approximate area centers (±0.5 mi). Any other US city works through the
 * openweathermap/geocoding integration as "Anywhere in <city>" (src/actions findCity).
 */
export const CITIES: CityDef[] = [
  { key: HOME_CITY_KEY, label: 'Pittsburgh, PA', lat: 40.4406, lng: -79.9959, areas: PICKUP_PLACES.map(({ key, label, lat, lng }) => ({ key, label, lat, lng })) },
  { key: 'nyc', label: 'New York, NY', lat: 40.7128, lng: -74.006, areas: [
    a('nyc', 'midtown', 'Midtown Manhattan', 40.7549, -73.984), a('nyc', 'uws', 'Upper West Side', 40.787, -73.9754),
    a('nyc', 'columbia', 'Morningside Heights (Columbia)', 40.8075, -73.9626), a('nyc', 'les', 'Lower East Side', 40.715, -73.9843),
    a('nyc', 'williamsburg', 'Williamsburg, Brooklyn', 40.7081, -73.9571), a('nyc', 'astoria', 'Astoria, Queens', 40.7644, -73.9235),
    a('nyc', 'jersey-city', 'Jersey City, NJ', 40.7178, -74.0431),
  ] },
  { key: 'philly', label: 'Philadelphia, PA', lat: 39.9526, lng: -75.1652, areas: [
    a('philly', 'center', 'Center City', 39.9526, -75.1652), a('philly', 'ucity', 'University City (Penn, Drexel)', 39.9522, -75.1932),
    a('philly', 'fishtown', 'Fishtown', 39.9718, -75.134), a('philly', 'south', 'South Philly', 39.925, -75.169),
  ] },
  { key: 'dc', label: 'Washington, DC', lat: 38.9072, lng: -77.0369, areas: [
    a('dc', 'dupont', 'Dupont Circle', 38.9096, -77.0434), a('dc', 'foggy', 'Foggy Bottom (GWU)', 38.9007, -77.05),
    a('dc', 'capitol-hill', 'Capitol Hill', 38.8899, -76.9905), a('dc', 'arlington', 'Arlington, VA', 38.8816, -77.091),
  ] },
  { key: 'baltimore', label: 'Baltimore, MD', lat: 39.2904, lng: -76.6122, areas: [
    a('baltimore', 'harbor', 'Inner Harbor', 39.2857, -76.6081), a('baltimore', 'jhu', 'Charles Village (JHU)', 39.3289, -76.6205),
    a('baltimore', 'fells', 'Fells Point', 39.2826, -76.5918),
  ] },
  { key: 'boston', label: 'Boston, MA', lat: 42.3601, lng: -71.0589, areas: [
    a('boston', 'backbay', 'Back Bay', 42.3503, -71.081), a('boston', 'cambridge', 'Cambridge (Harvard, MIT)', 42.3736, -71.1097),
    a('boston', 'allston', 'Allston', 42.3539, -71.1337), a('boston', 'fenway', 'Fenway', 42.3467, -71.0972),
  ] },
  { key: 'chicago', label: 'Chicago, IL', lat: 41.8781, lng: -87.6298, areas: [
    a('chicago', 'loop', 'The Loop', 41.8837, -87.6289), a('chicago', 'lincoln-park', 'Lincoln Park', 41.9214, -87.6513),
    a('chicago', 'hyde-park', 'Hyde Park (UChicago)', 41.7943, -87.5907), a('chicago', 'evanston', 'Evanston', 42.0451, -87.6877),
  ] },
  { key: 'cleveland', label: 'Cleveland, OH', lat: 41.4993, lng: -81.6944, areas: [
    a('cleveland', 'downtown', 'Downtown', 41.4993, -81.6944), a('cleveland', 'ucircle', 'University Circle (CWRU)', 41.5068, -81.6052),
  ] },
  { key: 'columbus', label: 'Columbus, OH', lat: 39.9612, lng: -82.9988, areas: [
    a('columbus', 'downtown', 'Downtown', 39.9612, -82.9988), a('columbus', 'osu', 'Ohio State campus', 40.0067, -83.0305),
  ] },
  { key: 'state-college', label: 'State College, PA', lat: 40.7934, lng: -77.86, areas: [
    a('state-college', 'psu', 'Penn State campus', 40.7982, -77.8599),
  ] },
  { key: 'ann-arbor', label: 'Ann Arbor, MI', lat: 42.2808, lng: -83.743, areas: [
    a('ann-arbor', 'umich', 'University of Michigan', 42.278, -83.7382),
  ] },
  { key: 'atlanta', label: 'Atlanta, GA', lat: 33.749, lng: -84.388, areas: [
    a('atlanta', 'midtown', 'Midtown (Georgia Tech)', 33.7838, -84.383), a('atlanta', 'downtown', 'Downtown', 33.749, -84.388),
  ] },
  { key: 'austin', label: 'Austin, TX', lat: 30.2672, lng: -97.7431, areas: [
    a('austin', 'downtown', 'Downtown', 30.2672, -97.7431), a('austin', 'west-campus', 'West Campus (UT)', 30.2849, -97.7451),
  ] },
  { key: 'seattle', label: 'Seattle, WA', lat: 47.6062, lng: -122.3321, areas: [
    a('seattle', 'capitol-hill', 'Capitol Hill', 47.6253, -122.3222), a('seattle', 'udistrict', 'University District (UW)', 47.6615, -122.3138),
    a('seattle', 'slu', 'South Lake Union', 47.6256, -122.3344), a('seattle', 'bellevue', 'Bellevue', 47.6101, -122.2015),
  ] },
  { key: 'bay-area', label: 'San Francisco Bay Area, CA', lat: 37.7749, lng: -122.4194, areas: [
    a('bay-area', 'soma', 'SoMa, San Francisco', 37.7785, -122.4056), a('bay-area', 'mission', 'Mission, San Francisco', 37.7599, -122.4148),
    a('bay-area', 'palo-alto', 'Palo Alto', 37.4419, -122.143), a('bay-area', 'mountain-view', 'Mountain View', 37.3861, -122.0839),
  ] },
  { key: 'la', label: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437, areas: [
    a('la', 'westwood', 'Westwood (UCLA)', 34.0635, -118.4455), a('la', 'dtla', 'Downtown LA', 34.0407, -118.2468),
    a('la', 'santa-monica', 'Santa Monica', 34.0195, -118.4912),
  ] },
]

export const cityByKey = (k: string) => CITIES.find((c) => c.key === k)

/** Find any known place by key: a Pittsburgh spot, a storage unit, or a "city:area". */
export function placeByKey(k: string): { key: string; label: string; lat: number; lng: number; cityKey: string; cityLabel: string } | undefined {
  const st = storageByKey(k)
  if (st) return { key: st.key, label: st.label, lat: st.lat, lng: st.lng, cityKey: HOME_CITY_KEY, cityLabel: 'Pittsburgh, PA' }
  for (const c of CITIES) {
    const ar = c.areas.find((x) => x.key === k)
    if (ar) return { ...ar, cityKey: c.key, cityLabel: c.label }
  }
  return undefined
}

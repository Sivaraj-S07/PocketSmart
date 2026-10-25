/**
 * Post-processing applied to every plan (Gemini or offline).
 *
 * Adds per-item `search_terms` and `shopping_links` for the right Indian platforms, a
 * `calculation_table`, `total_budget` and `remaining_budget`.  Only platforms from the
 * whitelist below ever become links, so model output can never inject arbitrary URLs.
 */

export const PLATFORM_URLS = {
  Amazon: 'https://www.amazon.in/s?k={q}',
  Flipkart: 'https://www.flipkart.com/search?q={q}',
  IKEA: 'https://www.ikea.com/in/en/search/?q={q}',
  Pepperfry: 'https://www.pepperfry.com/catalogsearch/result/?q={q}',
  Myntra: 'https://www.myntra.com/{slug}?rawQuery={q}',
  Ajio: 'https://www.ajio.com/search/?text={q}',
  Meesho: 'https://www.meesho.com/search?q={q}',
  Swiggy: 'https://www.swiggy.com/search?query={q}',
  Zomato: 'https://www.zomato.com/search?q={q}',
  BookMyShow: 'https://in.bookmyshow.com/search?q={q}',
  Google: 'https://www.google.com/search?q={q}',
  Booking: 'https://www.booking.com/searchresults.html?ss={q}',
  MakeMyTrip: 'https://www.makemytrip.com/hotels/hotel-listing/?searchText={q}',
  OYO: 'https://www.oyorooms.com/search?location={q}',
  NoBroker: 'https://www.nobroker.in/property/search?searchTerm={q}',
  Bluestone: 'https://www.bluestone.com/search.html?query={q}',
  Tanishq: 'https://www.tanishq.co.in/search?q={q}',
  CaratLane: 'https://www.caratlane.com/search?q={q}',
  Melorra: 'https://www.melorra.com/search?q={q}',
};
const CANONICAL = new Map(Object.keys(PLATFORM_URLS).map((name) => [name.toLowerCase(), name]));

export const DEFAULT_HOME_PLATFORMS = ['Amazon', 'Flipkart', 'IKEA'];
export const DEFAULT_JEWELRY_PLATFORMS = ['Amazon', 'Flipkart', 'Bluestone', 'Tanishq', 'CaratLane', 'Melorra'];
export const VENUE_PLATFORMS = ['Google', 'Booking', 'MakeMyTrip', 'OYO', 'NoBroker'];

// Party category keyword -> platforms (SRS: "category_platforms" mapping).
const PARTY_RULES = [
  [['venue'], VENUE_PLATFORMS],
  [['cater', 'food', 'drink'], ['Swiggy', 'Zomato']],
  [['cake', 'sweet'], ['Swiggy', 'Zomato', 'Amazon']],
  [['decor'], ['Amazon', 'Flipkart', 'Meesho', 'Myntra']],
  [['entertain', 'music', 'game'], ['BookMyShow', 'Amazon', 'Flipkart']],
  [['photo'], ['Google', 'Amazon', 'Flipkart']],
  [['gift'], ['Amazon', 'Flipkart', 'Myntra', 'Meesho']],
  [['accessor', 'cloth', 'outfit'], ['Amazon', 'Flipkart', 'Myntra', 'Meesho']],
  [['transport'], ['MakeMyTrip', 'Google']],
];
const DEFAULT_PARTY_PLATFORMS = ['Amazon', 'Flipkart', 'Google'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Best-effort number: accepts numbers and strings like "₹1,200". Anything else is 0. */
export function num(value) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') n = Number(value.replace(/[^0-9.\-]/g, ''));
  else return 0;
  return Number.isFinite(n) ? n : 0;
}

const round = (value, digits) => Number(value.toFixed(digits));

/** Python's urllib.parse.quote_plus: spaces become "+", everything but A-Za-z0-9_.-~ is escaped. */
export function quotePlus(text) {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

/** Keep only whitelisted platform labels, canonically spelled, in order. */
export function knownPlatforms(requested) {
  if (!Array.isArray(requested)) return [];
  const labels = [];
  for (const value of requested) {
    const canonical = CANONICAL.get(String(value).trim().toLowerCase());
    if (canonical && !labels.includes(canonical)) labels.push(canonical);
  }
  return labels;
}

export function buildLinks(terms, platforms) {
  const trimmed = (terms || '').trim().slice(0, 120);
  if (!trimmed) return {};
  const encoded = quotePlus(trimmed);
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'search';
  const links = {};
  for (const platform of platforms) {
    if (platform in PLATFORM_URLS) links[platform] = PLATFORM_URLS[platform].replaceAll('{q}', encoded).replaceAll('{slug}', slug);
  }
  return links;
}

function partyPlatforms(categoryName) {
  const lowered = categoryName.toLowerCase();
  for (const [keywords, platforms] of PARTY_RULES) {
    if (keywords.some((k) => lowered.includes(k))) return platforms;
  }
  return DEFAULT_PARTY_PLATFORMS;
}

/** Normalise price aliases and return the item's search terms. */
function prepareItem(item, defaultTerms) {
  item.price = num(item.price ?? item.estimated_price);
  item.estimated_price = item.price;
  let terms = typeof item.search_terms === 'string' && item.search_terms.trim() ? item.search_terms.trim() : defaultTerms;
  item.search_terms = terms.slice(0, 120);
  return item.search_terms;
}

export function enrich(category, result, data) {
  const budget = num(data.budget);
  result.total_budget = budget;

  if (category === 'jewelry') {
    const platforms = knownPlatforms(data.platforms);
    const chosen = platforms.length ? platforms : DEFAULT_JEWELRY_PLATFORMS;
    let spent = 0;
    for (const item of Array.isArray(result.jewelry) ? result.jewelry : []) {
      if (!isObject(item)) continue;
      const name = String(item.name || item.type || 'jewelry');
      const terms = prepareItem(item, `${name} jewellery`);
      item.shopping_links = buildLinks(terms, chosen);
      spent += item.price;
    }
    result.remaining_budget = round(Math.max(budget - spent, 0), 2);
    return result;
  }

  const requested = knownPlatforms(data.platforms);
  const platforms = requested.length ? requested : DEFAULT_HOME_PLATFORMS;
  const table = [];
  let allocated = 0;
  for (const cat of Array.isArray(result.categories) ? result.categories : []) {
    if (!isObject(cat)) continue;
    const catName = String(cat.name || 'Misc');
    const items = (Array.isArray(cat.items) ? cat.items : []).filter(isObject);
    cat.items = items;
    let cost = 0;
    for (const item of items) {
      const terms = prepareItem(item, String(item.name || catName));
      const quantity = num(item.quantity) || 1;
      item.quantity = quantity;
      cost += item.price * quantity;
      item.shopping_links = buildLinks(terms, category === 'home' ? platforms : partyPlatforms(catName));
    }
    const allocation = num(cat.allocation);
    allocated += allocation;
    table.push({
      category: catName,
      items_count: items.length,
      allocation,
      total_cost: round(cost, 2),
      percentage_of_budget: budget ? round((allocation / budget) * 100, 1) : 0,
    });
  }
  result.calculation_table = table;
  result.remaining_budget = round(Math.max(budget - allocated, 0), 2);

  if (category === 'party') {
    for (const venue of Array.isArray(result.venues) ? result.venues : []) {
      if (!isObject(venue)) continue;
      const terms = [venue.name, venue.location].filter(Boolean).map(String).join(' ');
      venue.search_terms = terms.slice(0, 120);
      venue.search_links = buildLinks(terms, VENUE_PLATFORMS);
    }
  }
  return result;
}

// Price, stock and the featured flag are generated demo data: neither Open Library nor
// Gutenberg has them. Everything here is deterministic, so building the catalog twice gives
// exactly the same result. Prices are integer paise (49900 means ₹499).

const PRICE_STEPS = Object.freeze([19900, 24900, 29900, 34900, 39900, 49900, 59900, 79900]);
// Free-to-read public-domain books are priced lower, like a cheap print edition.
const FREE_BOOK_PRICES = Object.freeze([9900, 12900, 14900, 17900, 19900]);
const PREMIUM_PRICES = Object.freeze([119900, 149900]); // above ₹999, so shipping is free

// FNV-1a: a small, stable 32-bit hash of a string.
function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// mulberry32: a tiny seeded random generator. Same seed text, same sequence of numbers.
function seededRandom(seedText) {
  let state = hashString(seedText);
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sourceKey = (book) => `${book.source.provider}:${book.source.externalId}`;

// Best books first: real description, then popularity rank, then title.
function compareForFeatured(a, b) {
  return (
    Number(b.hasRealDescription) - Number(a.hasRealDescription) ||
    a.rank - b.rank ||
    a.title.localeCompare(b.title)
  );
}

// One book per category first, then more of the best remaining ones (at most two per category).
function pickFeatured(books, count) {
  const ranked = [...books].sort(compareForFeatured);
  const picked = new Set();
  const perCategory = new Map();
  const maxPerCategory = 2;

  for (const limit of [1, maxPerCategory]) {
    for (const book of ranked) {
      if (picked.size >= count) break;
      const used = perCategory.get(book.category) || 0;
      if (picked.has(book) || used >= limit) continue;
      picked.add(book);
      perCategory.set(book.category, used + 1);
    }
  }
  return picked;
}

/**
 * Adds pricePaise, stock and isFeatured to every book.
 *  - price and stock come from a generator seeded with the book's source id
 *  - about `featuredCount` books are featured, spread across categories, and always in stock
 *  - a few books are forced into edge cases so the shop and checkout are easy to test:
 *    3 out of stock, 3 with a single copy left, 2 priced above ₹999
 */
function addDemoValues(books, { featuredCount = 12 } = {}) {
  const withBasics = books.map((book) => {
    const random = seededRandom(sourceKey(book));
    const prices = book.readUrl ? FREE_BOOK_PRICES : PRICE_STEPS;
    return {
      ...book,
      pricePaise: prices[Math.floor(random() * prices.length)],
      stock: Math.floor(random() * 26),
      isFeatured: false,
    };
  });

  const featured = pickFeatured(withBasics, featuredCount);
  for (const book of featured) {
    book.isFeatured = true;
    book.stock = Math.max(book.stock, 5);
  }

  // Edge cases come from books that are not featured, in a stable hash order.
  const candidates = withBasics
    .filter((book) => !book.isFeatured)
    .sort((a, b) => hashString(sourceKey(a)) - hashString(sourceKey(b)));

  candidates.slice(0, 3).forEach((book) => {
    book.stock = 0;
  });
  candidates.slice(3, 6).forEach((book) => {
    book.stock = 1;
  });
  candidates
    .slice(6)
    .filter((book) => !book.readUrl)
    .slice(0, PREMIUM_PRICES.length)
    .forEach((book, index) => {
      book.pricePaise = PREMIUM_PRICES[index];
    });

  return withBasics;
}

module.exports = {
  addDemoValues,
  hashString,
  seededRandom,
  PRICE_STEPS,
  FREE_BOOK_PRICES,
  PREMIUM_PRICES,
};

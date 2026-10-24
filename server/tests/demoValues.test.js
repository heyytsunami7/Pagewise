import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  addDemoValues,
  hashString,
  seededRandom,
  PRICE_STEPS,
  FREE_BOOK_PRICES,
  PREMIUM_PRICES,
} = require("../scripts/lib/demoValues");
const { CATEGORIES, FREE_SHIPPING_THRESHOLD_PAISE } = require("../src/constants");

// Books as they come out of mergeCatalog: every fifth one is a free-to-read Gutenberg book.
const makeBook = (i, overrides = {}) => ({
  title: `Book ${String(i).padStart(3, "0")}`,
  category: CATEGORIES[i % CATEGORIES.length],
  hasRealDescription: i % 3 !== 0,
  rank: i % 7,
  source: { provider: i % 5 === 0 ? "gutendex" : "openlibrary", externalId: `id-${i}` },
  ...(i % 5 === 0 ? { readUrl: `https://www.gutenberg.org/ebooks/${i}.html.images` } : {}),
  ...overrides,
});
const makeBooks = (count) => Array.from({ length: count }, (_, i) => makeBook(i));

describe("hashString", () => {
  it("is stable, unsigned and different for different text", () => {
    expect(hashString("")).toBe(2166136261);
    expect(hashString("a")).toBe(3826002220);
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    for (const text of ["x", "hello world", "openlibrary:/works/OL1W"]) {
      const hash = hashString(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(4294967296);
    }
  });
});

describe("seededRandom", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = seededRandom("seed");
    const b = seededRandom("seed");
    const first = Array.from({ length: 5 }, () => a());
    const second = Array.from({ length: 5 }, () => b());
    expect(first).toEqual(second);
  });

  it("gives different sequences for different seeds", () => {
    expect(seededRandom("one")()).not.toBe(seededRandom("two")());
  });

  it("stays between 0 and 1", () => {
    const random = seededRandom("range");
    for (let i = 0; i < 1000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("addDemoValues", () => {
  it("is deterministic", () => {
    const books = makeBooks(100);
    expect(addDemoValues(books)).toEqual(addDemoValues(books));
  });

  it("does not change the books it is given", () => {
    const books = makeBooks(20);
    addDemoValues(books);
    for (const book of books) {
      expect("pricePaise" in book).toBe(false);
      expect("stock" in book).toBe(false);
      expect("isFeatured" in book).toBe(false);
    }
  });

  it("uses only the allowed integer prices in paise", () => {
    for (const book of addDemoValues(makeBooks(100))) {
      expect(Number.isInteger(book.pricePaise)).toBe(true);
      const allowed = book.readUrl ? FREE_BOOK_PRICES : [...PRICE_STEPS, ...PREMIUM_PRICES];
      expect(allowed).toContain(book.pricePaise);
    }
  });

  it("prices free-to-read books low and never above the free-shipping threshold", () => {
    const free = addDemoValues(makeBooks(100)).filter((book) => book.readUrl);
    expect(free.length).toBeGreaterThan(0);
    for (const book of free) {
      expect(FREE_BOOK_PRICES).toContain(book.pricePaise);
    }
  });

  it("gives every book a whole-number stock from 0 to 25", () => {
    for (const book of addDemoValues(makeBooks(100))) {
      expect(Number.isInteger(book.stock)).toBe(true);
      expect(book.stock).toBeGreaterThanOrEqual(0);
      expect(book.stock).toBeLessThanOrEqual(25);
    }
  });

  it("does not depend on titles when nothing is featured", () => {
    const books = makeBooks(60);
    const renamed = books.map((book, i) => ({ ...book, title: `Renamed ${60 - i}` }));
    const a = addDemoValues(books, { featuredCount: 0 });
    const b = addDemoValues(renamed, { featuredCount: 0 });
    expect(a.map((book) => [book.pricePaise, book.stock])).toEqual(
      b.map((book) => [book.pricePaise, book.stock]),
    );
  });

  it("features 12 books spread over the categories, always in stock", () => {
    const featured = addDemoValues(makeBooks(100)).filter((book) => book.isFeatured);
    expect(featured).toHaveLength(12);

    const perCategory = {};
    for (const book of featured) perCategory[book.category] = (perCategory[book.category] || 0) + 1;
    expect(Object.keys(perCategory)).toHaveLength(CATEGORIES.length);
    for (const count of Object.values(perCategory)) {
      expect(count).toBeLessThanOrEqual(2);
    }
    for (const book of featured) {
      expect(book.stock).toBeGreaterThanOrEqual(5);
    }
  });

  it("respects featuredCount and short lists", () => {
    const countFeatured = (books, options) =>
      addDemoValues(books, options).filter((book) => book.isFeatured).length;
    expect(countFeatured(makeBooks(100), { featuredCount: 3 })).toBe(3);
    expect(countFeatured(makeBooks(100), { featuredCount: 0 })).toBe(0);
    expect(countFeatured(makeBooks(4))).toBe(4);
    expect(addDemoValues([])).toEqual([]);
  });

  it("features books with a real description first, then the better rank", () => {
    const books = [
      makeBook(1, { category: "Mystery", hasRealDescription: false, rank: 0, title: "No blurb" }),
      makeBook(2, {
        category: "Mystery",
        hasRealDescription: true,
        rank: 5,
        title: "Blurb, low rank",
      }),
      makeBook(3, {
        category: "Mystery",
        hasRealDescription: true,
        rank: 1,
        title: "Blurb, high rank",
      }),
    ];
    const featured = addDemoValues(books, { featuredCount: 1 }).filter((book) => book.isFeatured);
    expect(featured.map((book) => book.title)).toEqual(["Blurb, high rank"]);
  });

  it("forces the edge cases the shop and checkout need for testing", () => {
    const books = addDemoValues(makeBooks(100));
    expect(books.filter((book) => book.stock === 0).length).toBeGreaterThanOrEqual(3);
    expect(books.filter((book) => book.stock === 1).length).toBeGreaterThanOrEqual(3);

    const premium = books.filter((book) => book.pricePaise > FREE_SHIPPING_THRESHOLD_PAISE);
    expect(premium).toHaveLength(2);
    for (const book of premium) {
      expect(PREMIUM_PRICES).toContain(book.pricePaise);
      expect(book.readUrl).toBeUndefined();
    }
  });

  it("never features a book that is out of stock or nearly out", () => {
    for (const book of addDemoValues(makeBooks(100)).filter((b) => b.isFeatured)) {
      expect(book.stock).toBeGreaterThan(1);
    }
  });

  it("still works when there are too few books for every edge case", () => {
    const books = addDemoValues(makeBooks(14));
    expect(books).toHaveLength(14);
    expect(books.filter((book) => book.stock === 0).length).toBeGreaterThanOrEqual(1);
  });
});

describe("price tables", () => {
  it("keeps normal prices under the free-shipping threshold and premium prices above it", () => {
    for (const price of [...PRICE_STEPS, ...FREE_BOOK_PRICES]) {
      expect(Number.isInteger(price)).toBe(true);
      expect(price).toBeLessThanOrEqual(FREE_SHIPPING_THRESHOLD_PAISE);
    }
    for (const price of PREMIUM_PRICES) {
      expect(Number.isInteger(price)).toBe(true);
      expect(price).toBeGreaterThan(FREE_SHIPPING_THRESHOLD_PAISE);
    }
  });

  it("lists prices in ascending order", () => {
    for (const table of [PRICE_STEPS, FREE_BOOK_PRICES, PREMIUM_PRICES]) {
      expect([...table]).toEqual([...table].sort((a, b) => a - b));
    }
  });
});

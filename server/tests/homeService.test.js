import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { startTestDb } from "./helpers.js";

const require = createRequire(import.meta.url);
const {
  featuredBooks,
  newArrivals,
  bestSellers,
  categoryCounts,
  publicStats,
} = require("../src/services/home");
const { CATEGORIES } = require("../src/constants");

const day = (n) => new Date(Date.UTC(2026, 0, n));

const SHELF = [
  { title: "Alpha", category: "Fiction", isFeatured: true, createdAt: day(1) },
  { title: "Bravo", category: "Mystery", isFeatured: false, createdAt: day(2) },
  { title: "Charlie", category: "Mystery", isFeatured: false, createdAt: day(3) },
  {
    title: "Delta",
    category: "History",
    isFeatured: false,
    createdAt: day(4),
    readUrl: "https://www.gutenberg.org/ebooks/1.html.images",
  },
  {
    title: "Echo",
    category: "Fiction",
    isFeatured: true,
    createdAt: day(5),
    readUrl: "https://www.gutenberg.org/ebooks/2.html.images",
  },
  { title: "Foxtrot", category: "Horror", isFeatured: false, createdAt: day(6) },
  { title: "Archived", category: "Fiction", isFeatured: true, isActive: false, createdAt: day(7) },
];

let ctx;
let byTitle;

const titles = (list) => list.map((book) => book.title);

let orderCount = 0;
const order = (status, items) => {
  orderCount += 1;
  return {
    orderNumber: `BS-TEST-${orderCount}`,
    status,
    items: items.map(([title, qty]) => ({ bookId: byTitle[title], qty })),
  };
};

beforeAll(async () => {
  ctx = await startTestDb();
  const result = await ctx.db.collection("books").insertMany(
    SHELF.map((book, i) => ({
      isActive: true,
      authors: ["Someone"],
      description: "A book.",
      subjects: [],
      coverUrl: `https://covers.openlibrary.org/b/id/${i + 1}-L.jpg`,
      pricePaise: 29900,
      stock: 5,
      source: { provider: "openlibrary", externalId: `/works/OL${i + 1}W` },
      updatedAt: book.createdAt,
      ...book,
    })),
  );
  byTitle = Object.fromEntries(SHELF.map((book, i) => [book.title, result.insertedIds[i]]));
}, 120000);

afterAll(async () => {
  if (ctx) await ctx.stop();
});

beforeEach(async () => {
  await ctx.db.collection("orders").deleteMany({});
});

describe("featuredBooks", () => {
  it("returns active featured books in title order", async () => {
    expect(titles(await featuredBooks(ctx.db))).toEqual(["Alpha", "Echo"]);
  });

  it("respects the limit", async () => {
    expect(titles(await featuredBooks(ctx.db, { limit: 1 }))).toEqual(["Alpha"]);
  });
});

describe("newArrivals", () => {
  it("returns the newest active books first", async () => {
    expect(titles(await newArrivals(ctx.db))).toEqual([
      "Foxtrot",
      "Echo",
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha",
    ]);
    expect(titles(await newArrivals(ctx.db, { limit: 2 }))).toEqual(["Foxtrot", "Echo"]);
  });
});

describe("bestSellers", () => {
  it("ranks by copies sold in paid, shipped and delivered orders only", async () => {
    await ctx.db.collection("orders").insertMany([
      order("paid", [
        ["Bravo", 3],
        ["Charlie", 1],
      ]),
      order("shipped", [["Charlie", 4]]),
      order("delivered", [["Delta", 1]]),
      order("pending_payment", [["Alpha", 50]]),
      order("cancelled", [["Alpha", 50]]),
      order("paid", [["Archived", 100]]),
    ]);
    expect(titles(await bestSellers(ctx.db, { limit: 3 }))).toEqual(["Charlie", "Bravo", "Delta"]);
  });

  it("tops up with featured books, then the newest, without repeating a book", async () => {
    await ctx.db.collection("orders").insertMany([
      order("paid", [
        ["Bravo", 3],
        ["Charlie", 1],
      ]),
      order("shipped", [["Charlie", 4]]),
      order("delivered", [["Delta", 1]]),
    ]);
    expect(titles(await bestSellers(ctx.db, { limit: 5 }))).toEqual([
      "Charlie",
      "Bravo",
      "Delta",
      "Echo",
      "Alpha",
    ]);
  });

  it("falls back to featured and newest books when nothing has sold yet", async () => {
    expect(titles(await bestSellers(ctx.db, { limit: 4 }))).toEqual([
      "Echo",
      "Alpha",
      "Foxtrot",
      "Delta",
    ]);
  });
});

describe("categoryCounts", () => {
  it("lists every category in order, counting active books and showing zeros", async () => {
    const counts = await categoryCounts(ctx.db);
    expect(counts.map((row) => row.category)).toEqual([...CATEGORIES]);
    const count = (category) => counts.find((row) => row.category === category).count;
    expect(count("Fiction")).toBe(2);
    expect(count("Mystery")).toBe(2);
    expect(count("History")).toBe(1);
    expect(count("Horror")).toBe(1);
    expect(count("Business")).toBe(0);
  });
});

describe("publicStats", () => {
  it("counts active books, categories in use and free-to-read books", async () => {
    expect(await publicStats(ctx.db)).toEqual({ books: 6, categories: 4, freeToRead: 2 });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { startTestDb } from "./helpers.js";

const require = createRequire(import.meta.url);
const {
  buildBookFilter,
  listBooks,
  getBookById,
  relatedBooks,
  suggestTitles,
  LIST_PROJECTION,
} = require("../src/services/books");
const { bookListQuerySchema } = require("../src/schemas/bookQuery");

// Use the real query schema, so the service is tested with exactly what the route will pass.
const query = (input = {}) => bookListQuerySchema.parse(input);
const day = (n) => new Date(Date.UTC(2026, 0, n));

// A small shelf with different categories, prices, stock levels, authors and dates.
const SHELF = [
  {
    title: "Dune",
    authors: ["Frank Herbert"],
    category: "Fiction",
    description: "A desert planet saga.",
    pricePaise: 49900,
    stock: 5,
    createdAt: day(1),
  },
  {
    title: "Children of Dune",
    authors: ["Frank Herbert"],
    category: "Fiction",
    description: "The saga continues.",
    pricePaise: 39900,
    stock: 0,
    createdAt: day(2),
  },
  {
    title: "apple pie stories",
    authors: ["Ann Baker"],
    category: "Fiction",
    description: "Short stories about a small town.",
    pricePaise: 19900,
    stock: 3,
    createdAt: day(3),
  },
  {
    title: "The Hound of the Baskervilles",
    authors: ["Arthur Conan Doyle"],
    category: "Mystery",
    description: "Holmes and a cursed family.",
    pricePaise: 14900,
    stock: 8,
    readUrl: "https://www.gutenberg.org/ebooks/2852.html.images",
    createdAt: day(4),
  },
  {
    title: "A Study in Scarlet",
    authors: ["Arthur Conan Doyle"],
    category: "Mystery",
    description: "The first Holmes story.",
    pricePaise: 12900,
    stock: 2,
    readUrl: "https://www.gutenberg.org/ebooks/244.html.images",
    createdAt: day(5),
  },
  {
    title: "Gone Girl",
    authors: ["Gillian Flynn"],
    category: "Mystery",
    description: "A marriage thriller.",
    pricePaise: 59900,
    stock: 10,
    createdAt: day(6),
  },
  {
    title: "Archived Mystery",
    authors: ["Arthur Conan Doyle"],
    category: "Mystery",
    description: "Should never be listed.",
    pricePaise: 29900,
    stock: 4,
    isActive: false,
    createdAt: day(7),
  },
  {
    title: "Saga of the North",
    authors: ["Erik Red"],
    category: "History",
    description: "Vikings at sea.",
    pricePaise: 34900,
    stock: 6,
    createdAt: day(8),
  },
];

let ctx;
let books;

const titles = (list) => list.map((book) => book.title);
const idOf = async (title) => (await books.findOne({ title }))._id;

beforeAll(async () => {
  ctx = await startTestDb();
  books = ctx.db.collection("books");
  await books.insertMany(
    SHELF.map((book, i) => ({
      isActive: true,
      isFeatured: false,
      subjects: [],
      coverUrl: `https://covers.openlibrary.org/b/id/${i + 1}-L.jpg`,
      source: { provider: "openlibrary", externalId: `/works/OL${i + 1}W` },
      updatedAt: book.createdAt,
      ...book,
    })),
  );
}, 120000);

afterAll(async () => {
  if (ctx) await ctx.stop();
});

describe("buildBookFilter", () => {
  it("lists only active books when nothing is set", () => {
    expect(buildBookFilter(query())).toEqual({ isActive: true });
  });

  it("maps every option onto the filter", () => {
    const filter = buildBookFilter(
      query({
        q: "holmes",
        category: "Mystery",
        minPrice: "100",
        maxPrice: "500",
        inStock: "1",
        free: "1",
      }),
    );
    expect(filter).toEqual({
      isActive: true,
      $text: { $search: "holmes" },
      category: "Mystery",
      pricePaise: { $gte: 10000, $lte: 50000 },
      stock: { $gt: 0 },
      readUrl: { $type: "string" },
    });
  });
});

describe("listBooks", () => {
  it("returns only active books, with the card fields only", async () => {
    const result = await listBooks(ctx.db, query());
    expect(result.total).toBe(7);
    expect(titles(result.books)).not.toContain("Archived Mystery");

    const allowed = ["_id", ...Object.keys(LIST_PROJECTION)];
    for (const book of result.books) {
      for (const key of Object.keys(book)) expect(allowed).toContain(key);
      expect(book.description).toBeUndefined();
    }
  });

  it("pages through the results with stable totals", async () => {
    const pages = [];
    for (const page of ["1", "2", "3"]) {
      const result = await listBooks(ctx.db, query({ limit: "3", page }));
      expect(result.total).toBe(7);
      expect(result.totalPages).toBe(3);
      pages.push(...result.books.map((book) => String(book._id)));
    }
    expect(new Set(pages).size).toBe(7);

    const beyond = await listBooks(ctx.db, query({ limit: "3", page: "4" }));
    expect(beyond.books).toEqual([]);
    expect(beyond.total).toBe(7);
  });

  it("shows the newest books first by default", async () => {
    const result = await listBooks(ctx.db, query());
    expect(titles(result.books).slice(0, 2)).toEqual(["Saga of the North", "Gone Girl"]);
  });

  it("filters by category, price range, stock and free-to-read", async () => {
    const count = async (input) => (await listBooks(ctx.db, query(input))).total;
    expect(await count({ category: "Mystery" })).toBe(3);
    expect(await count({ maxPrice: "150" })).toBe(2);
    expect(await count({ minPrice: "400" })).toBe(2);
    expect(await count({ inStock: "1" })).toBe(6);
    expect(await count({ free: "1" })).toBe(2);
    expect(await count({ category: "Mystery", free: "1", maxPrice: "130" })).toBe(1);
  });

  it("sorts by price both ways and by title, ignoring letter case", async () => {
    const list = async (sort) => titles((await listBooks(ctx.db, query({ sort }))).books);
    expect((await list("price_asc"))[0]).toBe("A Study in Scarlet");
    expect((await list("price_desc"))[0]).toBe("Gone Girl");
    expect(await list("title")).toEqual([
      "A Study in Scarlet",
      "apple pie stories",
      "Children of Dune",
      "Dune",
      "Gone Girl",
      "Saga of the North",
      "The Hound of the Baskervilles",
    ]);
  });

  it("searches titles, authors and descriptions, ranking title matches first", async () => {
    const saga = await listBooks(ctx.db, query({ q: "saga" }));
    expect(saga.total).toBe(3);
    expect(saga.books[0].title).toBe("Saga of the North");

    const byAuthor = await listBooks(ctx.db, query({ q: "flynn" }));
    expect(titles(byAuthor.books)).toEqual(["Gone Girl"]);
  });

  it("combines a search with filters", async () => {
    const free = await listBooks(ctx.db, query({ q: "holmes", category: "Mystery", free: "1" }));
    expect(free.total).toBe(2);
    const none = await listBooks(ctx.db, query({ q: "holmes", category: "Fiction" }));
    expect(none.total).toBe(0);
  });
});

describe("getBookById", () => {
  it("returns the full book page fields for an active book", async () => {
    const book = await getBookById(ctx.db, (await idOf("Dune")).toHexString());
    expect(book.title).toBe("Dune");
    expect(book.description).toBe("A desert planet saga.");
    for (const hidden of ["isActive", "source", "createdAt", "updatedAt"]) {
      expect(book[hidden]).toBeUndefined();
    }
  });

  it("returns null for archived, unknown and malformed ids", async () => {
    expect(await getBookById(ctx.db, (await idOf("Archived Mystery")).toHexString())).toBeNull();
    expect(await getBookById(ctx.db, "507f1f77bcf86cd799439011")).toBeNull();
    expect(await getBookById(ctx.db, "not-an-id")).toBeNull();
  });
});

describe("relatedBooks", () => {
  it("puts the same author first, then the same category, never the book or archived ones", async () => {
    const hound = await books.findOne({ title: "The Hound of the Baskervilles" });
    expect(titles(await relatedBooks(ctx.db, hound))).toEqual(["A Study in Scarlet", "Gone Girl"]);

    const dune = await books.findOne({ title: "Dune" });
    expect(titles(await relatedBooks(ctx.db, dune))).toEqual([
      "Children of Dune",
      "apple pie stories",
    ]);
  });

  it("respects the limit", async () => {
    const hound = await books.findOne({ title: "The Hound of the Baskervilles" });
    expect(titles(await relatedBooks(ctx.db, hound, { limit: 1 }))).toEqual(["A Study in Scarlet"]);
  });
});

describe("suggestTitles", () => {
  it("matches the start of any word in the title, ignoring case", async () => {
    expect(titles(await suggestTitles(ctx.db, "dun"))).toEqual(["Children of Dune", "Dune"]);
    expect(titles(await suggestTitles(ctx.db, "BASK"))).toEqual(["The Hound of the Baskervilles"]);
  });

  it("returns only the id, title and cover", async () => {
    const [first] = await suggestTitles(ctx.db, "dune");
    expect(Object.keys(first).sort()).toEqual(["_id", "coverUrl", "title"]);
  });

  it("ignores very short input, matches special characters literally and skips archived books", async () => {
    expect(await suggestTitles(ctx.db, "d")).toEqual([]);
    expect(await suggestTitles(ctx.db, ".*")).toEqual([]);
    expect(await suggestTitles(ctx.db, "archived")).toEqual([]);
  });

  it("caps the number of suggestions", async () => {
    expect(await suggestTitles(ctx.db, "the", { limit: 1 })).toHaveLength(1);
  });
});

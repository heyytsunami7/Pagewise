import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { startTestDb } from "./helpers.js";

const require = createRequire(import.meta.url);
const {
  seedBooks,
  assertSafeDatabase,
  assertCanReset,
  prepareEntries,
  resetBooks,
  countByCategory,
  parseSeedArgs,
} = require("../scripts/lib/seed");
const { ensureIndexes } = require("../src/db");
const { catalogBookSchema } = require("../src/schemas/book");

// A valid catalog entry, as data/catalog.json holds it (demo values included).
const entry = (i, overrides = {}) => ({
  title: `Book ${i}`,
  authors: ["Ann Author"],
  description: "A description.",
  category: "Mystery",
  subjects: ["Mystery"],
  coverUrl: `https://covers.openlibrary.org/b/id/${i}-L.jpg`,
  pricePaise: 29900,
  stock: 10,
  isFeatured: false,
  source: { provider: "openlibrary", externalId: `/works/OL${i}W` },
  ...overrides,
});

const catalogOf = (books) => ({ version: 1, sources: {}, books });

const FIRST = new Date("2026-01-01T00:00:00.000Z");
const LATER = new Date("2026-02-01T00:00:00.000Z");

describe("assertSafeDatabase", () => {
  it("allows names that end in _dev or _test", () => {
    for (const dbName of ["BookInventory_dev", "x_test", "a_dev"]) {
      expect(() => assertSafeDatabase({ dbName })).not.toThrow();
    }
  });

  it("refuses every other name", () => {
    for (const dbName of ["BookInventory", "BookStore", "dev", "BookStore_dev2", "x_devx"]) {
      expect(() => assertSafeDatabase({ dbName })).toThrow(/Refusing to seed/);
    }
  });

  it("allows a real database only with both the env flag and an explicit --db", () => {
    const dbName = "BookStore";
    expect(() => assertSafeDatabase({ dbName, explicitDb: null, allowProd: true })).toThrow(
      /Refusing/,
    );
    expect(() => assertSafeDatabase({ dbName, explicitDb: dbName, allowProd: false })).toThrow(
      /Refusing/,
    );
    expect(() => assertSafeDatabase({ dbName, explicitDb: dbName, allowProd: true })).not.toThrow();
  });

  it("only lets --reset run on dev and test databases", () => {
    expect(() => assertCanReset("BookInventory_dev")).not.toThrow();
    expect(() => assertCanReset("x_test")).not.toThrow();
    expect(() => assertCanReset("BookStore")).toThrow(/only works on _dev or _test/);
  });
});

describe("prepareEntries", () => {
  it("returns the parsed entries, with trimmed text and normalized ISBNs", () => {
    const catalog = catalogOf([entry(1, { title: "  Padded  ", isbn: "978-0-14-312774-1" })]);
    const [parsed] = prepareEntries(catalog, catalogBookSchema);
    expect(parsed.title).toBe("Padded");
    expect(parsed.isbn).toBe("9780143127741");
  });

  it("rejects a file that is not a version 1 catalog", () => {
    for (const catalog of [null, {}, { version: 2, books: [] }, { version: 1 }]) {
      expect(() => prepareEntries(catalog, catalogBookSchema)).toThrow(/version 1 catalog/);
    }
  });

  it("names the first invalid book and says how many there are", () => {
    const catalog = catalogOf([entry(1), entry(2, { pricePaise: 5 }), entry(3, { stock: -1 })]);
    expect(() => prepareEntries(catalog, catalogBookSchema)).toThrow(
      /2 book\(s\) in the catalog are invalid, for example "Book 2"/,
    );
  });

  it("rejects duplicate sources", () => {
    const duplicate = [entry(1), entry(2, { source: entry(1).source })];
    expect(() => prepareEntries(catalogOf(duplicate), catalogBookSchema)).toThrow(
      /Duplicate source/,
    );
  });
});

describe("parseSeedArgs", () => {
  it("returns the defaults", () => {
    expect(parseSeedArgs([])).toEqual({ reset: false, db: null });
  });

  it("parses --reset and --db", () => {
    expect(parseSeedArgs(["--reset", "--db", "Shop_dev"])).toEqual({ reset: true, db: "Shop_dev" });
  });

  it("rejects unknown options and unusable database names", () => {
    for (const argv of [["--nope"], ["--db"], ["--db", "bad name"], ["--db", "a/b"]]) {
      expect(() => parseSeedArgs(argv)).toThrow();
    }
  });
});

describe("seedBooks, resetBooks and countByCategory", () => {
  let ctx;
  let books;

  beforeAll(async () => {
    ctx = await startTestDb();
    books = ctx.db.collection("books");
  }, 120000);

  afterAll(async () => {
    if (ctx) await ctx.stop();
  });

  beforeEach(async () => {
    await books.deleteMany({});
  });

  it("inserts every book as active, with createdAt and updatedAt", async () => {
    const result = await seedBooks(ctx.db, [entry(1), entry(2)], { now: FIRST });
    expect(result).toEqual({ total: 2, inserted: 2, updated: 0, unchanged: 0 });

    const docs = await books.find({}).toArray();
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      expect(doc.isActive).toBe(true);
      expect(doc.createdAt).toEqual(FIRST);
      expect(doc.updatedAt).toEqual(FIRST);
      expect(doc.pricePaise).toBe(29900);
    }
  });

  it("can run again without duplicating or changing anything", async () => {
    await seedBooks(ctx.db, [entry(1), entry(2)], { now: FIRST });
    const again = await seedBooks(ctx.db, [entry(1), entry(2)], { now: LATER });

    expect(again).toEqual({ total: 2, inserted: 0, updated: 0, unchanged: 2 });
    expect(await books.countDocuments()).toBe(2);
    const doc = await books.findOne({ title: "Book 1" });
    expect(doc.updatedAt).toEqual(FIRST);
  });

  it("updates descriptive fields when the catalog changes and bumps updatedAt", async () => {
    await seedBooks(ctx.db, [entry(1)], { now: FIRST });
    const result = await seedBooks(
      ctx.db,
      [entry(1, { description: "A better description.", subjects: ["Mystery", "Detectives"] })],
      { now: LATER },
    );

    expect(result).toEqual({ total: 1, inserted: 0, updated: 1, unchanged: 0 });
    const doc = await books.findOne({ title: "Book 1" });
    expect(doc.description).toBe("A better description.");
    expect(doc.subjects).toEqual(["Mystery", "Detectives"]);
    expect(doc.createdAt).toEqual(FIRST);
    expect(doc.updatedAt).toEqual(LATER);
  });

  it("never overwrites price, stock, featured or active for an existing book", async () => {
    await seedBooks(ctx.db, [entry(1)], { now: FIRST });
    await books.updateOne(
      { title: "Book 1" },
      { $set: { stock: 3, pricePaise: 11111, isFeatured: true, isActive: false } },
    );

    await seedBooks(ctx.db, [entry(1, { description: "Changed." })], { now: LATER });

    const doc = await books.findOne({ title: "Book 1" });
    expect(doc.description).toBe("Changed.");
    expect(doc.stock).toBe(3);
    expect(doc.pricePaise).toBe(11111);
    expect(doc.isFeatured).toBe(true);
    expect(doc.isActive).toBe(false);
  });

  it("removes optional fields that are no longer in the catalog", async () => {
    const withExtras = entry(1, {
      isbn: "9780143127741",
      readUrl: "https://www.gutenberg.org/ebooks/1.html.images",
      pageCount: 300,
    });
    await seedBooks(ctx.db, [withExtras], { now: FIRST });
    expect(await books.countDocuments({ isbn: "9780143127741" })).toBe(1);

    await seedBooks(ctx.db, [entry(1)], { now: LATER });

    const doc = await books.findOne({ title: "Book 1" });
    for (const field of ["isbn", "readUrl", "pageCount"]) {
      expect(field in doc).toBe(false);
    }
  });

  it("leaves books that are not in the catalog alone", async () => {
    await books.insertOne({ title: "Hand-added", source: { provider: "manual" }, stock: 7 });
    await seedBooks(ctx.db, [entry(1)], { now: FIRST });

    expect(await books.countDocuments()).toBe(2);
    expect((await books.findOne({ title: "Hand-added" })).stock).toBe(7);
  });

  it("respects the unique ISBN index", async () => {
    const isbn = "9780143127741";
    await expect(
      seedBooks(ctx.db, [entry(1, { isbn }), entry(2, { isbn })], { now: FIRST }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("does nothing for an empty list", async () => {
    const result = await seedBooks(ctx.db, [], { now: FIRST });
    expect(result).toEqual({ total: 0, inserted: 0, updated: 0, unchanged: 0 });
    expect(await books.countDocuments()).toBe(0);
  });

  it("counts books per category in category order", async () => {
    await seedBooks(
      ctx.db,
      [
        entry(1, { category: "Mystery" }),
        entry(2, { category: "Mystery" }),
        entry(3, { category: "Fiction", subjects: ["Fiction"] }),
      ],
      { now: FIRST },
    );
    const counts = await countByCategory(ctx.db);
    expect(counts).toEqual({ Fiction: 1, Mystery: 2 });
    expect(Object.keys(counts)).toEqual(["Fiction", "Mystery"]);
  });

  it("resets the books collection and reports whether there was one", async () => {
    await seedBooks(ctx.db, [entry(1)], { now: FIRST });
    expect(await resetBooks(ctx.db)).toBe(true);
    expect(await books.countDocuments()).toBe(0);
    expect(await resetBooks(ctx.db)).toBe(false);

    // Dropping the collection drops its indexes; ensureIndexes brings them back.
    await ensureIndexes(ctx.db);
    const names = (await books.indexes()).map((index) => index.name);
    expect(names).toContain("isbn_unique");
  });
});

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildCatalog,
  selectBooks,
  assertUnique,
  parseBuildArgs,
} = require("../scripts/lib/buildCatalog");
const { catalogBookSchema } = require("../src/schemas/book");
const { CATEGORIES } = require("../src/constants");

// The subject that makes mergeCatalog put a book into each category.
const SUBJECT = {
  Fiction: "Fiction",
  "Non-Fiction": "Essays",
  Mystery: "Mystery",
  Fantasy: "Fantasy",
  Horror: "Horror",
  Humor: "Humor",
  Biography: "Biography",
  Psychology: "Psychology",
  History: "History",
  Business: "Business",
};

const acceptAll = { safeParse: (data) => ({ success: true, data }) };

// Raw files shaped like data/raw/*.json: `ol` Open Library books and `gut` Gutendex books
// per category. olCounts can override the Open Library count for a single category.
function makeRaw({ ol = 30, gut = 5, olCounts = {}, mutateOl = (book) => book } = {}) {
  const olCategories = {};
  const gutCategories = {};
  CATEGORIES.forEach((category, c) => {
    const olTotal = olCounts[category] ?? ol;
    olCategories[category] = Array.from({ length: olTotal }, (_, i) =>
      mutateOl(
        {
          externalId: `/works/OL${(c + 1) * 1000 + i}W`,
          title: `${category} title ${i}`,
          authors: [`Writer ${i}`],
          firstPublishYear: 2000,
          isbn: null,
          coverId: i,
          coverUrl: `https://covers.openlibrary.org/b/id/${(c + 1) * 1000 + i}-L.jpg`,
          pageCount: 300,
          subjects: [SUBJECT[category]],
          description: "A real description.",
        },
        category,
        i,
      ),
    );
    gutCategories[category] = Array.from({ length: gut }, (_, i) => {
      const id = (c + 1) * 100 + i;
      return {
        externalId: String(id),
        title: `Classic ${category} ${i}`,
        authors: [`Gus ${i}`],
        readUrl: `https://www.gutenberg.org/ebooks/${id}.html.images`,
        externalUrl: `https://www.gutenberg.org/ebooks/${id}`,
        coverUrl: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
        subjects: [SUBJECT[category]],
        description: null,
        downloadCount: 100 - i,
      };
    });
  });
  return {
    openlibrary: {
      source: "openlibrary",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      categories: olCategories,
    },
    gutendex: {
      source: "gutendex",
      fetchedAt: "2026-01-02T00:00:00.000Z",
      categories: gutCategories,
    },
  };
}

const build = (overrides = {}) =>
  buildCatalog({
    ...makeRaw(),
    schema: acceptAll,
    perCategory: 8,
    minPerCategory: 5,
    ...overrides,
  });

// Books in the shape selectBooks receives (the output of mergeCatalog).
const pick = (category, title, extra = {}) => ({
  category,
  title,
  hasRealDescription: true,
  rank: 0,
  ...extra,
});

describe("selectBooks", () => {
  it("keeps at most perCategory books per category, in category order", () => {
    const books = [
      ...["a", "b", "c", "d", "e"].map((t) => pick("Mystery", `M ${t}`)),
      ...["a", "b", "c", "d"].map((t) => pick("Fiction", `F ${t}`)),
    ];
    const selected = selectBooks(books, { perCategory: 3, freePerCategory: 0 });
    expect(selected.map((book) => book.category)).toEqual([
      "Fiction",
      "Fiction",
      "Fiction",
      "Mystery",
      "Mystery",
      "Mystery",
    ]);
  });

  it("prefers a real description, then a better rank, then the title", () => {
    const books = [
      pick("Mystery", "Alpha", { hasRealDescription: false, rank: 0 }),
      pick("Mystery", "Bravo", { rank: 4 }),
      pick("Mystery", "Charlie", { rank: 1 }),
      pick("Mystery", "Delta", { rank: 1 }),
    ];
    const selected = selectBooks(books, { perCategory: 3, freePerCategory: 0 });
    expect(selected.map((book) => book.title)).toEqual(["Charlie", "Delta", "Bravo"]);
  });

  it("reserves slots for free-to-read books", () => {
    const books = [
      ...[0, 1, 2, 3, 4].map((i) => pick("Mystery", `Paid ${i}`, { rank: i })),
      ...[0, 1, 2].map((i) =>
        pick("Mystery", `Free ${i}`, {
          rank: i,
          hasRealDescription: false,
          readUrl: `https://example.com/${i}`,
        }),
      ),
    ];
    const reserved = selectBooks(books, { perCategory: 5, freePerCategory: 2 });
    expect(reserved).toHaveLength(5);
    expect(reserved.filter((book) => book.readUrl)).toHaveLength(2);

    const none = selectBooks(books, { perCategory: 5, freePerCategory: 0 });
    expect(none.filter((book) => book.readUrl)).toHaveLength(0);

    const capped = selectBooks(books, { perCategory: 2, freePerCategory: 10 });
    expect(capped).toHaveLength(2);
  });

  it("copes with an empty list and ignores unknown categories", () => {
    expect(selectBooks([])).toEqual([]);
    expect(selectBooks([pick("Cooking", "Stew")])).toEqual([]);
  });
});

describe("assertUnique", () => {
  const entry = (externalId, isbn) => ({
    source: { provider: "openlibrary", externalId },
    ...(isbn ? { isbn } : {}),
  });

  it("accepts unique entries, including several without an ISBN", () => {
    expect(() => assertUnique([entry("1"), entry("2"), entry("3", "9780141034379")])).not.toThrow();
  });

  it("rejects a duplicate source", () => {
    expect(() => assertUnique([entry("1"), entry("1")])).toThrow(/Duplicate source/);
  });

  it("rejects a duplicate ISBN", () => {
    const entries = [entry("1", "9780141034379"), entry("2", "9780141034379")];
    expect(() => assertUnique(entries)).toThrow(/Duplicate ISBN/);
  });
});

describe("buildCatalog", () => {
  it("builds a catalog in category order with demo values and no helper fields", () => {
    const { catalog } = build();

    expect(catalog.version).toBe(1);
    expect(catalog.sources).toEqual({
      openlibrary: "2026-01-01T00:00:00.000Z",
      gutendex: "2026-01-02T00:00:00.000Z",
    });
    expect(catalog.books).toHaveLength(CATEGORIES.length * 8);

    const order = [...new Set(catalog.books.map((book) => book.category))];
    expect(order).toEqual([...CATEGORIES]);

    for (const book of catalog.books) {
      expect(Number.isInteger(book.pricePaise)).toBe(true);
      expect(Number.isInteger(book.stock)).toBe(true);
      expect(typeof book.isFeatured).toBe("boolean");
      for (const field of ["hasRealDescription", "rank", "downloadCount"]) {
        expect(field in book).toBe(false);
      }
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(build().catalog)).toBe(JSON.stringify(build().catalog));
  });

  it("reports what it did", () => {
    const { report } = build();
    expect(report.total).toBe(80);
    for (const category of CATEGORIES) expect(report.perCategory[category]).toBe(8);
    expect(report.freeToRead).toBe(30);
    expect(report.featured).toBe(12);
    expect(report.outOfStock).toBeGreaterThanOrEqual(3);
    expect(report.skippedInvalid).toBe(0);
    expect(report.merge.openLibraryRows).toBe(300);
    expect(report.merge.gutendexRows).toBe(50);
  });

  it("keeps the free-to-read books even when the others have better descriptions", () => {
    const { catalog } = build({ freePerCategory: 3 });
    const free = catalog.books.filter((book) => book.readUrl);
    expect(free).toHaveLength(30);
    for (const book of free) {
      expect(book.description).toBe("A public-domain classic from Project Gutenberg.");
    }
  });

  it("fails with a clear message when a category is short", () => {
    const raw = makeRaw({ olCounts: { Mystery: 3 }, gut: 0 });
    const options = { ...raw, schema: acceptAll, perCategory: 8 };
    expect(() => buildCatalog({ ...options, minPerCategory: 5 })).toThrow(
      /fewer than 5 books: Mystery \(3\)/,
    );
    expect(() => buildCatalog({ ...options, minPerCategory: 0 })).not.toThrow();
  });

  it("skips invalid books before choosing, so the category still fills up", () => {
    const rejectBad = {
      safeParse: (data) =>
        data.title.includes("BAD")
          ? { success: false, error: { issues: [{ path: ["title"], message: "nope" }] } }
          : { success: true, data },
    };
    const raw = makeRaw({
      mutateOl: (book, category, i) =>
        category === "Mystery" && i < 2 ? { ...book, title: `BAD ${i}` } : book,
    });
    const { catalog, report } = buildCatalog({
      ...raw,
      schema: rejectBad,
      perCategory: 8,
      minPerCategory: 5,
    });

    expect(report.skippedInvalid).toBe(2);
    expect(report.skippedExamples).toHaveLength(2);
    expect(report.skippedExamples[0].issues[0]).toBe("title: nope");
    expect(catalog.books.some((book) => book.title.includes("BAD"))).toBe(false);
    expect(report.perCategory.Mystery).toBe(8);
  });

  it("fails if a chosen book is rejected after the demo values are added", () => {
    const rejectPremium = {
      safeParse: (data) =>
        data.pricePaise > 99900
          ? { success: false, error: { issues: [{ path: ["pricePaise"], message: "too high" }] } }
          : { success: true, data },
    };
    let error;
    try {
      buildCatalog({ ...makeRaw(), schema: rejectPremium, perCategory: 8, minPerCategory: 5 });
    } catch (err) {
      error = err;
    }
    expect(error.message).toMatch(/failed validation/);
    expect(error.details.failures).toHaveLength(2);
  });

  it("uses the parsed copy returned by the schema", () => {
    const shout = {
      safeParse: (data) => ({ success: true, data: { ...data, title: data.title.toUpperCase() } }),
    };
    const { catalog } = build({ schema: shout });
    for (const book of catalog.books) expect(book.title).toBe(book.title.toUpperCase());
  });
});

describe("buildCatalog with the real catalogBookSchema", () => {
  it("produces entries that all pass the schema", () => {
    const { catalog } = build({ schema: catalogBookSchema });
    expect(catalog.books).toHaveLength(80);
    for (const book of catalog.books) {
      expect(catalogBookSchema.safeParse(book).success).toBe(true);
    }
  });

  it("keeps an ISBN through the pipeline", () => {
    const raw = makeRaw({
      mutateOl: (book, category, i) =>
        category === "Mystery" && i === 0 ? { ...book, isbn: "9780143127741" } : book,
    });
    const { catalog } = buildCatalog({
      ...raw,
      schema: catalogBookSchema,
      perCategory: 8,
      minPerCategory: 5,
    });
    expect(catalog.books.find((book) => book.title === "Mystery title 0").isbn).toBe(
      "9780143127741",
    );
  });

  it("skips a book whose title is too long for the schema", () => {
    const raw = makeRaw({
      mutateOl: (book, category, i) =>
        category === "Mystery" && i === 0 ? { ...book, title: `Works ${"x".repeat(250)}` } : book,
    });
    const { catalog, report } = buildCatalog({
      ...raw,
      schema: catalogBookSchema,
      perCategory: 8,
      minPerCategory: 5,
    });
    expect(report.skippedInvalid).toBe(1);
    expect(catalog.books.some((book) => book.title.startsWith("Works xxx"))).toBe(false);
  });
});

describe("parseBuildArgs", () => {
  it("returns the defaults", () => {
    expect(parseBuildArgs([])).toEqual({ perCategory: 25, minPerCategory: 15, freePerCategory: 3 });
  });

  it("parses every option", () => {
    const options = parseBuildArgs([
      "--per-category",
      "30",
      "--min-per-category",
      "0",
      "--free-per-category",
      "5",
    ]);
    expect(options).toEqual({ perCategory: 30, minPerCategory: 0, freePerCategory: 5 });
  });

  it("rejects unknown options and bad numbers", () => {
    const bad = [
      ["--nope"],
      ["--per-category"],
      ["--per-category", "0"],
      ["--per-category", "x"],
      ["--min-per-category", "101"],
      ["--free-per-category", "26"],
    ];
    for (const argv of bad) {
      expect(() => parseBuildArgs(argv)).toThrow();
    }
  });
});

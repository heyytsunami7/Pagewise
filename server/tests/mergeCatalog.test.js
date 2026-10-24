import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  mergeCatalog,
  normalizeTitle,
  bookKey,
  isPlaceholderDescription,
  PLACEHOLDER_DESCRIPTIONS,
  GUTENBERG_PLACEHOLDER,
  GENERIC_PLACEHOLDER,
} = require("../scripts/lib/mergeCatalog");

// Raw-file shaped test data, like data/raw/openlibrary.json and data/raw/gutendex.json.
const olBook = (id, overrides = {}) => ({
  externalId: `/works/OL${id}W`,
  title: `Book ${id}`,
  authors: ["Ann Author"],
  firstPublishYear: 1999,
  isbn: null,
  coverId: id,
  coverUrl: `https://covers.openlibrary.org/b/id/${id}-L.jpg`,
  pageCount: 300,
  subjects: ["Mystery"],
  description: "A real description.",
  ...overrides,
});

const gutBook = (id, overrides = {}) => ({
  externalId: String(id),
  title: `Classic ${id}`,
  authors: ["Gus Author"],
  readUrl: `https://www.gutenberg.org/ebooks/${id}.html.images`,
  externalUrl: `https://www.gutenberg.org/ebooks/${id}`,
  coverUrl: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
  subjects: ["Fiction"],
  description: null,
  downloadCount: 100,
  ...overrides,
});

const raw = (categories) => ({ categories });

describe("normalizeTitle and bookKey", () => {
  it("ignores case, punctuation, accents and leading articles", () => {
    expect(normalizeTitle("The Adventures of Sherlock Holmes")).toBe(
      "adventures of sherlock holmes",
    );
    expect(normalizeTitle("Crime & Punishment!")).toBe("crime and punishment");
    expect(normalizeTitle("An Étude")).toBe("etude");
    expect(normalizeTitle("A  Tale--of Two Cities")).toBe("tale of two cities");
    expect(normalizeTitle(undefined)).toBe("");
  });

  it("gives the same key for the same book with a differently written author", () => {
    const a = bookKey({ title: "The Hound of the Baskervilles", authors: ["Arthur Conan Doyle"] });
    const b = bookKey({ title: "Hound of the Baskervilles", authors: ["A. Conan Doyle"] });
    expect(a).toBe(b);
    expect(a).not.toBe(bookKey({ title: "Hound of the Baskervilles", authors: ["Jane Austen"] }));
  });

  it("copes with a book that has no authors", () => {
    expect(bookKey({ title: "Orphan", authors: [] })).toBe("orphan|");
  });
});

describe("mergeCatalog", () => {
  it("turns a source book into our shape and reports the counts", () => {
    const { books, report } = mergeCatalog({
      openlibrary: raw({ Mystery: [olBook(1, { subjects: ["Mystery", "Detectives"] })] }),
      gutendex: null,
    });

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      title: "Book 1",
      authors: ["Ann Author"],
      category: "Mystery",
      description: "A real description.",
      hasRealDescription: true,
      subjects: ["Mystery", "Detectives"],
      coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg",
      pageCount: 300,
      publishedYear: 1999,
      source: { provider: "openlibrary", externalId: "/works/OL1W" },
      rank: 0,
    });
    expect("isbn" in books[0]).toBe(false);
    expect("readUrl" in books[0]).toBe(false);
    expect(report).toEqual({
      openLibraryRows: 1,
      gutendexRows: 0,
      uniqueSourceBooks: 1,
      duplicatesMerged: 0,
      droppedNoCategory: 0,
      books: 1,
    });
  });

  it("copes with a missing raw file", () => {
    const empty = mergeCatalog({ openlibrary: null, gutendex: null });
    expect(empty.books).toEqual([]);
    expect(empty.report.books).toBe(0);

    const onlyGutenberg = mergeCatalog({
      openlibrary: null,
      gutendex: raw({ Fiction: [gutBook(1)] }),
    });
    expect(onlyGutenberg.books).toHaveLength(1);
  });

  it("keeps one entry for a book listed under several categories and uses the hints", () => {
    const both = mergeCatalog({
      openlibrary: raw({
        Fiction: [olBook(1, { subjects: ["Mystery", "Fiction"] })],
        Mystery: [olBook(1, { subjects: ["Mystery", "Fiction"] })],
      }),
    });
    expect(both.report.openLibraryRows).toBe(2);
    expect(both.report.uniqueSourceBooks).toBe(1);
    expect(both.books).toHaveLength(1);
    expect(both.books[0].category).toBe("Mystery");

    const onlyFiction = mergeCatalog({
      openlibrary: raw({ Fiction: [olBook(1, { subjects: ["Mystery", "Fiction"] })] }),
    });
    expect(onlyFiction.books[0].category).toBe("Fiction");
  });

  it("remembers the best rank across the lists a book appears in", () => {
    const { books } = mergeCatalog({
      openlibrary: raw({
        Mystery: [olBook(9), olBook(1)],
        Fiction: [olBook(1, { subjects: ["Mystery", "Fiction"] })],
      }),
    });
    expect(books.find((book) => book.source.externalId === "/works/OL1W").rank).toBe(0);
  });

  it("merges an Open Library book with its Gutendex copy, keeping the better metadata", () => {
    const { books, report } = mergeCatalog({
      openlibrary: raw({
        Fiction: [
          olBook(1, {
            title: "The Hound of the Baskervilles",
            authors: ["A. Conan Doyle"],
            isbn: "9780141034379",
            subjects: ["Fiction"],
            description: null,
          }),
        ],
      }),
      gutendex: raw({
        Mystery: [
          gutBook(2852, {
            title: "Hound of the Baskervilles",
            authors: ["Arthur Conan Doyle"],
            subjects: ["Fiction", "Detective and mystery stories"],
            description: "Holmes investigates a family curse.",
          }),
        ],
      }),
    });

    expect(report.duplicatesMerged).toBe(1);
    expect(books).toHaveLength(1);
    const [book] = books;
    expect(book.source).toEqual({ provider: "openlibrary", externalId: "/works/OL1W" });
    expect(book.coverUrl).toBe("https://covers.openlibrary.org/b/id/1-L.jpg");
    expect(book.isbn).toBe("9780141034379");
    expect(book.pageCount).toBe(300);
    expect(book.readUrl).toBe("https://www.gutenberg.org/ebooks/2852.html.images");
    expect(book.externalUrl).toBe("https://www.gutenberg.org/ebooks/2852");
    expect(book.description).toBe("Holmes investigates a family curse.");
    expect(book.hasRealDescription).toBe(true);
    // The two copies were fetched under Fiction and Mystery; the confirmed genre wins.
    expect(book.category).toBe("Mystery");
    expect(book.downloadCount).toBe(100);
  });

  it("drops books whose subjects match no category and counts them", () => {
    const { books, report } = mergeCatalog({
      openlibrary: raw({
        Fiction: [olBook(1, { subjects: ["Cookery"] }), olBook(2, { subjects: ["Fiction"] })],
      }),
    });
    expect(books).toHaveLength(1);
    expect(report.droppedNoCategory).toBe(1);
  });

  it("uses a placeholder description when a book has none", () => {
    const { books } = mergeCatalog({
      openlibrary: raw({ Mystery: [olBook(1, { description: null })] }),
      gutendex: raw({ Fiction: [gutBook(5)] }),
    });
    const openLibrary = books.find((book) => book.source.provider === "openlibrary");
    const gutenberg = books.find((book) => book.source.provider === "gutendex");

    expect(openLibrary.description).toBe(GENERIC_PLACEHOLDER);
    expect(openLibrary.hasRealDescription).toBe(false);
    expect(gutenberg.description).toBe(GUTENBERG_PLACEHOLDER);
    expect(gutenberg.hasRealDescription).toBe(false);
    expect(isPlaceholderDescription(gutenberg.description)).toBe(true);
    expect(isPlaceholderDescription("A real description.")).toBe(false);
    expect(PLACEHOLDER_DESCRIPTIONS).toHaveLength(2);
  });

  it("keeps the ten most useful subjects, most shared first", () => {
    const unique = (prefix) => Array.from({ length: 11 }, (_, i) => `${prefix} ${i}`);
    const { books } = mergeCatalog({
      openlibrary: raw({
        Mystery: [
          olBook(1, { subjects: ["Mystery", ...unique("one"), "Shared One"] }),
          olBook(2, { subjects: ["Mystery", ...unique("two"), "Shared One"] }),
        ],
      }),
    });
    const first = books.find((book) => book.source.externalId === "/works/OL1W");
    expect(first.subjects).toHaveLength(10);
    expect(first.subjects.slice(0, 3)).toEqual(["Mystery", "Shared One", "one 0"]);
  });

  it("lets only one book keep a given ISBN", () => {
    const { books } = mergeCatalog({
      openlibrary: raw({
        Mystery: [olBook(1, { isbn: "9780141034379" }), olBook(2, { isbn: "9780141034379" })],
      }),
    });
    const withIsbn = books.filter((book) => book.isbn);
    expect(withIsbn).toHaveLength(1);
    expect(withIsbn[0].source.externalId).toBe("/works/OL1W");
  });

  it("leaves out page counts and years that are out of range", () => {
    const { books } = mergeCatalog({
      openlibrary: raw({
        Mystery: [
          olBook(1, { pageCount: 0, firstPublishYear: 999 }),
          olBook(2, { pageCount: 20000, firstPublishYear: 3000 }),
          olBook(3, { pageCount: 250, firstPublishYear: 1925 }),
        ],
      }),
    });
    const byId = (id) => books.find((book) => book.source.externalId === `/works/OL${id}W`);
    for (const id of [1, 2]) {
      expect("pageCount" in byId(id)).toBe(false);
      expect("publishedYear" in byId(id)).toBe(false);
    }
    expect(byId(3)).toMatchObject({ pageCount: 250, publishedYear: 1925 });
  });

  it("orders books by popularity rank, then title", () => {
    const { books } = mergeCatalog({
      openlibrary: raw({
        Mystery: [olBook(1, { title: "Zed" }), olBook(2, { title: "Beta" })],
        Horror: [olBook(3, { title: "Alpha", subjects: ["Horror"] })],
      }),
    });
    expect(books.map((book) => book.title)).toEqual(["Alpha", "Zed", "Beta"]);
  });

  it("categorizes a Gutendex-only book from its subjects and keeps its read link", () => {
    const { books } = mergeCatalog({
      gutendex: raw({
        Fiction: [gutBook(7, { subjects: ["Detective and mystery stories"] })],
      }),
    });
    expect(books[0]).toMatchObject({
      category: "Mystery",
      source: { provider: "gutendex", externalId: "7" },
      readUrl: "https://www.gutenberg.org/ebooks/7.html.images",
      externalUrl: "https://www.gutenberg.org/ebooks/7",
    });
  });
});

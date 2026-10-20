import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createGutendexClient,
  parseBook,
  flipAuthorName,
  cleanTitle,
  pickReadUrl,
} = require("../scripts/lib/gutendex");
const { GUTENDEX_TOPICS } = require("../scripts/lib/categories");
const { CATEGORIES } = require("../src/constants");

const makeItem = (id, overrides = {}) => ({
  id,
  title: "Pride and Prejudice",
  authors: [{ name: "Austen, Jane", birth_year: 1775, death_year: 1817 }],
  summaries: ["Jane Austen novel of manners. (This is an automatically generated summary.)"],
  subjects: ["Courtship -- Fiction", "Domestic fiction"],
  bookshelves: ["Category: Novels", "Best Books Ever Listings"],
  languages: ["en"],
  copyright: false,
  media_type: "Text",
  formats: {
    "text/html": `https://www.gutenberg.org/ebooks/${id}.html.images`,
    "application/epub+zip": `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
    "image/jpeg": `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
  },
  download_count: 98765,
  ...overrides,
});

describe("parseBook", () => {
  it("maps a Gutendex result into our shape", () => {
    expect(parseBook(makeItem(1342))).toEqual({
      externalId: "1342",
      title: "Pride and Prejudice",
      authors: ["Jane Austen"],
      readUrl: "https://www.gutenberg.org/ebooks/1342.html.images",
      externalUrl: "https://www.gutenberg.org/ebooks/1342",
      coverUrl: "https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg",
      subjects: ["Courtship -- Fiction", "Domestic fiction", "Novels", "Best Books Ever Listings"],
      description: "Jane Austen novel of manners.",
      downloadCount: 98765,
    });
  });

  it("removes duplicate authors and flips every name", () => {
    const item = makeItem(1, {
      authors: [{ name: "Austen, Jane" }, { name: "austen, jane" }, { name: "B, C" }],
    });
    expect(parseBook(item).authors).toEqual(["Jane Austen", "C B"]);
  });

  it("skips books that are not usable for the store", () => {
    const unusable = [
      makeItem(1, { formats: { "text/html": "https://a.example/h" } }), // no cover
      makeItem(1, { formats: { "image/jpeg": "https://a.example/c.jpg" } }), // nothing to read
      makeItem(1, { authors: [] }),
      makeItem(1, { copyright: true }),
      makeItem(1, { languages: ["fr"] }),
      makeItem(1, { media_type: "Sound" }),
      makeItem(1, { id: undefined }),
      makeItem(1, { title: "   " }),
    ];
    for (const item of unusable) {
      expect(parseBook(item)).toBeNull();
    }
  });

  it("accepts results that leave optional fields out", () => {
    const item = makeItem(1, { copyright: null, languages: undefined, media_type: undefined });
    expect(parseBook(item)).not.toBeNull();
  });

  it("returns a null description when there is no real summary", () => {
    expect(parseBook(makeItem(1, { summaries: undefined })).description).toBeNull();
    const onlyMarker = makeItem(1, {
      summaries: ["(This is an automatically generated summary.)"],
    });
    expect(parseBook(onlyMarker).description).toBeNull();
  });

  it("defaults the download count to zero", () => {
    expect(parseBook(makeItem(1, { download_count: undefined })).downloadCount).toBe(0);
  });
});

describe("flipAuthorName", () => {
  it("turns 'Last, First' into 'First Last'", () => {
    expect(flipAuthorName("Austen, Jane")).toBe("Jane Austen");
    expect(flipAuthorName("Doyle, Arthur Conan")).toBe("Arthur Conan Doyle");
  });

  it("leaves single names alone and strips life dates", () => {
    expect(flipAuthorName("Anonymous")).toBe("Anonymous");
    expect(flipAuthorName("Dumas, Alexandre, 1802-1870")).toBe("Alexandre Dumas");
    expect(flipAuthorName("Twain, Mark, 1835-1910")).toBe("Mark Twain");
  });
});

describe("cleanTitle", () => {
  it("drops alternative titles, joins broken lines and caps the length", () => {
    expect(cleanTitle("Moby Dick; Or, The Whale")).toBe("Moby Dick");
    expect(cleanTitle("Alice's Adventures\r\nin Wonderland")).toBe(
      "Alice's Adventures in Wonderland",
    );
    expect(cleanTitle("x".repeat(300))).toHaveLength(200);
  });
});

describe("pickReadUrl", () => {
  it("prefers HTML, then EPUB, then plain text", () => {
    expect(
      pickReadUrl({
        "text/html; charset=utf-8": "https://a.example/h",
        "application/epub+zip": "https://a.example/e",
      }),
    ).toBe("https://a.example/h");
    expect(
      pickReadUrl({
        "application/epub+zip": "https://a.example/e",
        "text/plain; charset=us-ascii": "https://a.example/t",
      }),
    ).toBe("https://a.example/e");
    expect(pickReadUrl({ "text/plain; charset=us-ascii": "https://a.example/t" })).toBe(
      "https://a.example/t",
    );
  });

  it("returns null when there is nothing safe to link to", () => {
    expect(pickReadUrl({ "text/html": "ftp://a.example/h" })).toBeNull();
    expect(pickReadUrl({})).toBeNull();
    expect(pickReadUrl(undefined)).toBeNull();
  });
});

describe("createGutendexClient", () => {
  it("builds the search URL and follows Gutendex's next link until it has enough", async () => {
    const pages = [
      {
        results: [makeItem(1), makeItem(2)],
        next: "https://gutendex.com/books?page=2&topic=detective",
      },
      { results: [makeItem(3)], next: null },
    ];
    const http = { getJson: vi.fn(async () => pages.shift()) };

    const books = await createGutendexClient(http).searchTopic("detective", { limit: 3 });
    expect(books).toHaveLength(3);
    expect(http.getJson).toHaveBeenCalledTimes(2);

    const firstUrl = http.getJson.mock.calls[0][0];
    expect(firstUrl).toContain("https://gutendex.com/books?");
    expect(firstUrl).toContain("languages=en");
    expect(firstUrl).toContain("copyright=false");
    expect(firstUrl).toContain("topic=detective");
    expect(http.getJson.mock.calls[1][0]).toBe("https://gutendex.com/books?page=2&topic=detective");
  });

  it("stops fetching pages once it has enough books", async () => {
    const http = {
      getJson: vi.fn(async () => ({
        results: [makeItem(1), makeItem(2), makeItem(3)],
        next: "https://gutendex.com/books?page=2",
      })),
    };
    const books = await createGutendexClient(http).searchTopic("x", { limit: 2 });
    expect(books).toHaveLength(2);
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });

  it("never fetches more than maxPages pages", async () => {
    const http = {
      getJson: vi.fn(async () => ({
        results: [{ id: 1 }],
        next: "https://gutendex.com/books?page=9",
      })),
    };
    const books = await createGutendexClient(http, { maxPages: 2 }).searchTopic("x");
    expect(books).toEqual([]);
    expect(http.getJson).toHaveBeenCalledTimes(2);
  });

  it("ignores a next link that points to another site", async () => {
    const pages = [
      { results: [makeItem(1)], next: "https://evil.example/books?page=2" },
      { results: [makeItem(2)], next: null },
    ];
    const http = { getJson: vi.fn(async () => pages.shift()) };
    const books = await createGutendexClient(http).searchTopic("x", { limit: 5 });
    expect(http.getJson).toHaveBeenCalledTimes(1);
    expect(books).toHaveLength(1);
  });

  it("copes with a response that has no results", async () => {
    const http = { getJson: vi.fn(async () => ({})) };
    expect(await createGutendexClient(http).searchTopic("x")).toEqual([]);
  });
});

describe("GUTENDEX_TOPICS", () => {
  it("has topics for exactly the ten categories", () => {
    expect(Object.keys(GUTENDEX_TOPICS).sort()).toEqual([...CATEGORIES].sort());
    for (const topics of Object.values(GUTENDEX_TOPICS)) {
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.every((topic) => typeof topic === "string" && topic.length > 0)).toBe(true);
    }
  });
});

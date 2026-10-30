import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { startTestDb, makeApp } from "./helpers.js";

let ctx;
let app;
let ids;

const SHELF = [
  {
    title: "Dune",
    authors: ["Frank Herbert"],
    category: "Fiction",
    description: "A desert planet saga.",
    pricePaise: 49900,
    stock: 5,
  },
  {
    title: "The Hound of the Baskervilles",
    authors: ["Arthur Conan Doyle"],
    category: "Mystery",
    description: "Holmes and a cursed family.",
    pricePaise: 14900,
    stock: 8,
    readUrl: "https://www.gutenberg.org/ebooks/2852.html.images",
  },
  {
    title: "Archived Book",
    authors: ["Arthur Conan Doyle"],
    category: "Mystery",
    description: "Hidden.",
    pricePaise: 29900,
    stock: 1,
    isActive: false,
  },
];

beforeAll(async () => {
  ctx = await startTestDb();
  app = makeApp({ db: ctx.db });
  const result = await ctx.db.collection("books").insertMany(
    SHELF.map((book, i) => ({
      isActive: true,
      isFeatured: false,
      subjects: [],
      coverUrl: `https://covers.openlibrary.org/b/id/${i + 1}-L.jpg`,
      source: { provider: "openlibrary", externalId: `/works/OL${i + 1}W` },
      createdAt: new Date(Date.UTC(2026, 0, i + 1)),
      updatedAt: new Date(Date.UTC(2026, 0, i + 1)),
      ...book,
    })),
  );
  ids = Object.values(result.insertedIds).map((id) => id.toHexString());
}, 120000);

afterAll(async () => {
  if (ctx) await ctx.stop();
});

describe("GET /books", () => {
  it("returns a page of active books with paging totals and card fields only", async () => {
    const res = await request(app).get("/books");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, limit: 12, totalPages: 1 });
    expect(res.body.books.map((book) => book.title)).not.toContain("Archived Book");
    for (const book of res.body.books) {
      expect(typeof book._id).toBe("string");
      expect(book.description).toBeUndefined();
      expect(book.isActive).toBeUndefined();
      expect(book.source).toBeUndefined();
    }
  });

  it("applies filters from the query string", async () => {
    const res = await request(app).get("/books?category=Mystery&free=1");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.books[0].title).toBe("The Hound of the Baskervilles");
  });

  it("rejects invalid queries with a 400 in the standard error shape", async () => {
    const res = await request(app).get("/books?category=Cooking");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.some((detail) => detail.path === "category")).toBe(true);

    for (const url of ["/books?limit=100", "/books?foo=1", "/books?page=0"]) {
      expect((await request(app).get(url)).status).toBe(400);
    }
  });

  it("refuses MongoDB operators smuggled into the query", async () => {
    const res = await request(app).get("/books?category[$ne]=Fiction");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /books/:id", () => {
  it("returns the full book", async () => {
    const res = await request(app).get(`/books/${ids[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.book).toMatchObject({
      _id: ids[0],
      title: "Dune",
      description: "A desert planet saga.",
    });
  });

  it("answers 400 for a malformed id and 404 for an unknown or archived book", async () => {
    const malformed = await request(app).get("/books/not-an-id");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");

    const unknown = await request(app).get("/books/507f1f77bcf86cd799439011");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");

    expect((await request(app).get(`/books/${ids[2]}`)).status).toBe(404);
  });
});

describe("GET /books/:id/related", () => {
  it("returns related books without the book itself", async () => {
    const res = await request(app).get(`/books/${ids[1]}/related`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.books)).toBe(true);
    expect(res.body.books.map((book) => book._id)).not.toContain(ids[1]);
    expect(res.body.books.map((book) => book.title)).not.toContain("Archived Book");
  });

  it("answers 404 for an unknown book", async () => {
    expect((await request(app).get("/books/507f1f77bcf86cd799439011/related")).status).toBe(404);
  });
});

describe("GET /books/suggest", () => {
  it("returns matching titles", async () => {
    const res = await request(app).get("/books/suggest?q=dun");
    expect(res.status).toBe(200);
    expect(res.body.suggestions.map((book) => book.title)).toEqual(["Dune"]);
  });

  it("returns an empty list for missing or very short input", async () => {
    for (const url of ["/books/suggest", "/books/suggest?q=d", "/books/suggest?q="]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.body.suggestions).toEqual([]);
    }
  });

  it("refuses operators and unknown keys", async () => {
    expect((await request(app).get("/books/suggest?q[$regex]=.*")).status).toBe(400);
    expect((await request(app).get("/books/suggest?x=1")).status).toBe(400);
  });
});

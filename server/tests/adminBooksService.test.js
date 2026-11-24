import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { ObjectId } from "mongodb";
import { startTestDb } from "./helpers.js";

const require = createRequire(import.meta.url);
const {
  buildAdminFilter,
  listAdminBooks,
  getAdminBook,
  createBook,
  updateBook,
  deleteOrArchiveBook,
  restoreBook,
} = require("../src/services/adminBooks");
const { adminBookListQuerySchema } = require("../src/schemas/adminBookQuery");
const { bookCreateSchema, bookUpdateSchema } = require("../src/schemas/book");

const query = (input = {}) => adminBookListQuerySchema.parse(input);

// Run the input through the real create schema, so tests use exactly what the route will pass.
const newBook = (overrides = {}) =>
  bookCreateSchema.parse({
    title: "A Fresh Book",
    authors: ["Some Author"],
    description: "Something worth reading.",
    category: "Fiction",
    coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg",
    pricePaise: 29900,
    stock: 4,
    ...overrides,
  });

let ctx;
let db;
let books;

const fail = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Expected the call to throw");
};

beforeAll(async () => {
  ctx = await startTestDb();
  db = ctx.db;
  books = db.collection("books");
}, 120000);

afterAll(async () => {
  if (ctx) await ctx.stop();
});

describe("createBook", () => {
  it("makes the book active, manual, and stamps both dates", async () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const created = await createBook(db, newBook({ title: "Created Once" }), { now });

    expect(created.isActive).toBe(true);
    expect(created.source).toEqual({ provider: "manual" });
    expect(created.createdAt).toEqual(now);
    expect(created.updatedAt).toEqual(now);
    expect(await books.findOne({ _id: created._id })).toMatchObject({ title: "Created Once" });
  });

  it("returns 409 for a duplicate ISBN and names the field", async () => {
    await createBook(db, newBook({ title: "First Copy", isbn: "978-0-306-40615-7" }));
    const err = await fail(
      createBook(db, newBook({ title: "Second Copy", isbn: "9780306406157" })),
    );

    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ field: "isbn" });
    expect(await books.countDocuments({ title: "Second Copy" })).toBe(0);
  });

  it("allows many books without an ISBN", async () => {
    await createBook(db, newBook({ title: "No ISBN One" }));
    await createBook(db, newBook({ title: "No ISBN Two" }));
    expect(await books.countDocuments({ title: /^No ISBN/ })).toBe(2);
  });
});

describe("updateBook", () => {
  it("changes only the fields sent and refreshes updatedAt", async () => {
    const created = await createBook(db, newBook({ title: "Before" }), {
      now: new Date("2026-11-01T00:00:00Z"),
    });
    const later = new Date("2026-11-02T00:00:00Z");
    const changes = bookUpdateSchema.parse({ pricePaise: 35900 });

    const updated = await updateBook(db, created._id.toString(), changes, { now: later });

    expect(updated.pricePaise).toBe(35900);
    expect(updated.title).toBe("Before");
    expect(updated.stock).toBe(4);
    expect(updated.updatedAt).toEqual(later);
    expect(updated.createdAt).toEqual(created.createdAt);
  });

  it("works on an archived book and leaves it archived", async () => {
    const created = await createBook(db, newBook({ title: "Shelved" }));
    await books.updateOne({ _id: created._id }, { $set: { isActive: false } });

    const updated = await updateBook(db, created._id.toString(), { stock: 9 });

    expect(updated.stock).toBe(9);
    expect(updated.isActive).toBe(false);
  });

  it("returns 404 and does not create a book for an unknown id", async () => {
    const before = await books.countDocuments();
    const err = await fail(updateBook(db, new ObjectId().toString(), { title: "Ghost" }));

    expect(err.statusCode).toBe(404);
    expect(await books.countDocuments()).toBe(before);
    expect(await books.countDocuments({ title: "Ghost" })).toBe(0);
  });

  it("returns 404 for an id that is not an ObjectId", async () => {
    const err = await fail(updateBook(db, "not-an-id", { title: "x" }));
    expect(err.statusCode).toBe(404);
  });

  it("returns 409 when the new ISBN belongs to another book", async () => {
    await createBook(db, newBook({ title: "Owner", isbn: "9780141439518" }));
    const other = await createBook(db, newBook({ title: "Wants It" }));

    const err = await fail(updateBook(db, other._id.toString(), { isbn: "9780141439518" }));

    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ field: "isbn" });
  });
});

describe("deleteOrArchiveBook", () => {
  it("deletes a book that was never ordered and removes it from every cart", async () => {
    const created = await createBook(db, newBook({ title: "Never Ordered" }));
    const keep = await createBook(db, newBook({ title: "Stays In Cart" }));
    await db.collection("carts").insertMany([
      {
        userUid: "u1",
        items: [
          { bookId: created._id, qty: 1 },
          { bookId: keep._id, qty: 2 },
        ],
      },
      { userUid: "u2", items: [{ bookId: created._id, qty: 3 }] },
    ]);

    const result = await deleteOrArchiveBook(db, created._id.toString());

    expect(result).toEqual({ archived: false, deleted: true });
    expect(await books.findOne({ _id: created._id })).toBeNull();
    const carts = await db.collection("carts").find({}).toArray();
    const stillInCarts = carts.flatMap((cart) => cart.items.map((item) => item.bookId.toString()));
    expect(stillInCarts).not.toContain(created._id.toString());
    expect(stillInCarts).toContain(keep._id.toString());
  });

  it("only archives a book that appears in an order, and leaves carts alone", async () => {
    const created = await createBook(db, newBook({ title: "Was Ordered" }));
    await db.collection("orders").insertOne({ items: [{ bookId: created._id, qty: 1 }] });
    await db.collection("carts").insertOne({
      userUid: "u3",
      items: [{ bookId: created._id, qty: 1 }],
    });
    const now = new Date("2026-11-05T00:00:00Z");

    const result = await deleteOrArchiveBook(db, created._id.toString(), { now });

    expect(result).toEqual({ archived: true, deleted: false });
    const after = await books.findOne({ _id: created._id });
    expect(after.isActive).toBe(false);
    expect(after.updatedAt).toEqual(now);
    const cart = await db.collection("carts").findOne({ userUid: "u3" });
    expect(cart.items).toHaveLength(1);
  });

  it("returns 404 for an unknown or malformed id", async () => {
    expect((await fail(deleteOrArchiveBook(db, new ObjectId().toString()))).statusCode).toBe(404);
    expect((await fail(deleteOrArchiveBook(db, "nope"))).statusCode).toBe(404);
  });
});

describe("restoreBook", () => {
  it("brings an archived book back and refreshes updatedAt", async () => {
    const created = await createBook(db, newBook({ title: "Archived Then Back" }));
    await books.updateOne({ _id: created._id }, { $set: { isActive: false } });
    const now = new Date("2026-11-06T00:00:00Z");

    const restored = await restoreBook(db, created._id.toString(), { now });

    expect(restored.isActive).toBe(true);
    expect(restored.updatedAt).toEqual(now);
  });

  it("returns 404 for an unknown or malformed id", async () => {
    expect((await fail(restoreBook(db, new ObjectId().toString()))).statusCode).toBe(404);
    expect((await fail(restoreBook(db, "nope"))).statusCode).toBe(404);
  });
});

describe("getAdminBook", () => {
  it("returns the whole document, archived or not", async () => {
    const created = await createBook(db, newBook({ title: "Full Doc", description: "Long text." }));
    await books.updateOne({ _id: created._id }, { $set: { isActive: false } });

    const found = await getAdminBook(db, created._id.toString());

    expect(found.description).toBe("Long text.");
    expect(found.isActive).toBe(false);
  });

  it("returns null for an unknown or malformed id", async () => {
    expect(await getAdminBook(db, new ObjectId().toString())).toBeNull();
    expect(await getAdminBook(db, "nope")).toBeNull();
  });
});

describe("buildAdminFilter and listAdminBooks", () => {
  it("maps status to isActive, with 'all' adding no restriction", () => {
    expect(buildAdminFilter({ status: "active" })).toEqual({ isActive: true });
    expect(buildAdminFilter({ status: "archived" })).toEqual({ isActive: false });
    expect(buildAdminFilter({ status: "all" })).toEqual({});
  });

  it("treats typed regex characters as literal text", () => {
    const filter = buildAdminFilter({ q: "a.b(" });
    expect(filter.$or[0].title.test("a.b(")).toBe(true);
    expect(filter.$or[0].title.test("axb(")).toBe(false);
  });

  it("lists active books by default and archived ones when asked", async () => {
    const hidden = await createBook(db, newBook({ title: "Zed Hidden Gem" }));
    await books.updateOne({ _id: hidden._id }, { $set: { isActive: false } });

    const active = await listAdminBooks(db, query({ q: "Zed Hidden" }));
    const archived = await listAdminBooks(db, query({ q: "Zed Hidden", status: "archived" }));
    const all = await listAdminBooks(db, query({ q: "Zed Hidden", status: "all" }));

    expect(active.total).toBe(0);
    expect(archived.books.map((b) => b.title)).toEqual(["Zed Hidden Gem"]);
    expect(all.total).toBe(1);
  });

  it("finds a book by exact ISBN and leaves descriptions out of the table rows", async () => {
    await createBook(db, newBook({ title: "Has An ISBN", isbn: "0-14-143951-3" }));

    const result = await listAdminBooks(db, query({ q: "0-14-143951-3", status: "all" }));

    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("Has An ISBN");
    expect(result.books[0]).not.toHaveProperty("description");
  });

  it("pages the results and reports totals", async () => {
    const result = await listAdminBooks(db, query({ status: "all", limit: 2, page: 2 }));

    expect(result.books).toHaveLength(2);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(2);
    expect(result.totalPages).toBe(Math.ceil(result.total / 2));
  });

  it("sorts by stock, lowest first, to surface low-stock books", async () => {
    const result = await listAdminBooks(db, query({ status: "all", sort: "stock_asc" }));
    const stocks = result.books.map((b) => b.stock);
    expect(stocks).toEqual([...stocks].sort((a, b) => a - b));
  });
});

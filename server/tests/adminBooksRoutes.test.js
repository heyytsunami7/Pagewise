import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { startTestDb, makeApp, bearer } from "./helpers.js";

let ctx;
let app;

const admin = bearer("admin");
const validBook = (overrides = {}) => ({
  title: "Route Test Book",
  authors: ["Some Author"],
  description: "Something worth reading.",
  category: "Fiction",
  coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg",
  pricePaise: 29900,
  stock: 4,
  ...overrides,
});

beforeAll(async () => {
  ctx = await startTestDb();
  app = makeApp({ db: ctx.db });
}, 120000);

afterAll(async () => {
  if (ctx) await ctx.stop();
});

describe("admin book routes: access", () => {
  const routes = [
    ["get", "/admin/books"],
    ["get", "/admin/books/aaaaaaaaaaaaaaaaaaaaaaaa"],
    ["post", "/admin/books"],
    ["patch", "/admin/books/aaaaaaaaaaaaaaaaaaaaaaaa"],
    ["delete", "/admin/books/aaaaaaaaaaaaaaaaaaaaaaaa"],
    ["post", "/admin/books/aaaaaaaaaaaaaaaaaaaaaaaa/restore"],
  ];

  it.each(routes)("%s %s returns 401 without a token", async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it.each(routes)("%s %s returns 403 for a normal user", async (method, path) => {
    const res = await request(app)[method](path).set(bearer("alice"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for an admin email that is not verified", async () => {
    const res = await request(app).get("/admin/books").set(bearer("adminUnverified"));
    expect(res.status).toBe(403);
  });
});

describe("admin book routes: full flow", () => {
  let id;

  it("creates a book (201) as an active manual book", async () => {
    const res = await request(app).post("/admin/books").set(admin).send(validBook());

    expect(res.status).toBe(201);
    expect(res.body.book.isActive).toBe(true);
    expect(res.body.book.source).toEqual({ provider: "manual" });
    id = res.body.book._id;
  });

  it("rejects an invalid body with 400 and field details", async () => {
    const res = await request(app)
      .post("/admin/books")
      .set(admin)
      .send(validBook({ pricePaise: 5, coverUrl: "javascript:alert(1)" }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d) => d.path)).toEqual(
      expect.arrayContaining(["pricePaise", "coverUrl"]),
    );
  });

  it("rejects unknown fields so an admin cannot set isActive or source", async () => {
    const res = await request(app)
      .post("/admin/books")
      .set(admin)
      .send(validBook({ isActive: false, source: { provider: "openlibrary" } }));

    expect(res.status).toBe(400);
  });

  it("returns 409 for a duplicate ISBN", async () => {
    await request(app)
      .post("/admin/books")
      .set(admin)
      .send(validBook({ isbn: "9780141439518" }));
    const res = await request(app)
      .post("/admin/books")
      .set(admin)
      .send(validBook({ title: "Other", isbn: "978-0-14-143951-8" }));

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: "isbn" });
  });

  it("lists it, and the full book comes back by id", async () => {
    const list = await request(app).get("/admin/books?q=Route Test").set(admin);
    expect(list.status).toBe(200);
    expect(list.body.books.map((b) => b._id)).toContain(id);
    expect(list.body.books[0]).not.toHaveProperty("description");

    const one = await request(app).get(`/admin/books/${id}`).set(admin);
    expect(one.status).toBe(200);
    expect(one.body.book.description).toBe("Something worth reading.");
  });

  it("rejects an unknown list query key with 400", async () => {
    const res = await request(app).get("/admin/books?isActive=false").set(admin);
    expect(res.status).toBe(400);
  });

  it("updates only the fields sent", async () => {
    const res = await request(app).patch(`/admin/books/${id}`).set(admin).send({ stock: 9 });

    expect(res.status).toBe(200);
    expect(res.body.book.stock).toBe(9);
    expect(res.body.book.title).toBe("Route Test Book");
  });

  it("rejects an empty update with 400", async () => {
    const res = await request(app).patch(`/admin/books/${id}`).set(admin).send({});
    expect(res.status).toBe(400);
  });

  it("deletes a never-ordered book for real, then returns 404", async () => {
    const res = await request(app).delete(`/admin/books/${id}`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ archived: false, deleted: true });

    const again = await request(app).get(`/admin/books/${id}`).set(admin);
    expect(again.status).toBe(404);
  });
});

describe("admin book routes: archive and restore", () => {
  it("archives a book that was ordered, hides it by default, and restores it", async () => {
    const created = await request(app)
      .post("/admin/books")
      .set(admin)
      .send(validBook({ title: "Ordered Once" }));
    const id = created.body.book._id;
    await ctx.db
      .collection("orders")
      .insertOne({ items: [{ bookId: new (await import("mongodb")).ObjectId(id), qty: 1 }] });

    const del = await request(app).delete(`/admin/books/${id}`).set(admin);
    expect(del.body).toEqual({ archived: true, deleted: false });

    const active = await request(app).get("/admin/books?q=Ordered Once").set(admin);
    expect(active.body.total).toBe(0);
    const archived = await request(app)
      .get("/admin/books?q=Ordered Once&status=archived")
      .set(admin);
    expect(archived.body.total).toBe(1);

    const restored = await request(app).post(`/admin/books/${id}/restore`).set(admin);
    expect(restored.status).toBe(200);
    expect(restored.body.book.isActive).toBe(true);
  });

  it("returns 404 for an unknown id and 400 for a malformed one", async () => {
    const unknown = "bbbbbbbbbbbbbbbbbbbbbbbb";
    expect(
      (await request(app).patch(`/admin/books/${unknown}`).set(admin).send({ stock: 1 })).status,
    ).toBe(404);
    expect((await request(app).delete(`/admin/books/${unknown}`).set(admin)).status).toBe(404);
    expect((await request(app).post(`/admin/books/${unknown}/restore`).set(admin)).status).toBe(
      404,
    );
    expect((await request(app).get("/admin/books/not-an-id").set(admin)).status).toBe(400);
  });
});

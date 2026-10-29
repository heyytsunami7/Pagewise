import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { bookListQuerySchema, bookIdParamsSchema, BOOK_SORTS } = require("../src/schemas/bookQuery");

const parse = (query) => bookListQuerySchema.safeParse(query);

function failsAt(query, field) {
  const result = parse(query);
  expect(result.success).toBe(false);
  if (field) expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
}

describe("bookListQuerySchema", () => {
  it("fills in sensible defaults for an empty query", () => {
    expect(parse({}).data).toEqual({
      page: 1,
      limit: 12,
      q: undefined,
      category: undefined,
      minPricePaise: undefined,
      maxPricePaise: undefined,
      inStock: false,
      free: false,
      sort: "newest",
    });
  });

  it("converts every option into the shape the route uses", () => {
    const result = parse({
      page: "2",
      limit: "24",
      q: " holmes ",
      category: "Mystery",
      minPrice: "100",
      maxPrice: "500",
      inStock: "1",
      free: "true",
      sort: "price_asc",
    });
    expect(result.data).toEqual({
      page: 2,
      limit: 24,
      q: "holmes",
      category: "Mystery",
      minPricePaise: 10000,
      maxPricePaise: 50000,
      inStock: true,
      free: true,
      sort: "price_asc",
    });
  });

  it("sorts by relevance only when there is a search term", () => {
    expect(parse({ q: "dune" }).data.sort).toBe("relevance");
    expect(parse({ sort: "relevance" }).data.sort).toBe("newest");
    expect(parse({ q: "dune", sort: "title" }).data.sort).toBe("title");
  });

  it("treats empty values and a blank search as not set", () => {
    const result = parse({ category: "", q: "   ", minPrice: "", inStock: "", sort: "" });
    expect(result.success).toBe(true);
    expect(result.data.category).toBeUndefined();
    expect(result.data.q).toBeUndefined();
    expect(result.data.minPricePaise).toBeUndefined();
    expect(result.data.inStock).toBe(false);
    expect(result.data.sort).toBe("newest");
  });

  it("reads 0 and false as no", () => {
    expect(parse({ inStock: "0", free: "false" }).data).toMatchObject({
      inStock: false,
      free: false,
    });
  });

  it("rejects page and limit values out of range", () => {
    for (const page of ["0", "1001", "1.5", "abc"]) failsAt({ page }, "page");
    for (const limit of ["0", "49"]) failsAt({ limit }, "limit");
  });

  it("only accepts the ten categories, spelled exactly", () => {
    failsAt({ category: "Cooking" }, "category");
    failsAt({ category: "mystery" }, "category");
    expect(parse({ category: "Non-Fiction" }).success).toBe(true);
  });

  it("rejects bad prices and a minimum above the maximum", () => {
    failsAt({ minPrice: "-1" }, "minPrice");
    failsAt({ maxPrice: "10001" }, "maxPrice");
    failsAt({ minPrice: "abc" }, "minPrice");
    failsAt({ minPrice: "500", maxPrice: "100" }, "maxPrice");
    expect(parse({ minPrice: "100", maxPrice: "100" }).success).toBe(true);
  });

  it("rejects unknown flag values and sorts", () => {
    failsAt({ inStock: "yes" }, "inStock");
    failsAt({ sort: "popular" }, "sort");
  });

  it("rejects operator injection, unknown keys and repeated keys", () => {
    failsAt({ "category[$ne]": "x" });
    failsAt({ extra: "1" });
    failsAt({ category: ["Mystery", "Horror"] }, "category");
  });

  it("caps the length of the search text", () => {
    failsAt({ q: "x".repeat(101) }, "q");
    expect(parse({ q: "x".repeat(100) }).success).toBe(true);
  });

  it("offers exactly the documented sorts", () => {
    expect([...BOOK_SORTS]).toEqual(["relevance", "newest", "price_asc", "price_desc", "title"]);
  });
});

describe("bookIdParamsSchema", () => {
  it("accepts a 24-character hex id in either case", () => {
    expect(bookIdParamsSchema.safeParse({ id: "507f1f77bcf86cd799439011" }).success).toBe(true);
    expect(bookIdParamsSchema.safeParse({ id: "507F1F77BCF86CD799439011" }).success).toBe(true);
  });

  it("rejects anything else", () => {
    for (const id of ["123", "zzzzzzzzzzzzzzzzzzzzzzzz", "507f1f77bcf86cd7994390111", ""]) {
      expect(bookIdParamsSchema.safeParse({ id }).success).toBe(false);
    }
    expect(bookIdParamsSchema.safeParse({ id: "507f1f77bcf86cd799439011", x: "1" }).success).toBe(
      false,
    );
  });
});

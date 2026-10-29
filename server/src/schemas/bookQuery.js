const { z } = require("zod");
const { CATEGORIES } = require("../constants");

const BOOK_SORTS = Object.freeze(["relevance", "newest", "price_asc", "price_desc", "title"]);

// Query strings arrive as text, and forms often send empty values (?category=). Treat "" as absent.
const optional = (schema) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// "1"/"true" mean yes, "0"/"false" mean no. Anything else is a validation error.
const flag = optional(z.enum(["1", "true", "0", "false"])).transform(
  (value) => value === "1" || value === "true",
);

// Prices in the query are whole rupees (easier to type in a URL); the database uses paise.
const rupees = optional(z.coerce.number().int().min(0).max(10000));

/**
 * GET /books query. Strict, so unknown keys such as category[$ne] are rejected with a 400.
 * The parsed result is normalized for the route: prices in paise, flags as booleans,
 * and a sort that always makes sense ("relevance" only when there is a search term).
 */
const bookListQuerySchema = z
  .strictObject({
    page: optional(z.coerce.number().int().min(1).max(1000)),
    limit: optional(z.coerce.number().int().min(1).max(48)),
    q: optional(z.string().trim().max(100)),
    category: optional(z.enum(CATEGORIES)),
    minPrice: rupees,
    maxPrice: rupees,
    inStock: flag,
    free: flag,
    sort: optional(z.enum(BOOK_SORTS)),
  })
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    { message: "minPrice cannot be higher than maxPrice", path: ["maxPrice"] },
  )
  .transform((query) => {
    const q = query.q || undefined; // a search box with only spaces counts as no search
    const sort = query.sort ?? (q ? "relevance" : "newest");
    return {
      page: query.page ?? 1,
      limit: query.limit ?? 12,
      q,
      category: query.category,
      minPricePaise: query.minPrice === undefined ? undefined : query.minPrice * 100,
      maxPricePaise: query.maxPrice === undefined ? undefined : query.maxPrice * 100,
      inStock: query.inStock,
      free: query.free,
      sort: sort === "relevance" && !q ? "newest" : sort,
    };
  });

// Route parameter for /books/:id and similar: a MongoDB ObjectId as 24 hex characters.
const bookIdParamsSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/i, "Must be a valid book id"),
});

module.exports = { bookListQuerySchema, bookIdParamsSchema, BOOK_SORTS };

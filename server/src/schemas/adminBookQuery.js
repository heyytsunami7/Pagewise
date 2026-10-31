const { z } = require("zod");
const { CATEGORIES } = require("../constants");

const ADMIN_BOOK_STATUSES = Object.freeze(["active", "archived", "all"]);
const ADMIN_BOOK_SORTS = Object.freeze(["newest", "title", "price_asc", "price_desc", "stock_asc"]);

// Query strings arrive as text, and forms often send empty values. Treat "" as absent.
const optional = (schema) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/**
 * GET /admin/books query. Like the public list, it is strict (no unknown keys, no operators),
 * but admins can also see archived books and sort by stock to find books running low.
 */
const adminBookListQuerySchema = z
  .strictObject({
    page: optional(z.coerce.number().int().min(1).max(1000)),
    limit: optional(z.coerce.number().int().min(1).max(100)),
    q: optional(z.string().trim().max(100)),
    status: optional(z.enum(ADMIN_BOOK_STATUSES)),
    category: optional(z.enum(CATEGORIES)),
    sort: optional(z.enum(ADMIN_BOOK_SORTS)),
  })
  .transform((query) => ({
    page: query.page ?? 1,
    limit: query.limit ?? 20,
    q: query.q || undefined,
    status: query.status ?? "active",
    category: query.category,
    sort: query.sort ?? "newest",
  }));

module.exports = { adminBookListQuerySchema, ADMIN_BOOK_STATUSES, ADMIN_BOOK_SORTS };

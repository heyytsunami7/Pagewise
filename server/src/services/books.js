const { ObjectId } = require("mongodb");

// What a book card needs. Long text and internal fields stay out of list responses.
const LIST_PROJECTION = Object.freeze({
  title: 1,
  authors: 1,
  category: 1,
  coverUrl: 1,
  pricePaise: 1,
  stock: 1,
  isFeatured: 1,
  readUrl: 1,
});

// What the book page needs. isActive, source, timestamps and similarBooks stay internal.
const DETAIL_PROJECTION = Object.freeze({
  ...LIST_PROJECTION,
  description: 1,
  subjects: 1,
  externalUrl: 1,
  isbn: 1,
  pageCount: 1,
  publishedYear: 1,
});

// Every sort ends with _id, so books with equal values keep a stable order across pages.
const SORTS = Object.freeze({
  relevance: { score: { $meta: "textScore" }, _id: 1 },
  newest: { createdAt: -1, _id: 1 },
  price_asc: { pricePaise: 1, _id: 1 },
  price_desc: { pricePaise: -1, _id: 1 },
  title: { title: 1, _id: 1 },
});

// Case-insensitive ordering for titles ("apple" next to "Apple", not after "Zebra").
const TITLE_COLLATION = Object.freeze({ locale: "en", strength: 2 });

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turns a parsed list query (see schemas/bookQuery.js) into a MongoDB filter.
 * Only active books are ever listed. Every value here has already been validated,
 * so nothing from the request reaches MongoDB unchecked.
 */
function buildBookFilter({ q, category, minPricePaise, maxPricePaise, inStock, free } = {}) {
  const filter = { isActive: true };
  if (q) filter.$text = { $search: q };
  if (category) filter.category = category;
  if (minPricePaise !== undefined || maxPricePaise !== undefined) {
    filter.pricePaise = {};
    if (minPricePaise !== undefined) filter.pricePaise.$gte = minPricePaise;
    if (maxPricePaise !== undefined) filter.pricePaise.$lte = maxPricePaise;
  }
  if (inStock) filter.stock = { $gt: 0 };
  if (free) filter.readUrl = { $type: "string" };
  return filter;
}

/**
 * GET /books: one page of active books plus the totals the client needs for paging.
 * query: the output of bookListQuerySchema.
 */
async function listBooks(db, query) {
  const books = db.collection("books");
  const filter = buildBookFilter(query);
  const options = {
    projection: LIST_PROJECTION,
    sort: SORTS[query.sort] || SORTS.newest,
    skip: (query.page - 1) * query.limit,
    limit: query.limit,
  };
  // MongoDB does not allow a collation together with a text search.
  if (query.sort === "title" && !query.q) options.collation = TITLE_COLLATION;

  const [items, total] = await Promise.all([
    books.find(filter, options).toArray(),
    books.countDocuments(filter),
  ]);

  return {
    books: items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}

// GET /books/:id: the full book, or null if it does not exist or is archived.
async function getBookById(db, id) {
  if (!ObjectId.isValid(id)) return null;
  return db
    .collection("books")
    .findOne({ _id: new ObjectId(id), isActive: true }, { projection: DETAIL_PROJECTION });
}

/**
 * GET /books/:id/related: books by the same author first, then more from the same category.
 * Never the book itself, never an archived book. (Phase 10b adds precomputed neighbours.)
 */
async function relatedBooks(db, book, { limit = 6 } = {}) {
  const books = db.collection("books");
  const sameAuthor = await books
    .find(
      { isActive: true, _id: { $ne: book._id }, authors: { $in: book.authors || [] } },
      { projection: LIST_PROJECTION, sort: { title: 1, _id: 1 }, limit },
    )
    .toArray();
  if (sameAuthor.length >= limit) return sameAuthor;

  const sameCategory = await books
    .find(
      {
        isActive: true,
        category: book.category,
        _id: { $nin: [book._id, ...sameAuthor.map((related) => related._id)] },
      },
      {
        projection: LIST_PROJECTION,
        sort: { isFeatured: -1, title: 1, _id: 1 },
        limit: limit - sameAuthor.length,
      },
    )
    .toArray();
  return [...sameAuthor, ...sameCategory];
}

/**
 * GET /books/suggest: up to 8 active titles with a word that starts with the typed text.
 * The text is escaped, so characters like "." or "*" are matched literally.
 */
async function suggestTitles(db, text, { limit = 8 } = {}) {
  const term = String(text || "").trim();
  if (term.length < 2) return [];
  return db
    .collection("books")
    .find(
      { isActive: true, title: { $regex: new RegExp(`(?:^|\\s)${escapeRegex(term)}`, "i") } },
      {
        projection: { title: 1, coverUrl: 1 },
        sort: { title: 1, _id: 1 },
        collation: TITLE_COLLATION,
        limit,
      },
    )
    .toArray();
}

module.exports = {
  buildBookFilter,
  listBooks,
  getBookById,
  relatedBooks,
  suggestTitles,
  LIST_PROJECTION,
  DETAIL_PROJECTION,
  SORTS,
};
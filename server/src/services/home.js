const { CATEGORIES } = require("../constants");
const { LIST_PROJECTION } = require("./books");

// Orders that count as a sale. Pending (unpaid) and cancelled orders do not.
const SOLD_STATUSES = Object.freeze(["paid", "shipped", "delivered"]);

// Home page: the hand-picked books.
async function featuredBooks(db, { limit = 12 } = {}) {
  return db
    .collection("books")
    .find(
      { isActive: true, isFeatured: true },
      { projection: LIST_PROJECTION, sort: { title: 1, _id: 1 }, limit },
    )
    .toArray();
}

// Home page: the most recently added books.
async function newArrivals(db, { limit = 8 } = {}) {
  return db
    .collection("books")
    .find(
      { isActive: true },
      { projection: LIST_PROJECTION, sort: { createdAt: -1, _id: 1 }, limit },
    )
    .toArray();
}

/**
 * Home page: books ranked by copies sold in paid, shipped or delivered orders.
 * Archived books are skipped. Until there are enough sales (for example on a fresh
 * database), the list is topped up with featured books first, then the newest ones.
 */
async function bestSellers(db, { limit = 8 } = {}) {
  const sales = await db
    .collection("orders")
    .aggregate([
      { $match: { status: { $in: SOLD_STATUSES } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.bookId", units: { $sum: "$items.qty" } } },
      { $sort: { units: -1, _id: 1 } },
      { $limit: limit * 3 }, // room for best sellers that have since been archived
    ])
    .toArray();

  const books = db.collection("books");
  const soldIds = sales.map((sale) => sale._id);
  const soldBooks =
    soldIds.length > 0
      ? await books
          .find({ _id: { $in: soldIds }, isActive: true }, { projection: LIST_PROJECTION })
          .toArray()
      : [];
  const byId = new Map(soldBooks.map((book) => [String(book._id), book]));
  const ranked = soldIds
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .slice(0, limit);
  if (ranked.length >= limit) return ranked;

  const topUp = await books
    .find(
      { isActive: true, _id: { $nin: ranked.map((book) => book._id) } },
      {
        projection: LIST_PROJECTION,
        sort: { isFeatured: -1, createdAt: -1, _id: 1 },
        limit: limit - ranked.length,
      },
    )
    .toArray();
  return [...ranked, ...topUp];
}

// Category tiles: every category in the usual order, with its number of active books (0 if none).
async function categoryCounts(db) {
  const rows = await db
    .collection("books")
    .aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ])
    .toArray();
  const counts = new Map(rows.map((row) => [row._id, row.count]));
  return CATEGORIES.map((category) => ({ category, count: counts.get(category) || 0 }));
}

// Home page numbers. Real counts from the database, never invented ones.
async function publicStats(db) {
  const books = db.collection("books");
  const [total, freeToRead, categories] = await Promise.all([
    books.countDocuments({ isActive: true }),
    books.countDocuments({ isActive: true, readUrl: { $type: "string" } }),
    books.distinct("category", { isActive: true }),
  ]);
  return { books: total, categories: categories.length, freeToRead };
}

module.exports = {
  featuredBooks,
  newArrivals,
  bestSellers,
  categoryCounts,
  publicStats,
  SOLD_STATUSES,
};

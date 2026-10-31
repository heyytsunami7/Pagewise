const { ObjectId } = require("mongodb");
const { AppError } = require("../errors");

// The admin table shows more than a public card (status, source, dates), but not descriptions.
const ADMIN_LIST_PROJECTION = Object.freeze({
  title: 1,
  authors: 1,
  category: 1,
  coverUrl: 1,
  pricePaise: 1,
  stock: 1,
  isActive: 1,
  isFeatured: 1,
  readUrl: 1,
  isbn: 1,
  source: 1,
  createdAt: 1,
  updatedAt: 1,
});

const ADMIN_SORTS = Object.freeze({
  newest: { createdAt: -1, _id: 1 },
  title: { title: 1, _id: 1 },
  price_asc: { pricePaise: 1, _id: 1 },
  price_desc: { pricePaise: -1, _id: 1 },
  stock_asc: { stock: 1, _id: 1 },
});

const TITLE_COLLATION = Object.freeze({ locale: "en", strength: 2 });

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// A duplicate ISBN hits the unique index; turn it into a clear 409 instead of a generic one.
function rethrowDuplicate(err) {
  if (err && err.code === 11000) {
    throw AppError.conflict("Another book already uses this ISBN", { field: "isbn" });
  }
  throw err;
}

/**
 * Filter for the admin list. Search is a case-insensitive "contains" match on title or
 * author (escaped, so typed characters are literal), or an exact ISBN match.
 */
function buildAdminFilter({ q, status, category } = {}) {
  const filter = {};
  if (status === "active") filter.isActive = true;
  else if (status === "archived") filter.isActive = false;
  if (category) filter.category = category;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { title: pattern },
      { authors: pattern },
      { isbn: q.replace(/[-\s]/g, "").toUpperCase() },
    ];
  }
  return filter;
}

// GET /admin/books: one page of books for the admin table, archived ones included on request.
async function listAdminBooks(db, query) {
  const books = db.collection("books");
  const filter = buildAdminFilter(query);
  const options = {
    projection: ADMIN_LIST_PROJECTION,
    sort: ADMIN_SORTS[query.sort] || ADMIN_SORTS.newest,
    skip: (query.page - 1) * query.limit,
    limit: query.limit,
  };
  if (query.sort === "title") options.collation = TITLE_COLLATION;

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

// GET /admin/books/:id: the whole document, archived or not, for the edit form.
async function getAdminBook(db, id) {
  const _id = toObjectId(id);
  if (!_id) return null;
  return db.collection("books").findOne({ _id });
}

/**
 * POST /admin/books. data is the output of bookCreateSchema. The server decides the rest:
 * a new book is active, comes from the "manual" source, and gets its own timestamps.
 */
async function createBook(db, data, { now = new Date() } = {}) {
  const document = {
    ...data,
    isActive: true,
    source: { provider: "manual" },
    createdAt: now,
    updatedAt: now,
  };
  try {
    const { insertedId } = await db.collection("books").insertOne(document);
    return { _id: insertedId, ...document };
  } catch (err) {
    return rethrowDuplicate(err);
  }
}

/**
 * PATCH /admin/books/:id. changes is the output of bookUpdateSchema (only the fields sent).
 * Works on archived books too. Never creates a book (no upsert); a missing id is a 404.
 */
async function updateBook(db, id, changes, { now = new Date() } = {}) {
  const _id = toObjectId(id);
  if (!_id) throw AppError.notFound("Book not found");
  let updated;
  try {
    updated = await db
      .collection("books")
      .findOneAndUpdate(
        { _id },
        { $set: { ...changes, updatedAt: now } },
        { returnDocument: "after" },
      );
  } catch (err) {
    rethrowDuplicate(err);
  }
  if (!updated) throw AppError.notFound("Book not found");
  return updated;
}

/**
 * DELETE /admin/books/:id. A book that appears in any order is only archived, because orders
 * point to it. A book that was never ordered is deleted for real and removed from carts.
 * Returns { archived, deleted } so the admin screen can say what happened.
 */
async function deleteOrArchiveBook(db, id, { now = new Date() } = {}) {
  const _id = toObjectId(id);
  if (!_id) throw AppError.notFound("Book not found");
  const books = db.collection("books");
  if (!(await books.findOne({ _id }, { projection: { _id: 1 } }))) {
    throw AppError.notFound("Book not found");
  }

  const ordered = await db
    .collection("orders")
    .findOne({ "items.bookId": _id }, { projection: { _id: 1 } });
  if (ordered) {
    await books.updateOne({ _id }, { $set: { isActive: false, updatedAt: now } });
    return { archived: true, deleted: false };
  }

  await books.deleteOne({ _id });
  await db.collection("carts").updateMany({}, { $pull: { items: { bookId: _id } } });
  return { archived: false, deleted: true };
}

// POST /admin/books/:id/restore: bring an archived book back to the shop.
async function restoreBook(db, id, { now = new Date() } = {}) {
  const _id = toObjectId(id);
  if (!_id) throw AppError.notFound("Book not found");
  const restored = await db
    .collection("books")
    .findOneAndUpdate(
      { _id },
      { $set: { isActive: true, updatedAt: now } },
      { returnDocument: "after" },
    );
  if (!restored) throw AppError.notFound("Book not found");
  return restored;
}

module.exports = {
  buildAdminFilter,
  listAdminBooks,
  getAdminBook,
  createBook,
  updateBook,
  deleteOrArchiveBook,
  restoreBook,
  ADMIN_LIST_PROJECTION,
};

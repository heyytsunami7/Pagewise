const { isDeepStrictEqual } = require("node:util");
const { CATEGORIES } = require("../../src/constants");
const { assertUnique } = require("./buildCatalog");

// What describes a book. A re-seed may change these. Price, stock, featured and active are
// "operational": they are set when a book is first inserted and never touched again, so a
// re-seed can never undo what happened in the shop (orders lowering stock, an admin editing a price).
const DESCRIPTIVE_FIELDS = [
  "title",
  "authors",
  "description",
  "category",
  "subjects",
  "coverUrl",
  "readUrl",
  "externalUrl",
  "isbn",
  "pageCount",
  "publishedYear",
];
const OPTIONAL_FIELDS = ["readUrl", "externalUrl", "isbn", "pageCount", "publishedYear"];

const DEV_OR_TEST = /_(dev|test)$/;

const sourceKey = (doc) => `${doc.source.provider}:${doc.source.externalId}`;

function pickPresent(doc) {
  return Object.fromEntries(
    DESCRIPTIVE_FIELDS.filter((field) => doc[field] !== undefined && doc[field] !== null).map(
      (field) => [field, doc[field]],
    ),
  );
}

// Seeding writes data, so the target database must be a dev or test one. A real database
// needs two deliberate acts: ALLOW_PROD_SEED=yes-i-am-sure and an explicit --db name.
function assertSafeDatabase({ dbName, explicitDb = null, allowProd = false }) {
  if (DEV_OR_TEST.test(dbName)) return;
  if (allowProd && explicitDb === dbName) return;
  throw new Error(
    `Refusing to seed "${dbName}": database names must end in _dev or _test. ` +
      "To seed another database on purpose, set ALLOW_PROD_SEED=yes-i-am-sure and pass --db <name>.",
  );
}

// Dropping the books collection is only ever allowed on a dev or test database.
function assertCanReset(dbName) {
  if (!DEV_OR_TEST.test(dbName)) {
    throw new Error(
      `Refusing to reset "${dbName}": --reset only works on _dev or _test databases.`,
    );
  }
}

/**
 * Checks the contents of data/catalog.json against the schema and returns the parsed entries
 * (trimmed text, normalized ISBNs). Throws one readable error instead of seeding bad data.
 */
function prepareEntries(catalog, schema) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.books)) {
    throw new Error("data/catalog.json is not a version 1 catalog. Run npm run catalog:build.");
  }
  const entries = [];
  const failures = [];
  for (const book of catalog.books) {
    const result = schema.safeParse(book);
    if (result.success) {
      entries.push(result.data);
    } else {
      failures.push({
        title: book?.title,
        issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} book(s) in the catalog are invalid, for example "${failures[0].title}": ` +
        failures[0].issues.join("; "),
    );
  }
  assertUnique(entries);
  return entries;
}

/**
 * Writes catalog entries into the books collection. Safe to run again and again:
 *  - a new book is inserted (active, with createdAt and updatedAt)
 *  - an existing book only changes when its descriptive fields differ (updatedAt is bumped)
 *  - price, stock, featured and active are never overwritten for an existing book
 *  - books that are not in the catalog (for example hand-added ones) are left alone
 * Books are matched by source.provider + source.externalId.
 */
async function seedBooks(db, entries, { now = new Date() } = {}) {
  const result = { total: entries.length, inserted: 0, updated: 0, unchanged: 0 };
  if (entries.length === 0) return result;

  const books = db.collection("books");
  const existing = await books
    .find({
      "source.provider": { $in: [...new Set(entries.map((entry) => entry.source.provider))] },
      "source.externalId": { $in: entries.map((entry) => entry.source.externalId) },
    })
    .toArray();
  const byKey = new Map(existing.map((doc) => [sourceKey(doc), doc]));

  const operations = [];
  for (const entry of entries) {
    const doc = byKey.get(sourceKey(entry));

    if (!doc) {
      operations.push({
        insertOne: { document: { ...entry, isActive: true, createdAt: now, updatedAt: now } },
      });
      result.inserted += 1;
      continue;
    }

    const wanted = pickPresent(entry);
    if (isDeepStrictEqual(wanted, pickPresent(doc))) {
      result.unchanged += 1;
      continue;
    }

    const update = { $set: { ...wanted, updatedAt: now } };
    const gone = OPTIONAL_FIELDS.filter((field) => !(field in wanted));
    if (gone.length > 0) update.$unset = Object.fromEntries(gone.map((field) => [field, ""]));
    operations.push({ updateOne: { filter: { _id: doc._id }, update } });
    result.updated += 1;
  }

  if (operations.length > 0) await books.bulkWrite(operations);
  return result;
}

// Drops the books collection (dev and test only; the caller must run assertCanReset first).
// Returns whether there was anything to drop. Indexes must be recreated afterwards.
async function resetBooks(db) {
  const exists =
    (await db.listCollections({ name: "books" }, { nameOnly: true }).toArray()).length > 0;
  if (exists) await db.collection("books").drop();
  return exists;
}

// { Fiction: 25, ... } for the categories that have books, in the order of CATEGORIES.
async function countByCategory(db) {
  const rows = await db
    .collection("books")
    .aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }])
    .toArray();
  const counts = new Map(rows.map((row) => [row._id, row.count]));
  return Object.fromEntries(
    CATEGORIES.filter((category) => counts.has(category)).map((category) => [
      category,
      counts.get(category),
    ]),
  );
}

// Command line options for scripts/seed.js.
function parseSeedArgs(argv) {
  const options = { reset: false, db: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reset") {
      options.reset = true;
    } else if (arg === "--db") {
      const name = argv[i + 1];
      if (!name || !/^[A-Za-z0-9_-]{1,38}$/.test(name)) {
        throw new Error(
          "--db needs a database name (letters, numbers, _ and -, up to 38 characters)",
        );
      }
      options.db = name;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

module.exports = {
  seedBooks,
  assertSafeDatabase,
  assertCanReset,
  prepareEntries,
  resetBooks,
  countByCategory,
  parseSeedArgs,
  DESCRIPTIVE_FIELDS,
};

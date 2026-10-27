const { CATEGORIES } = require("../../src/constants");
const { mergeCatalog } = require("./mergeCatalog");
const { addDemoValues } = require("./demoValues");

const DEFAULT_PER_CATEGORY = 25;
const DEFAULT_MIN_PER_CATEGORY = 15;
const DEFAULT_FREE_PER_CATEGORY = 3;

// Fields that only help while choosing books. They are not part of a catalog entry.
const HELPER_FIELDS = ["hasRealDescription", "rank", "downloadCount"];

// Best books first: a real description, then popularity rank, then title.
function compareQuality(a, b) {
  return (
    Number(b.hasRealDescription) - Number(a.hasRealDescription) ||
    a.rank - b.rank ||
    a.title.localeCompare(b.title)
  );
}

/**
 * Keeps at most perCategory books in each category, in the order of CATEGORIES.
 * Up to freePerCategory slots go to free-to-read books first, so the "Read free" feature
 * is not crowded out by books that happen to have better descriptions.
 */
function selectBooks(
  books,
  { perCategory = DEFAULT_PER_CATEGORY, freePerCategory = DEFAULT_FREE_PER_CATEGORY } = {},
) {
  const selected = [];
  for (const category of CATEGORIES) {
    const inCategory = books.filter((book) => book.category === category).sort(compareQuality);
    const chosen = new Set(
      inCategory.filter((book) => book.readUrl).slice(0, Math.min(freePerCategory, perCategory)),
    );
    for (const book of inCategory) {
      if (chosen.size >= perCategory) break;
      chosen.add(book);
    }
    selected.push(...[...chosen].sort(compareQuality));
  }
  return selected;
}

function stripHelperFields(book) {
  const entry = { ...book };
  for (const field of HELPER_FIELDS) delete entry[field];
  return entry;
}

// The seed relies on unique indexes, so duplicates are caught here with a readable message.
function assertUnique(entries) {
  const sources = new Set();
  const isbns = new Set();
  for (const entry of entries) {
    const source = `${entry.source.provider}:${entry.source.externalId}`;
    if (sources.has(source)) throw new Error(`Duplicate source in the catalog: ${source}`);
    sources.add(source);
    if (entry.isbn) {
      if (isbns.has(entry.isbn)) throw new Error(`Duplicate ISBN in the catalog: ${entry.isbn}`);
      isbns.add(entry.isbn);
    }
  }
}

function validateEntries(entries, schema) {
  const valid = [];
  const failures = [];
  for (const entry of entries) {
    const result = schema.safeParse(entry);
    if (result.success) {
      valid.push(result.data); // the parsed copy has trimmed text and normalized ISBNs
    } else {
      failures.push({
        title: entry.title,
        issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
  }
  return { valid, failures };
}

// Real-world data has junk (for example a 300-character "complete works" title). Books that
// would fail the schema are skipped up front, so choosing books only ever sees valid ones.
// A stand-in price, stock and featured flag are added just for this check.
function filterValid(books, schema) {
  const valid = [];
  const skipped = [];
  for (const book of books) {
    const candidate = {
      ...stripHelperFields(book),
      pricePaise: 19900,
      stock: 1,
      isFeatured: false,
    };
    const result = schema.safeParse(candidate);
    if (result.success) {
      valid.push(book);
    } else {
      skipped.push({
        title: book.title,
        issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
  }
  return { valid, skipped };
}

/**
 * Builds the final catalog from the two raw files:
 * merge, skip books that fail the schema, choose books per category, add demo
 * price/stock/featured, strip helper fields, validate every entry, and check uniqueness.
 * Throws a readable error (with .details) instead of returning a partly broken catalog.
 *
 * schema: anything with safeParse (the real catalogBookSchema in the CLI).
 */
function buildCatalog({
  openlibrary,
  gutendex,
  schema,
  perCategory = DEFAULT_PER_CATEGORY,
  minPerCategory = DEFAULT_MIN_PER_CATEGORY,
  freePerCategory = DEFAULT_FREE_PER_CATEGORY,
  featuredCount = 12,
}) {
  const merged = mergeCatalog({ openlibrary, gutendex });
  const { valid: candidates, skipped } = filterValid(merged.books, schema);
  const selected = selectBooks(candidates, { perCategory, freePerCategory });

  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const book of selected) counts[book.category] += 1;

  const short = CATEGORIES.filter((category) => counts[category] < minPerCategory);
  if (short.length > 0) {
    const error = new Error(
      `These categories have fewer than ${minPerCategory} books: ` +
        `${short.map((category) => `${category} (${counts[category]})`).join(", ")}. ` +
        "Fetch more books (for example npm run catalog:fetch:openlibrary -- --only <Category> " +
        "--per-category 60) or lower --min-per-category.",
    );
    error.details = { counts };
    throw error;
  }

  const withValues = addDemoValues(selected, { featuredCount });
  const { valid, failures } = validateEntries(withValues.map(stripHelperFields), schema);
  if (failures.length > 0) {
    const error = new Error(
      `${failures.length} book(s) failed validation, for example "${failures[0].title}": ` +
        failures[0].issues.join("; "),
    );
    error.details = { failures };
    throw error;
  }
  assertUnique(valid);

  return {
    catalog: {
      version: 1,
      sources: {
        openlibrary: openlibrary?.fetchedAt ?? null,
        gutendex: gutendex?.fetchedAt ?? null,
      },
      books: valid,
    },
    report: {
      merge: merged.report,
      skippedInvalid: skipped.length,
      skippedExamples: skipped.slice(0, 5),
      total: valid.length,
      perCategory: counts,
      freeToRead: valid.filter((book) => book.readUrl).length,
      withRealDescription: withValues.filter((book) => book.hasRealDescription).length,
      featured: valid.filter((book) => book.isFeatured).length,
      outOfStock: valid.filter((book) => book.stock === 0).length,
    },
  };
}

function wholeNumber(flag, value, min, max) {
  const number = Number(value);
  if (value === undefined || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${flag} needs a whole number between ${min} and ${max}`);
  }
  return number;
}

// Command line options for scripts/build-catalog.js.
function parseBuildArgs(argv) {
  const options = {
    perCategory: DEFAULT_PER_CATEGORY,
    minPerCategory: DEFAULT_MIN_PER_CATEGORY,
    freePerCategory: DEFAULT_FREE_PER_CATEGORY,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--per-category") options.perCategory = wholeNumber(arg, argv[i + 1], 1, 100);
    else if (arg === "--min-per-category") {
      options.minPerCategory = wholeNumber(arg, argv[i + 1], 0, 100);
    } else if (arg === "--free-per-category") {
      options.freePerCategory = wholeNumber(arg, argv[i + 1], 0, 25);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
    i += 1;
  }

  return options;
}

module.exports = {
  buildCatalog,
  selectBooks,
  assertUnique,
  parseBuildArgs,
  DEFAULT_PER_CATEGORY,
  DEFAULT_MIN_PER_CATEGORY,
  DEFAULT_FREE_PER_CATEGORY,
};

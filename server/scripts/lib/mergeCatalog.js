const { assignCategory } = require("./categoryMap");

// Shown when a book has no real description. Phase 10b's recommender ignores these exact texts.
const GUTENBERG_PLACEHOLDER = "A public-domain classic from Project Gutenberg.";
const GENERIC_PLACEHOLDER = "No description is available for this book yet.";
const PLACEHOLDER_DESCRIPTIONS = Object.freeze([GUTENBERG_PLACEHOLDER, GENERIC_PLACEHOLDER]);

const MAX_SUBJECTS = 10;

const isPlaceholderDescription = (text) => PLACEHOLDER_DESCRIPTIONS.includes(text);

// "The Adventures of Sherlock Holmes" and "Adventures of Sherlock Holmes" become the same key.
function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "")
    .trim();
}

// Last word of the author's name, so "Arthur Conan Doyle" and "A. Conan Doyle" match.
function lastNameToken(author) {
  const tokens = normalizeTitle(author).split(" ").filter(Boolean);
  return tokens[tokens.length - 1] || "";
}

function bookKey(book) {
  return `${normalizeTitle(book.title)}|${lastNameToken(book.authors?.[0])}`;
}

function uniqueCaseInsensitive(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

const withinRange = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : undefined;

// Drops keys whose value is undefined or null, so optional fields are simply absent.
function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null),
  );
}

// One entry per source book, remembering which category lists it was fetched under.
function collectEntries(raw, provider) {
  const byId = new Map();
  let rows = 0;
  for (const [category, books] of Object.entries(raw?.categories || {})) {
    books.forEach((book, index) => {
      rows += 1;
      const existing = byId.get(book.externalId);
      if (existing) {
        existing.hints.push(category);
        existing.rank = Math.min(existing.rank, index);
        return;
      }
      byId.set(book.externalId, {
        provider,
        title: book.title,
        authors: book.authors || [],
        description: book.description || null,
        coverUrl: book.coverUrl,
        readUrl: book.readUrl,
        externalUrl: book.externalUrl,
        isbn: book.isbn || undefined,
        pageCount: book.pageCount ?? undefined,
        publishedYear: book.firstPublishYear ?? undefined,
        subjects: book.subjects || [],
        hints: [category],
        rank: index,
        downloadCount: book.downloadCount ?? 0,
        source: { provider, externalId: book.externalId },
      });
    });
  }
  return { entries: [...byId.values()], rows };
}

// Combines duplicates. Open Library is the base (better metadata and covers); Gutendex adds
// the free read link. Anything the base lacks is filled in from the others.
function mergeGroup(group) {
  const sorted = [...group].sort(
    (a, b) =>
      (a.provider === "openlibrary" ? 0 : 1) - (b.provider === "openlibrary" ? 0 : 1) ||
      a.rank - b.rank,
  );
  const [base, ...others] = sorted;
  const merged = { ...base, hints: [...base.hints], subjects: [...base.subjects] };

  for (const other of others) {
    for (const field of [
      "description",
      "readUrl",
      "externalUrl",
      "isbn",
      "pageCount",
      "publishedYear",
    ]) {
      if (!merged[field] && other[field]) merged[field] = other[field];
    }
    merged.subjects.push(...other.subjects);
    merged.hints.push(...other.hints);
    merged.rank = Math.min(merged.rank, other.rank);
    merged.downloadCount = Math.max(merged.downloadCount, other.downloadCount);
  }

  merged.subjects = uniqueCaseInsensitive(merged.subjects);
  merged.hints = [...new Set(merged.hints)];
  return merged;
}

// Tags that appear on several books are the useful ones for search and recommendations.
function pickTopSubjects(subjects, frequency) {
  return subjects
    .map((subject, index) => ({ subject, index, count: frequency.get(subject.toLowerCase()) || 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, MAX_SUBJECTS)
    .map((item) => item.subject);
}

/**
 * Merges the raw Open Library and Gutendex files into one list of books in our schema
 * (still without price, stock or featured flag, which come later).
 *
 * Steps: collect one entry per source book, merge duplicates, give each book a category
 * (dropping those that match none), fill in descriptions, keep the 10 most useful subjects,
 * and make sure no two books share an ISBN.
 */
function mergeCatalog({ openlibrary, gutendex }) {
  const ol = collectEntries(openlibrary, "openlibrary");
  const gu = collectEntries(gutendex, "gutendex");
  const entries = [...ol.entries, ...gu.entries];

  const groups = new Map();
  for (const entry of entries) {
    const key = bookKey(entry);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const merged = [...groups.values()].map(mergeGroup);

  const categorized = [];
  let droppedNoCategory = 0;
  for (const entry of merged) {
    const category = assignCategory(entry.subjects, { hints: entry.hints });
    if (category) categorized.push({ ...entry, category });
    else droppedNoCategory += 1;
  }

  const frequency = new Map();
  for (const entry of categorized) {
    for (const subject of entry.subjects) {
      const key = subject.toLowerCase();
      frequency.set(key, (frequency.get(key) || 0) + 1);
    }
  }

  categorized.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

  const usedIsbns = new Set();
  const books = categorized.map((entry) => {
    let isbn = entry.isbn;
    if (isbn) {
      if (usedIsbns.has(isbn)) isbn = undefined;
      else usedIsbns.add(isbn);
    }
    const hasRealDescription = Boolean(entry.description);
    return compact({
      title: entry.title,
      authors: entry.authors,
      description:
        entry.description || (entry.readUrl ? GUTENBERG_PLACEHOLDER : GENERIC_PLACEHOLDER),
      hasRealDescription,
      category: entry.category,
      subjects: pickTopSubjects(entry.subjects, frequency),
      coverUrl: entry.coverUrl,
      readUrl: entry.readUrl,
      externalUrl: entry.externalUrl,
      isbn,
      pageCount: withinRange(entry.pageCount, 1, 10000),
      publishedYear: withinRange(entry.publishedYear, 1000, new Date().getFullYear() + 1),
      source: entry.source,
      rank: entry.rank,
      downloadCount: entry.downloadCount,
    });
  });

  return {
    books,
    report: {
      openLibraryRows: ol.rows,
      gutendexRows: gu.rows,
      uniqueSourceBooks: entries.length,
      duplicatesMerged: entries.length - merged.length,
      droppedNoCategory,
      books: books.length,
    },
  };
}

module.exports = {
  mergeCatalog,
  normalizeTitle,
  bookKey,
  isPlaceholderDescription,
  PLACEHOLDER_DESCRIPTIONS,
  GUTENBERG_PLACEHOLDER,
  GENERIC_PLACEHOLDER,
};

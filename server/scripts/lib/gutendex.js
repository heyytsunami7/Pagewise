const { cleanSubjects } = require("./openlibrary");

const BASE_URL = "https://gutendex.com";
const DEFAULT_MAX_PAGES = 5;

function searchUrl({ topic, page = 1 }) {
  const params = new URLSearchParams({
    languages: "en",
    copyright: "false", // public-domain books only
    topic,
    page: String(page),
  });
  return `${BASE_URL}/books?${params.toString()}`;
}

function httpOrNull(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

// Gutenberg writes "Austen, Jane" and sometimes adds life dates; we want "Jane Austen".
function flipAuthorName(name) {
  const withoutDates = String(name || "")
    .replace(/,?\s*\d{3,4}\??\s*-\s*\d{0,4}\??/g, "")
    .trim();
  const [last, ...rest] = withoutDates.split(",");
  if (rest.length === 0) return withoutDates;
  return `${rest.join(",").trim()} ${last.trim()}`.trim();
}

function uniqueAuthors(authors) {
  const seen = new Set();
  const out = [];
  for (const author of authors || []) {
    const name = flipAuthorName(author?.name);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out.slice(0, 5);
}

// "Moby Dick; Or, The Whale" becomes "Moby Dick"; line breaks inside titles become spaces.
function cleanTitle(title) {
  return String(title || "")
    .split(";")[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function findFormat(formats, type) {
  if (!formats) return null;
  if (formats[type]) return formats[type];
  const entry = Object.entries(formats).find(([key]) => key.startsWith(type));
  return entry ? entry[1] : null;
}

// Best link to actually read the book: HTML in the browser, then EPUB, then plain text.
function pickReadUrl(formats) {
  return httpOrNull(
    findFormat(formats, "text/html") ||
      findFormat(formats, "application/epub+zip") ||
      findFormat(formats, "text/plain"),
  );
}

function cleanSummary(summaries) {
  const first = Array.isArray(summaries)
    ? summaries.find((summary) => typeof summary === "string" && summary.trim())
    : null;
  if (!first) return null;
  const text = first
    .replace(/\(This is an automatically generated summary\.?\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);
  return text || null;
}

// Turns one Gutendex result into our shape, or null if it is not a usable book for the store.
function parseBook(item) {
  if (!item || item.id === undefined || item.id === null) return null;
  if (item.copyright === true) return null;
  if (item.media_type && item.media_type !== "Text") return null;
  if (Array.isArray(item.languages) && !item.languages.includes("en")) return null;

  const title = cleanTitle(item.title);
  const authors = uniqueAuthors(item.authors);
  const coverUrl = httpOrNull(item.formats?.["image/jpeg"]);
  const readUrl = pickReadUrl(item.formats);
  if (!title || authors.length === 0 || !coverUrl || !readUrl) return null;

  const shelves = (item.bookshelves || []).map((shelf) =>
    String(shelf).replace(/^Category:\s*/i, ""),
  );

  return {
    externalId: String(item.id),
    title,
    authors,
    readUrl,
    externalUrl: `https://www.gutenberg.org/ebooks/${item.id}`,
    coverUrl,
    subjects: cleanSubjects([...(item.subjects || []), ...shelves]),
    description: cleanSummary(item.summaries),
    downloadCount: Number.isFinite(item.download_count) ? item.download_count : 0,
  };
}

function createGutendexClient(http, { maxPages = DEFAULT_MAX_PAGES } = {}) {
  return {
    // Results come back most-downloaded first. Follows Gutendex's own "next" links.
    async searchTopic(topic, { limit = 10 } = {}) {
      const books = [];
      let url = searchUrl({ topic });
      for (let page = 1; url && page <= maxPages && books.length < limit; page += 1) {
        const data = await http.getJson(url);
        for (const item of data.results || []) {
          const book = parseBook(item);
          if (book) books.push(book);
        }
        const next = typeof data.next === "string" ? data.next : null;
        url = next && next.startsWith(`${BASE_URL}/`) ? next : null;
      }
      return books.slice(0, limit);
    },
  };
}

module.exports = {
  createGutendexClient,
  parseBook,
  flipAuthorName,
  cleanTitle,
  pickReadUrl,
  searchUrl,
};

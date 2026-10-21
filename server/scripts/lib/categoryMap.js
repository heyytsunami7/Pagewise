// Decides which of our ten categories a book belongs to, from its subject tags.
//
// A book takes the first category in CATEGORY_PRIORITY whose keywords appear in any of its
// subjects, so specific genres win over the generic Non-Fiction and Fiction. If a book was
// fetched under a specific genre and its subjects confirm that genre, that genre wins instead.
// A book whose subjects match nothing gets null and is left out of the catalog.

const CATEGORY_PRIORITY = Object.freeze([
  "Mystery",
  "Horror",
  "Fantasy",
  "Humor",
  "Biography",
  "Psychology",
  "History",
  "Business",
  "Non-Fiction",
  "Fiction",
]);

const CATEGORY_KEYWORDS = Object.freeze({
  Mystery: [
    "mystery",
    "mysteries",
    "detective",
    "detectives",
    "crime",
    "murder",
    "thriller",
    "thrillers",
  ],
  Horror: ["horror", "ghost", "ghosts", "gothic", "vampire", "vampires", "supernatural"],
  Fantasy: ["fantasy", "magic", "dragons", "fairy tales", "mythology"],
  Humor: ["humor", "humour", "humorous", "satire", "comedy", "wit"],
  Biography: ["biography", "biographies", "autobiography", "memoir", "memoirs", "diaries"],
  Psychology: ["psychology", "mind", "behavior", "behaviour", "self-help", "mental"],
  History: ["history", "war", "ancient", "historical", "civilization", "civilisation"],
  Business: ["business", "economics", "management", "entrepreneur", "entrepreneurship", "finance"],
  "Non-Fiction": [
    "essays",
    "philosophy",
    "science",
    "nature",
    "travel",
    "nonfiction",
    "non-fiction",
  ],
  Fiction: ["fiction", "novel", "novels", "literary", "classics", "adventure", "romance"],
});

// Categories that are about real subjects. A subject like "Historical fiction" must not
// count towards History, so subjects that look like fiction are ignored for these.
const FACTUAL_CATEGORIES = new Set([
  "Biography",
  "Psychology",
  "History",
  "Business",
  "Non-Fiction",
]);
const LOOKS_LIKE_FICTION = /\b(fiction|novels?|stories|tales|poetry|poems|drama|plays)\b/i;
const IS_NON_FICTION = /non-?fiction/i;

// Specific genres can be confirmed by the category a book was fetched under; these cannot.
const GENERIC_CATEGORIES = new Set(["Fiction", "Non-Fiction"]);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const KEYWORD_PATTERNS = Object.fromEntries(
  Object.entries(CATEGORY_KEYWORDS).map(([category, keywords]) => [
    category,
    new RegExp(`\\b(?:${keywords.map(escapeRegex).join("|")})\\b`, "i"),
  ]),
);

function subjectMatches(category, subject) {
  if (
    FACTUAL_CATEGORIES.has(category) &&
    LOOKS_LIKE_FICTION.test(subject) &&
    !IS_NON_FICTION.test(subject)
  ) {
    return false;
  }
  return KEYWORD_PATTERNS[category].test(subject);
}

// Every category the subjects point to, most specific first.
function matchingCategories(subjects) {
  const list = (subjects || []).filter((subject) => typeof subject === "string");
  return CATEGORY_PRIORITY.filter((category) =>
    list.some((subject) => subjectMatches(category, subject)),
  );
}

// hint: the category the book was fetched under (optional).
function assignCategory(subjects, { hints = [] } = {}) {
  const matches = matchingCategories(subjects);
  const confirmed = [].concat(hints).filter((hint) => matches.includes(hint));
  const specific = confirmed.find((hint) => !GENERIC_CATEGORIES.has(hint));
  return specific ?? confirmed[0] ?? matches[0] ?? null;
}
module.exports = { CATEGORY_PRIORITY, CATEGORY_KEYWORDS, matchingCategories, assignCategory };

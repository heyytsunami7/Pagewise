// Open Library subject queries for each of our ten categories. They are tried in order
// until enough usable books (with a cover) have been found for that category.
const OPENLIBRARY_QUERIES = Object.freeze({
  Fiction: ["fiction"],
  "Non-Fiction": ["nonfiction", "essays"],
  Mystery: ["mystery", "detective and mystery stories"],
  Fantasy: ["fantasy"],
  Horror: ["horror"],
  Humor: ["humor"],
  Biography: ["biography"],
  Psychology: ["psychology"],
  History: ["history"],
  Business: ["business"],
});

// Gutendex (Project Gutenberg) topics for each category, tried in order the same way.
// A topic matches a key phrase in a book's subjects or bookshelves.
const GUTENDEX_TOPICS = Object.freeze({
  Fiction: ["fiction"],
  "Non-Fiction": ["essays"],
  Mystery: ["detective"],
  Fantasy: ["fantasy"],
  Horror: ["horror"],
  Humor: ["humor"],
  Biography: ["biography"],
  Psychology: ["psychology"],
  History: ["history"],
  Business: ["business", "economics"],
});

module.exports = { OPENLIBRARY_QUERIES, GUTENDEX_TOPICS };

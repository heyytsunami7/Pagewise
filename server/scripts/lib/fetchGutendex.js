const { GUTENDEX_TOPICS } = require("./categories");

/**
 * Collects free public-domain books per category from Gutendex (Project Gutenberg).
 *
 * client: { searchTopic(topic, { limit }) }
 * existing: a previous result to continue from. Categories already in it are skipped.
 * onCategoryDone(result): called after every category so the caller can save progress.
 *
 * A failed search stops the run; everything finished so far has already been reported.
 */
async function fetchGutendexCatalog({
  client,
  topics = GUTENDEX_TOPICS,
  categories = Object.keys(topics),
  perCategory = 10,
  existing = null,
  onCategoryDone = async () => {},
  log = () => {},
  now = () => new Date(),
}) {
  const result = {
    source: "gutendex",
    fetchedAt: now().toISOString(),
    categories: { ...(existing?.categories || {}) },
  };

  for (const category of categories) {
    if (!topics[category]) {
      throw new Error(`No Gutendex topics configured for category: ${category}`);
    }
    if (result.categories[category]) {
      log(`skip ${category} (already fetched)`);
      continue;
    }

    const books = [];
    const seen = new Set();
    for (const topic of topics[category]) {
      if (books.length >= perCategory) break;
      log(`search ${category}: ${topic}`);
      const found = await client.searchTopic(topic, { limit: perCategory });
      for (const book of found) {
        if (books.length >= perCategory) break;
        if (seen.has(book.externalId)) continue;
        seen.add(book.externalId);
        books.push(book);
      }
    }

    result.categories[category] = books;
    log(`done ${category}: ${books.length} books`);
    await onCategoryDone(result);
  }

  return result;
}

function wholeNumber(flag, value, min, max) {
  const number = Number(value);
  if (value === undefined || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${flag} needs a whole number between ${min} and ${max}`);
  }
  return number;
}

// Command line options for scripts/fetch-gutendex.js.
function parseGutendexArgs(argv, allCategories) {
  const options = { resume: false, perCategory: 10, only: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--per-category") {
      options.perCategory = wholeNumber(arg, argv[i + 1], 1, 100);
      i += 1;
    } else if (arg === "--only") {
      const names = (argv[i + 1] || "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      const unknown = names.filter((name) => !allCategories.includes(name));
      if (names.length === 0 || unknown.length > 0) {
        throw new Error(
          `--only needs known categories. Unknown: ${unknown.join(", ") || "(none given)"}`,
        );
      }
      options.only = names;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

module.exports = { fetchGutendexCatalog, parseGutendexArgs };

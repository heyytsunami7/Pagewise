// Downloads a raw book list per category from Open Library into data/raw/openlibrary.json.
// It only reads from Open Library and writes one local file. It never touches a database.
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { createHttpClient } = require("./lib/http");
const { createOpenLibraryClient } = require("./lib/openlibrary");
const { fetchOpenLibraryCatalog, parseFetchArgs } = require("./lib/fetchOpenLibrary");
const { OPENLIBRARY_QUERIES } = require("./lib/categories");

const OUTPUT = path.join(__dirname, "..", "data", "raw", "openlibrary.json");

const USAGE = `Usage: node scripts/fetch-openlibrary.js [options]

  --per-category N   books to keep per category (default 40)
  --describe N       fetch descriptions for the first N books per category (default 30)
  --only A,B         fetch only these categories (the others in the file are kept)
  --resume           continue a previous run, skipping categories already in the file

Set CATALOG_USER_AGENT to include your email in the User-Agent, as Open Library asks.
Takes several minutes: it waits one second between requests.`;

function save(result) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(USAGE);
    return;
  }

  const options = parseFetchArgs(process.argv.slice(2), Object.keys(OPENLIBRARY_QUERIES));

  // --resume and --only both build on the existing file instead of replacing it.
  let existing = null;
  if ((options.resume || options.only) && fs.existsSync(OUTPUT)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
    for (const category of options.only || []) delete existing.categories[category];
  }

  const client = createOpenLibraryClient(createHttpClient());
  const result = await fetchOpenLibraryCatalog({
    client,
    categories: options.only || undefined,
    perCategory: options.perCategory,
    describePerCategory: options.describe,
    existing,
    onCategoryDone: save,
    log: (message) => console.log(message),
  });
  save(result);

  console.log(`\nWritten to ${path.relative(process.cwd(), OUTPUT)}`);
  let total = 0;
  for (const [category, books] of Object.entries(result.categories)) {
    const described = books.filter((book) => book.description).length;
    total += books.length;
    console.log(
      `${category.padEnd(12)} ${String(books.length).padStart(3)} books (${described} with descriptions)`,
    );
  }
  console.log(`Total: ${total} books`);
}

main().catch((err) => {
  console.error(`Fetch failed: ${err.message}`);
  console.error("Progress so far is saved. Run again with --resume to continue.");
  process.exit(1);
});
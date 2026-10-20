// Downloads a raw list of free public-domain books per category from Gutendex into
// data/raw/gutendex.json. It only reads from Gutendex and writes one local file.
// It never touches a database.
const fs = require("node:fs");
const path = require("node:path");
const { createHttpClient } = require("./lib/http");
const { createGutendexClient } = require("./lib/gutendex");
const { fetchGutendexCatalog, parseGutendexArgs } = require("./lib/fetchGutendex");
const { GUTENDEX_TOPICS } = require("./lib/categories");

const OUTPUT = path.join(__dirname, "..", "data", "raw", "gutendex.json");

const USAGE = `Usage: node scripts/fetch-gutendex.js [options]

  --per-category N   books to keep per category (default 10)
  --only A,B         fetch only these categories (the others in the file are kept)
  --resume           continue a previous run, skipping categories already in the file

Set CATALOG_USER_AGENT to include your email in the User-Agent.
It waits one second between requests, so a full run takes a minute or two.`;

function save(result) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(USAGE);
    return;
  }

  const options = parseGutendexArgs(process.argv.slice(2), Object.keys(GUTENDEX_TOPICS));

  // --resume and --only both build on the existing file instead of replacing it.
  let existing = null;
  if ((options.resume || options.only) && fs.existsSync(OUTPUT)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
    for (const category of options.only || []) delete existing.categories[category];
  }

  const client = createGutendexClient(createHttpClient());
  const result = await fetchGutendexCatalog({
    client,
    categories: options.only || undefined,
    perCategory: options.perCategory,
    existing,
    onCategoryDone: save,
    log: (message) => console.log(message),
  });
  save(result);

  console.log(`\nWritten to ${path.relative(process.cwd(), OUTPUT)}`);
  let total = 0;
  for (const [category, books] of Object.entries(result.categories)) {
    const summarized = books.filter((book) => book.description).length;
    total += books.length;
    console.log(
      `${category.padEnd(12)} ${String(books.length).padStart(3)} books (${summarized} with summaries)`,
    );
  }
  console.log(`Total: ${total} books`);
}

main().catch((err) => {
  console.error(`Fetch failed: ${err.message}`);
  console.error("Progress so far is saved. Run again with --resume to continue.");
  process.exit(1);
});

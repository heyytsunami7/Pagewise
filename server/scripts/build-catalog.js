// Builds data/catalog.json from the two raw files in data/raw. It reads and writes local
// files only. It never touches a database or the network.
const fs = require("node:fs");
const path = require("node:path");
const { catalogBookSchema } = require("../src/schemas/book");
const { buildCatalog, parseBuildArgs } = require("./lib/buildCatalog");

const RAW_DIR = path.join(__dirname, "..", "data", "raw");
const OUTPUT = path.join(__dirname, "..", "data", "catalog.json");

const USAGE = `Usage: node scripts/build-catalog.js [options]

  --per-category N       books to keep per category (default 25)
  --min-per-category N   fail if a category ends up with fewer than N books (default 15)
  --free-per-category N  slots per category reserved for free-to-read books (default 3)

Needs data/raw/openlibrary.json. Uses data/raw/gutendex.json too when it exists.`;

function readRaw(name, { required }) {
  const file = path.join(RAW_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    if (required) {
      throw new Error(`Missing ${path.relative(process.cwd(), file)}. Run the fetch first.`);
    }
    console.warn(
      `Note: ${path.relative(process.cwd(), file)} not found, so there will be no free-to-read books.`,
    );
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  if (process.argv.includes("--help")) {
    console.log(USAGE);
    return;
  }

  const options = parseBuildArgs(process.argv.slice(2));
  const { catalog, report } = buildCatalog({
    openlibrary: readRaw("openlibrary", { required: true }),
    gutendex: readRaw("gutendex", { required: false }),
    schema: catalogBookSchema,
    ...options,
  });

  fs.writeFileSync(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`);

  console.log(`Written to ${path.relative(process.cwd(), OUTPUT)}\n`);
  for (const [category, count] of Object.entries(report.perCategory)) {
    console.log(`${category.padEnd(12)} ${String(count).padStart(3)} books`);
  }
  console.log(`\nTotal: ${report.total} books`);
  console.log(
    `Free to read: ${report.freeToRead} | real descriptions: ${report.withRealDescription}`,
  );
  console.log(`Featured: ${report.featured} | out of stock: ${report.outOfStock}`);
  console.log(
    `Merged ${report.merge.duplicatesMerged} duplicates, dropped ${report.merge.droppedNoCategory} with no category.`,
  );
  if (report.skippedInvalid > 0) {
    console.log(`Skipped ${report.skippedInvalid} book(s) that fail the schema, for example:`);
    for (const { title, issues } of report.skippedExamples) {
      console.log(`  - ${title.slice(0, 60)}: ${issues.join("; ")}`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`Build failed: ${err.message}`);
  process.exit(1);
}

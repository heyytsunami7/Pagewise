// Loads data/catalog.json into the books collection. This is the first script that WRITES to
// a database, so it refuses any database whose name does not end in _dev or _test.
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { parseConfig } = require("../src/config");
const { createDbGetter, ensureIndexes } = require("../src/db");
const { catalogBookSchema } = require("../src/schemas/book");
const {
  seedBooks,
  assertSafeDatabase,
  assertCanReset,
  prepareEntries,
  resetBooks,
  countByCategory,
  parseSeedArgs,
} = require("./lib/seed");

const CATALOG = path.join(__dirname, "..", "data", "catalog.json");

const USAGE = `Usage: node scripts/seed.js [options]

  --reset      drop the books collection first (only on _dev or _test databases)
  --db NAME    seed this database instead of DB_NAME from .env

Safe to run again: existing books keep their price, stock, featured and active values.
A database whose name does not end in _dev or _test is refused unless you set
ALLOW_PROD_SEED=yes-i-am-sure and pass --db NAME.`;

async function main() {
  if (process.argv.includes("--help")) {
    console.log(USAGE);
    return;
  }

  const options = parseSeedArgs(process.argv.slice(2));
  const config = parseConfig(process.env);
  const dbName = options.db ?? config.DB_NAME;

  // Both checks run before anything connects, so a wrong target never even opens a connection.
  assertSafeDatabase({
    dbName,
    explicitDb: options.db,
    allowProd: process.env.ALLOW_PROD_SEED === "yes-i-am-sure",
  });
  if (options.reset) assertCanReset(dbName);

  if (!fs.existsSync(CATALOG)) {
    throw new Error("data/catalog.json not found. Run npm run catalog:build first.");
  }
  const entries = prepareEntries(JSON.parse(fs.readFileSync(CATALOG, "utf8")), catalogBookSchema);

  console.log(`Seeding "${dbName}" with ${entries.length} books...`);
  const db = await createDbGetter({ uri: config.MONGODB_URI, dbName })();

  if (options.reset) {
    const dropped = await resetBooks(db);
    await ensureIndexes(db);
    console.log(
      dropped ? "Dropped the existing books collection." : "There was no books collection.",
    );
  }

  const result = await seedBooks(db, entries);
  console.log(
    `Inserted ${result.inserted}, updated ${result.updated}, unchanged ${result.unchanged}.`,
  );

  const counts = await countByCategory(db);
  console.log("\nBooks in the database now:");
  let total = 0;
  for (const [category, count] of Object.entries(counts)) {
    total += count;
    console.log(`${category.padEnd(12)} ${String(count).padStart(3)}`);
  }
  console.log(`Total        ${String(total).padStart(3)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exit(1);
  });

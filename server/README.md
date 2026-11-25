# Mern-Book-Store API

Express API for the Mern-Book-Store project. MongoDB (native driver), Firebase Auth,
Zod validation.

## Scripts

| Command                             | What it does                                                             |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                       | Start the API with nodemon (needs `.env`)                                |
| `npm start`                         | Start the API with node                                                  |
| `npm test`                          | Run the Vitest suite (uses an in-memory MongoDB)                         |
| `npm run test:watch`                | Vitest in watch mode                                                     |
| `npm run lint`                      | ESLint                                                                   |
| `npm run format`                    | Prettier                                                                 |
| `npm run catalog:fetch:openlibrary` | Download the raw Open Library book list into `data/raw/`                 |
| `npm run catalog:fetch:gutendex`    | Download free public-domain books from Gutendex into `data/raw/`         |
| `npm run catalog:fetch`             | Both fetches, one after the other                                        |
| `npm run catalog:build`             | Build `data/catalog.json` from the raw files                             |
| `npm run seed`                      | Load `data/catalog.json` into the database (dev and test databases only) |

## Environment

Copy `.env.example` to `.env` and fill it in. Use a dev database name (ending in
`_dev`) locally.

| Variable                                 | Notes                                                           |
| ---------------------------------------- | --------------------------------------------------------------- |
| `MONGODB_URI`, `DB_NAME`                 | Required                                                        |
| `PORT`, `NODE_ENV`                       | Default to 3001 and development                                 |
| `CORS_ORIGINS`                           | Comma-separated allowed origins                                 |
| `FIREBASE_SERVICE_ACCOUNT_KEY`           | Service account JSON on one line                                |
| `ADMIN_EMAILS`                           | Comma-separated. Empty means nobody is admin                    |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Test-mode keys, used from Phase 7                               |
| `CATALOG_USER_AGENT`                     | Optional. Sent by the catalog fetch scripts; include your email |
| `ALLOW_PROD_SEED`                        | Only set in the terminal, never in `.env`. See "Seed" below     |

## Catalog data

The shop's books come from two free sources. They are downloaded once, turned into one
catalog file, and loaded into MongoDB. The live API never calls these sources.

```text
Open Library ──┐
               ├── fetch ──> data/raw/*.json ──> build ──> data/catalog.json ──> seed ──> MongoDB
Gutendex ──────┘
```

### 1. Fetch (rarely)

```bash
npm run catalog:fetch
```

- Downloads about 40 books per category from Open Library and about 10 free
  public-domain books per category from Gutendex. Takes several minutes, because it
  waits between requests to be polite to both services.
- Saves after every category. If a run stops, continue it with
  `npm run catalog:fetch:gutendex -- --resume` (or the Open Library equivalent).
- `--only Mystery,Horror` re-fetches just those categories and keeps the rest.
- Never touches a database.

### 2. Build

```bash
npm run catalog:build
```

- Merges the two raw files, removes duplicates (a Gutenberg copy adds a free read link to
  the Open Library book), assigns each book one of the ten categories, and keeps the best
  25 books per category. Three slots per category are kept for free-to-read books.
- Skips books that would fail validation (for example over-long titles) and lists them.
- Fails, without writing anything, if a category ends up with fewer than 15 books.
- Validates every entry with the same Zod schema the API uses, then writes
  `data/catalog.json`. The same raw files always produce the same file.
- Options: `--per-category`, `--min-per-category`, `--free-per-category`.

### 3. Seed

```bash
npm run seed            # add or update books
npm run seed -- --reset # dev only: drop the books collection first
```

- Refuses any database whose name does not end in `_dev` or `_test`. Seeding another
  database needs both `ALLOW_PROD_SEED=yes-i-am-sure` in the terminal and an explicit
  `--db <name>`.
- Safe to run again: new books are inserted, changed descriptions are updated, and
  existing books keep their price, stock, featured and active values. A re-seed never
  undoes what happened in the shop.

### What is real and what is demo data

Titles, authors, descriptions, subjects, covers and read links come from the sources.
**Prices, stock and the featured flag are generated demo data.** They are deterministic,
so every build gives the same values, but they do not reflect any real store.

### Attribution

Book data and covers come from [Open Library](https://openlibrary.org). Free public-domain
books and their read links come from [Project Gutenberg](https://www.gutenberg.org), via
the [Gutendex](https://gutendex.com) API.

## Structure

- `src/app.js`: `createApp()`, builds the app from injected dependencies (no port, no DB)
- `src/bootstrap.js`: wires the real config, database and Firebase
- `server.js`: local entry. `index.js`: Vercel entry
- `src/middleware/`: auth, validate, rate limits, error handling
- `src/routes/`: route modules. `src/services/`: business logic and integrations
- `src/schemas/`: Zod schemas shared by the API and the catalog scripts
- `scripts/`: catalog fetch, build and seed. `scripts/lib/`: their testable logic
- `data/`: raw downloads (`data/raw/`) and the built `catalog.json`
- `tests/`: Vitest + Supertest

## Errors

Every error uses one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [{ "path": "category", "message": "Invalid option" }]
  }
}
```

## Admin rule

A user is an admin only if their email is verified and listed in `ADMIN_EMAILS`.
If the list is empty, nobody is an admin.

## API

Base URL locally: `http://localhost:3001`. Send the Firebase ID token as
`Authorization: Bearer <token>` on routes marked **login** or **admin**. Errors use the
shape in "Errors" below. Every route is rate limited (300 requests per 15 minutes per IP).

### Public

| Method | Path                 | Response                                                                     |
| ------ | -------------------- | ---------------------------------------------------------------------------- |
| GET    | `/`                  | `{ "name": "mern-book-store-api", "ok": true }`                              |
| GET    | `/health`            | `{ "ok": true, "db": true }`, or 503 `{ "ok": false, "db": false }`          |
| GET    | `/books`             | `{ books, total, page, limit, totalPages }`                                  |
| GET    | `/books/suggest?q=`  | `{ suggestions: [{ _id, title, coverUrl }] }` (up to 8, needs 2+ characters) |
| GET    | `/books/:id`         | `{ book }`, or 404 if missing or archived                                    |
| GET    | `/books/:id/related` | `{ books }` (same author first, then same category, up to 6)                 |

`GET /books` query parameters (unknown keys are rejected with 400):

| Parameter              | Values                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `page`, `limit`        | `page` 1 to 1000 (default 1), `limit` 1 to 48 (default 12)            |
| `q`                    | Search text, up to 100 characters                                     |
| `category`             | One of the ten categories                                             |
| `minPrice`, `maxPrice` | Whole rupees, 0 to 10000                                              |
| `inStock`, `free`      | `1`/`true` or `0`/`false` (`free` means it has a read link)           |
| `sort`                 | `relevance` (needs `q`), `newest`, `price_asc`, `price_desc`, `title` |

A list item has `_id`, `title`, `authors`, `category`, `coverUrl`, `pricePaise`, `stock`,
`isFeatured` and `readUrl`. The detail `book` adds `description`, `subjects`,
`externalUrl`, `isbn`, `pageCount` and `publishedYear`. Prices are in paise.

### Login

| Method | Path  | Response                                                        |
| ------ | ----- | --------------------------------------------------------------- |
| GET    | `/me` | `{ uid, email, name, isAdmin }`. Creates the user on first call |

### Admin

Needs a verified email listed in `ADMIN_EMAILS`. No token gives 401, a non-admin gives 403.

| Method | Path                       | Response                                                            |
| ------ | -------------------------- | ------------------------------------------------------------------- |
| GET    | `/admin/books`             | `{ books, total, page, limit, totalPages }`                         |
| GET    | `/admin/books/:id`         | `{ book }` (the whole document, archived or not)                    |
| POST   | `/admin/books`             | 201 `{ book }`. 409 if the ISBN is taken                            |
| PATCH  | `/admin/books/:id`         | `{ book }`. Send only the fields to change. 404 if missing          |
| DELETE | `/admin/books/:id`         | `{ archived, deleted }`. Ordered books are archived, others deleted |
| POST   | `/admin/books/:id/restore` | `{ book }` (an archived book is active again)                       |

`GET /admin/books` takes the same `page`, `limit`, `q` and `category` as the public list,
plus `status` (`active` (default), `archived`, `all`) and `sort` (`newest`, `title`,
`price_asc`, `price_desc`, `stock_asc`). `q` also matches an exact ISBN.

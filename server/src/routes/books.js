const express = require("express");
const { AppError } = require("../errors");
const { asyncHandler } = require("../middleware/asyncHandler");
const { validate } = require("../middleware/validate");
const {
  bookListQuerySchema,
  bookSuggestQuerySchema,
  bookIdParamsSchema,
} = require("../schemas/bookQuery");
const { listBooks, getBookById, relatedBooks, suggestTitles } = require("../services/books");

/**
 * Public book routes. No login needed: guests can browse everything.
 *   GET /books               one page of books (search, filters, sort, paging)
 *   GET /books/suggest       title suggestions while typing
 *   GET /books/:id           one book
 *   GET /books/:id/related   books like this one
 * /books/suggest is registered before /books/:id, so "suggest" is never read as an id.
 */
module.exports = function booksRouter({ getDb }) {
  const router = express.Router();

  router.get(
    "/books",
    validate({ query: bookListQuerySchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      res.json(await listBooks(db, req.query));
    }),
  );

  router.get(
    "/books/suggest",
    validate({ query: bookSuggestQuerySchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      res.json({ suggestions: await suggestTitles(db, req.query.q) });
    }),
  );

  router.get(
    "/books/:id",
    validate({ params: bookIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      const book = await getBookById(db, req.params.id);
      if (!book) throw AppError.notFound("Book not found");
      res.json({ book });
    }),
  );

  router.get(
    "/books/:id/related",
    validate({ params: bookIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      const book = await getBookById(db, req.params.id);
      if (!book) throw AppError.notFound("Book not found");
      res.json({ books: await relatedBooks(db, book) });
    }),
  );

  return router;
};

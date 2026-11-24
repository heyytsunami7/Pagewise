const express = require("express");
const { AppError } = require("../errors");
const { asyncHandler } = require("../middleware/asyncHandler");
const { validate } = require("../middleware/validate");
const { bookIdParamsSchema } = require("../schemas/bookQuery");
const { adminBookListQuerySchema } = require("../schemas/adminBookQuery");
const { bookCreateSchema, bookUpdateSchema } = require("../schemas/book");
const {
  listAdminBooks,
  getAdminBook,
  createBook,
  updateBook,
  deleteOrArchiveBook,
  restoreBook,
} = require("../services/adminBooks");

/**
 * Admin book routes. Every route needs a login and an admin email.
 *   GET    /admin/books              one page of books, archived ones included on request
 *   GET    /admin/books/:id          the whole book, for the edit form
 *   POST   /admin/books              create a book
 *   PATCH  /admin/books/:id          change some fields
 *   DELETE /admin/books/:id          delete, or archive if the book was ever ordered
 *   POST   /admin/books/:id/restore  bring an archived book back
 */
module.exports = function adminBooksRouter({ getDb, auth }) {
  const router = express.Router();

  router.use("/admin", auth.verifyToken, auth.requireAdmin);

  router.get(
    "/admin/books",
    validate({ query: adminBookListQuerySchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      res.json(await listAdminBooks(db, req.query));
    }),
  );

  router.get(
    "/admin/books/:id",
    validate({ params: bookIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      const book = await getAdminBook(db, req.params.id);
      if (!book) throw AppError.notFound("Book not found");
      res.json({ book });
    }),
  );

  router.post(
    "/admin/books",
    validate({ body: bookCreateSchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      res.status(201).json({ book: await createBook(db, req.body) });
    }),
  );

  router.patch(
    "/admin/books/:id",
    validate({ params: bookIdParamsSchema, body: bookUpdateSchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      res.json({ book: await updateBook(db, req.params.id, req.body) });
    }),
  );

  router.delete(
    "/admin/books/:id",
    validate({ params: bookIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      res.json(await deleteOrArchiveBook(db, req.params.id));
    }),
  );

  router.post(
    "/admin/books/:id/restore",
    validate({ params: bookIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const db = await getDb();
      res.json({ book: await restoreBook(db, req.params.id) });
    }),
  );

  return router;
};

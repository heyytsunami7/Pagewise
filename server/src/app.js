const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const pino = require("pino");
const pinoHttp = require("pino-http");

const { createAuth } = require("./middleware/auth");
const { createLimiters } = require("./middleware/rateLimit");
const { notFoundHandler, errorHandler } = require("./middleware/error");
const healthRouter = require("./routes/health");
const meRouter = require("./routes/me");
const booksRouter = require("./routes/books");

/**
 * Builds the Express app from injected dependencies. It never connects to a database
 * or opens a port, so tests can import it freely.
 */
function createApp({ config, getDb, verifyIdToken, logger }) {
  const app = express();

  app.set("config", config);
  // "simple" parser: ?category[$ne]=x stays a plain string key instead of becoming an object.
  app.set("query parser", "simple");
  // Vercel sits behind one proxy; needed for correct client IPs in rate limiting.
  if (config.NODE_ENV === "production") app.set("trust proxy", 1);

  const log = logger || pino({ level: config.NODE_ENV === "test" ? "silent" : "info" });
  const limiters = createLimiters(config);
  const auth = createAuth({ verifyIdToken, adminEmails: config.ADMIN_EMAILS });

  app.use(pinoHttp({ logger: log }));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "100kb" }));
  app.use(limiters.global);

  app.get("/", (req, res) => res.json({ name: "mern-book-store-api", ok: true }));
  app.use(healthRouter({ getDb }));
  app.use(meRouter({ getDb, auth }));
  app.use(booksRouter({ getDb }));
  // Later commits mount more routers here.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

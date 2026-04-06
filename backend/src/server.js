// server.js

// 1) Load .env as early as possible
require("dotenv").config();
if (!process.env.SESSION_SECRET) {
  console.error("🔥 SESSION_SECRET missing");
  process.exit(1);
}

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const cors = require("cors");
const { createClient } = require("redis");
const { RedisStore } = require("connect-redis");

(async () => {
  // 2) Determine whether to use Redis (only in production with REDIS_URL)
  let sessionStore;
  if (process.env.REDIS_URL && process.env.NODE_ENV === "production") {
    const redisClient = createClient({ url: process.env.REDIS_URL });
    try {
      await redisClient.connect();
      console.log("✅ Redis connected");
      sessionStore = new RedisStore({ client: redisClient });
    } catch (err) {
      console.warn(
        "⚠️ Redis connection failed; falling back to in-memory session store",
        err,
      );
    }
  } else {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "⚠️ REDIS_URL not set; falling back to in-memory session store",
      );
    } else {
      console.log("🔧 Development mode; using in-memory session store");
    }
  }

  // 3) Create Express app
  const app = express();
  app.set("trust proxy", 1);

  // 4) Security & parsing middleware
  app.use(helmet());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 5) Static file serving
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
  app.use("/assets", express.static(path.join(__dirname, "../client/assets")));

  // 6) CORS (allow credentials + your origin)
  app.use(
    cors({
      origin: "https://example-candidate.com",
      credentials: true,
    }),
  );

  // 7) Session middleware
  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: "auto", // ← only add Secure flag when req.secure===true
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24, // 1 day
      },
    }),
  );

  // 8) (Optional) A quick debug endpoint
  app.get("/api/test-session", (req, res) => {
    if (!req.session.count) req.session.count = 0;
    req.session.count++;
    res.json({ visits: req.session.count });
  });

  // 9) Rate-limiters & route mounting
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,

    message: { error: "Too many attempts, please try again later" },
  });
  const recoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many recovery attempts, please try again later" },
  });

  const authRoutes = require("./routes/auth");
  const volunteerRoutes = require("./routes/volunteers");
  const contactRoutes = require("./routes/contactMessages");
  const eventRoutes = require("./routes/events");
  const coalitionRoutes = require("./routes/coalitionCandidates");
  const coalitionSignupRoutes = require("./routes/coalitionSignups");
  const signupRoutes = require("./routes/eventSignups");
  const mailingListRoutes = require("./routes/mailingList");
  const adminRoutes = require("./routes/admin");
  const newsRoutes = require("./routes/news");
  const postShareRoutes = require("./routes/postShares");
  const socialOAuthRoutes = require("./routes/socialOAuth");
  const recoveryRoutes = require("./routes/accountRecovery");

  app.use(postShareRoutes);
  app.use(socialOAuthRoutes);
  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/volunteers", volunteerRoutes);
  app.use("/api/contact", contactRoutes);
  app.use("/api/events", eventRoutes);
  app.use("/api/coalition", coalitionRoutes);
  app.use("/api/coalition-signups", coalitionSignupRoutes);
  app.use("/api/event-signups", signupRoutes);
  app.use("/api/mailing-list", mailingListRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/news", newsRoutes);
  app.use("/api/account-recovery", recoveryLimiter, recoveryRoutes);

  // 10) Database sync & start
  let sequelize = require("./config/database");
  const { Sequelize } = require("sequelize");
  try {
    await sequelize.authenticate();
    console.log(`${sequelize.getDialect()} connected`);
  } catch (err) {
    console.error("Postgres connection error", err);
    if (process.env.DB_DIALECT && process.env.DB_DIALECT !== "sqlite") {
      console.warn("Falling back to in-memory SQLite");
      sequelize = new Sequelize("sqlite::memory:", { logging: false });
    }
  }

  require("./models/user");
  require("./models/volunteer");
  require("./models/contactMessage");
  require("./models/event");
  require("./models/eventSignup");
  require("./models/mailingListSignup");
  require("./models/newsArticle");
  require("./models/coalitionCandidate");
  require("./models/coalitionSignup");

  sequelize
    .sync({ alter: true })
    .then(() => console.log("All tables synced"))
    .catch((err) => console.error("Sync error", err));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
})();

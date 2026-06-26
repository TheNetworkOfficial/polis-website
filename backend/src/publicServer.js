require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");

const postShareRoutes = require("./routes/postShares");
const socialOAuthRoutes = require("./routes/socialOAuth");

function resolveFrontendDistPath() {
  const configured = process.env.FRONTEND_DIST_PATH;
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(__dirname, "../../frontend/dist");
}

function fileIfExists(baseDir, relativePath) {
  const filePath = path.join(baseDir, relativePath);
  return fs.existsSync(filePath) ? filePath : "";
}

const app = express();
const frontendDistPath = resolveFrontendDistPath();
const defaultIndexPath = fileIfExists(frontendDistPath, "index.html");
const default404Path = fileIfExists(frontendDistPath, "404.html");

const frontendRouteRewrites = [
  [/^\/auth\/signup\/email(?:\/.*)?$/u, "auth/signup/email/index.html"],
  [/^\/auth\/signup\/password(?:\/.*)?$/u, "auth/signup/password/index.html"],
  [/^\/auth\/confirm-code(?:\/.*)?$/u, "auth/confirm-code/index.html"],
  [/^\/auth\/forgot-password\/confirm(?:\/.*)?$/u, "auth/forgot-password/confirm/index.html"],
  [/^\/auth\/forgot-password(?:\/.*)?$/u, "auth/forgot-password/index.html"],
  [/^\/auth(?:\/.*)?$/u, "auth/index.html"],
  [/^\/social-return(?:\/.*)?$/u, "social-return/index.html"],
  [/^\/oauth\/complete(?:\/.*)?$/u, "oauth/complete/index.html"],
  [/^\/calendar-return(?:\/.*)?$/u, "calendar-return/index.html"],
  [/^\/settings\/voter-intelligence(?:\/.*)?$/u, "settings/voter-intelligence/index.html"],
  [/^\/messages(?:\/.*)?$/u, "messages/index.html"],
  [/^\/candidate-dashboard(?:\/.*)?$/u, "candidate-dashboard/index.html"],
  [/^\/coalitions(?:\/.*)?$/u, "coalitions/index.html"],
  [/^\/cta-invite(?:\/.*)?$/u, "cta-invite/index.html"],
  [/^\/petitions(?:\/.*)?$/u, "petitions/index.html"],
  [/^\/election-day(?:\/.*)?$/u, "election-day/index.html"],
  [/^\/feed(?:\/.*)?$/u, "feed/index.html"],
  [/^\/posts(?:\/.*)?$/u, "posts/index.html"],
  [/^\/create(?:\/.*)?$/u, "create/index.html"],
  [/^\/create-tab$/u, "create/index.html"],
  [/^\/discover(?:\/.*)?$/u, "discover/index.html"],
  [/^\/achievements(?:\/.*)?$/u, "achievements/index.html"],
  [/^\/search(?:\/.*)?$/u, "search/index.html"],
  [/^\/candidates(?:\/.*)?$/u, "candidates/index.html"],
  [/^\/officials(?:\/.*)?$/u, "officials/index.html"],
  [/^\/auto-candidates(?:\/.*)?$/u, "auto-candidates/index.html"],
  [/^\/candidate\/voter-map(?:\/.*)?$/u, "candidate/voter-map/index.html"],
  [/^\/missions(?:\/.*)?$/u, "missions/index.html"],
  [/^\/events(?:\/.*)?$/u, "events/index.html"],
  [/^\/manage-events(?:\/.*)?$/u, "manage-events/index.html"],
  [/^\/profile(?:\/.*)?$/u, "profile/index.html"],
  [/^\/profile-tab$/u, "profile/index.html"],
  [/^\/settings(?:\/.*)?$/u, "settings/index.html"],
  [/^\/onboarding(?:\/.*)?$/u, "onboarding/index.html"],
  [/^\/topics(?:\/.*)?$/u, "topics/index.html"],
  [/^\/questions(?:\/.*)?$/u, "questions/index.html"],
  [/^\/account-deletion-requested(?:\/.*)?$/u, "account-deletion-requested/index.html"],
  [/^\/admin(?:\/.*)?$/u, "admin/index.html"],
];

function sendFrontendRoute(req, res, next) {
  const rewrite = frontendRouteRewrites.find(([pattern]) =>
    pattern.test(req.path || ""),
  );
  if (!rewrite) {
    next();
    return;
  }
  const filePath = fileIfExists(frontendDistPath, rewrite[1]);
  if (filePath) {
    res.sendFile(filePath);
    return;
  }
  next();
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(postShareRoutes);
app.use(socialOAuthRoutes);

if (fs.existsSync(frontendDistPath)) {
  app.use(
    express.static(frontendDistPath, {
      extensions: ["html"],
      index: "index.html",
      maxAge: "1h",
    }),
  );
}

app.get(frontendRouteRewrites.map(([pattern]) => pattern), sendFrontendRoute);

app.get("/", (_req, res) => {
  if (defaultIndexPath) {
    res.sendFile(defaultIndexPath);
    return;
  }
  res.status(503).json({
    ok: false,
    error: "frontend_not_built",
    details: {
      frontendDistPath,
    },
  });
});

app.use((req, res) => {
  if (default404Path) {
    res.status(404).sendFile(default404Path);
    return;
  }
  res.status(404).json({
    ok: false,
    error: "not_found",
    path: req.path,
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Public website server listening on port ${port}`);
  console.log(`Serving frontend from ${frontendDistPath}`);
});

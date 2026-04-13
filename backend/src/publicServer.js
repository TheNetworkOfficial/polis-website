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

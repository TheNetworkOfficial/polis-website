const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.env.POLIS_WEB_TEST_DIST);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, "index.html");
    if (!fs.existsSync(file) && !path.extname(pathname))
      file = path.join(root, "settings/candidate-access/index.html");
    if (!fs.existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(response);
  })
  .listen(Number(process.env.POLIS_WEB_TEST_PORT), "127.0.0.1");

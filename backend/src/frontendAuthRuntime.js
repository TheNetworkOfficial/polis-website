const fs = require("fs");

const runtimeAssignment =
  /(window\.__POLIS_WEB_APP__\s*=\s*)(\{[\s\S]*?\})(\s*;\s*window\.__POLIS_SHARED_FEED__\s*=\s*window\.__POLIS_WEB_APP__)/u;

function normalizeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function publicAuthConfig(req, env = process.env) {
  return {
    region: normalizeString(env.COGNITO_REGION),
    clientId: normalizeString(env.COGNITO_APP_CLIENT_ID),
    domain: normalizeString(env.COGNITO_DOMAIN),
    scopes: normalizeString(env.COGNITO_SCOPES),
    enablePasswordFlow: normalizeString(env.COGNITO_ENABLE_PASSWORD_FLOW),
    redirectUri:
      normalizeString(env.COGNITO_REDIRECT_URI) ||
      `${req.protocol}://${req.get("host")}${req.originalUrl}`,
  };
}

function serializeRuntime(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Supply server authentication settings to a static browser-app fallback. */
function hydrateFrontendAuthRuntime(html, req, env = process.env) {
  return html.replace(runtimeAssignment, (_match, prefix, json, suffix) => {
    const runtime = JSON.parse(json);
    runtime.auth = publicAuthConfig(req, env);
    return `${prefix}${serializeRuntime(runtime)}${suffix}`;
  });
}

function sendFrontendFile(req, res, next, filePath) {
  fs.readFile(filePath, "utf8", (error, html) => {
    if (error) {
      next(error);
      return;
    }
    if (!runtimeAssignment.test(html)) {
      res.sendFile(filePath);
      return;
    }
    try {
      const hydrated = hydrateFrontendAuthRuntime(html, req);
      res.set("Cache-Control", "no-store").type("html").send(hydrated);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { hydrateFrontendAuthRuntime, sendFrontendFile };

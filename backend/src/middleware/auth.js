function ensureAuth(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: "Unauthorized" });
}

function ensureAdmin(req, res, next) {
  if (req.session.userId && req.session.isAdmin) return next();
  res.status(403).json({ error: "Forbidden" });
}

module.exports = { ensureAuth, ensureAdmin };

const express = require("express");
const router = express.Router();
const NewsArticle = require("../models/newsArticle");
const { ensureAdmin } = require("../middleware/auth");

async function fetchThumbnail(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const og =
      html.match(
        /<meta[^>]*property=['"]og:image['"][^>]*content=['"]([^'"]+)['"]/i,
      ) ||
      html.match(
        /<meta[^>]*name=['"]twitter:image['"][^>]*content=['"]([^'"]+)['"]/i,
      );
    return og ? og[1] : null;
  } catch (err) {
    console.error("Thumbnail fetch error:", err);
    return null;
  }
}

router.get("/", async (_req, res) => {
  try {
    const articles = await NewsArticle.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.json(articles);
  } catch (err) {
    console.error("Fetch news error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", ensureAdmin, async (req, res) => {
  try {
    const { title, url, summary } = req.body;
    if (!title || !url) {
      return res.status(400).json({ error: "Title and URL required" });
    }
    const thumbnailImage = await fetchThumbnail(url);
    const article = await NewsArticle.create({
      title,
      url,
      summary,
      thumbnailImage,
    });
    res.status(201).json(article);
  } catch (err) {
    console.error("Create news error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", ensureAdmin, async (req, res) => {
  try {
    const article = await NewsArticle.findByPk(req.params.id);
    if (!article) return res.status(404).json({ error: "Article not found" });
    await article.destroy();
    res.json({ message: "News article deleted" });
  } catch (err) {
    console.error("Delete news error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

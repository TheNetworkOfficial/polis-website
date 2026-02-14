const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const CoalitionCandidate = require("../models/coalitionCandidate");
const { ensureAdmin } = require("../middleware/auth");

const router = express.Router();

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, "../uploads/"));
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

function imageFilter(_req, file, cb) {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files are allowed"), false);
}

const upload = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const STATUS_VALUES = ["pending", "accepted", "rejected"];

function normalizeStatus(rawStatus, fallback = "accepted") {
  if (typeof rawStatus !== "string") return fallback;
  const next = rawStatus.toLowerCase();
  return STATUS_VALUES.includes(next) ? next : fallback;
}

function parseJsonArray(rawValue) {
  if (!rawValue && rawValue !== "") return [];
  if (Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue === "string") {
    if (!rawValue.trim()) return [];
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to comma separated parsing
    }
    return rawValue
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function parseSocialLinks(rawValue) {
  if (!rawValue && rawValue !== "") return [];
  if (Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue === "string") {
    if (!rawValue.trim()) return [];
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            label: item.label ? String(item.label) : "",
            url: item.url ? String(item.url) : "",
          }))
          .filter((item) => item.label && item.url);
      }
    } catch {
      // fall through to newline separated parsing: "Label|url"
    }

    return rawValue
      .split("\n")
      .map((line) => line.trim())
      .map((line) => {
        const [label, url] = line.split("|");
        return { label: label ? label.trim() : "", url: url ? url.trim() : "" };
      })
      .filter((item) => item.label && item.url);
  }
  return [];
}

function deleteExistingImage(imagePath) {
  if (!imagePath) return;
  const uploadsDir = path.join(__dirname, "../uploads");
  const fileName = path.basename(imagePath);
  const absolutePath = path.join(uploadsDir, fileName);
  fs.promises.unlink(absolutePath).catch(() => {
    // ignore errors removing stale files
  });
}

router.get("/", async (req, res) => {
  try {
    const includeAll =
      Boolean(req.session?.isAdmin) && req.query.includeAll === "true";

    let where = {};
    if (!includeAll) {
      where = { status: "accepted" };
    } else {
      const requestedStatus = req.query.status;
      if (requestedStatus && requestedStatus !== "all") {
        const normalized = normalizeStatus(requestedStatus, null);
        if (normalized) {
          where.status = normalized;
        }
      }
    }

    const candidates = await CoalitionCandidate.findAll({
      where,
      order: [
        ["jurisdictionLevel", "ASC"],
        ["sortOrder", "ASC"],
        ["name", "ASC"],
      ],
    });
    res.json(candidates);
  } catch (err) {
    console.error("Fetch coalition candidates error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/suggest", upload.single("headshot"), async (req, res) => {
  try {
    const {
      name,
      jurisdictionLevel,
      description,
      websiteUrl,
      office,
      region,
      sortOrder,
      submittedByName,
      submittedByEmail,
      submittedByPhone,
      submittedByZip,
    } = req.body;

    if (
      !name ||
      !jurisdictionLevel ||
      !description ||
      !submittedByName ||
      !submittedByEmail ||
      !submittedByPhone ||
      !submittedByZip
    ) {
      return res.status(400).json({
        error:
          "Candidate name, level, description, and submitter contact details are required",
      });
    }

    const tags = parseJsonArray(req.body.tags);
    const socialLinks = parseSocialLinks(req.body.socialLinks);

    const candidate = await CoalitionCandidate.create({
      name,
      jurisdictionLevel,
      description,
      websiteUrl,
      office,
      region,
      socialLinks,
      tags,
      sortOrder: sortOrder ? Number(sortOrder) : 0,
      headshotImage: req.file ? `/uploads/${req.file.filename}` : null,
      status: "pending",
      submittedByName: String(submittedByName).trim(),
      submittedByEmail: String(submittedByEmail).trim(),
      submittedByPhone: String(submittedByPhone).trim(),
      submittedByZip: String(submittedByZip).trim(),
    });

    res.status(201).json({
      message: "Candidate suggestion submitted",
      candidateId: candidate.id,
    });
  } catch (err) {
    console.error("Suggest coalition candidate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", ensureAdmin, upload.single("headshot"), async (req, res) => {
  try {
    const {
      name,
      jurisdictionLevel,
      description,
      websiteUrl,
      office,
      region,
      sortOrder,
      status,
      submittedByName,
      submittedByEmail,
      submittedByPhone,
      submittedByZip,
    } = req.body;

    if (!name || !jurisdictionLevel || !description) {
      return res
        .status(400)
        .json({ error: "Name, level, and description are required" });
    }

    const tags = parseJsonArray(req.body.tags);
    const socialLinks = parseSocialLinks(req.body.socialLinks);

    const candidate = await CoalitionCandidate.create({
      name,
      jurisdictionLevel,
      description,
      websiteUrl,
      office,
      region,
      socialLinks,
      tags,
      sortOrder: sortOrder ? Number(sortOrder) : 0,
      headshotImage: req.file ? `/uploads/${req.file.filename}` : null,
      status: normalizeStatus(status),
      submittedByName: submittedByName ? String(submittedByName) : null,
      submittedByEmail: submittedByEmail ? String(submittedByEmail) : null,
      submittedByPhone: submittedByPhone ? String(submittedByPhone) : null,
      submittedByZip: submittedByZip ? String(submittedByZip) : null,
    });

    res.status(201).json(candidate);
  } catch (err) {
    console.error("Create coalition candidate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", ensureAdmin, upload.single("headshot"), async (req, res) => {
  try {
    const candidate = await CoalitionCandidate.findByPk(req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    const fields = [
      "name",
      "jurisdictionLevel",
      "description",
      "websiteUrl",
      "office",
      "region",
      "submittedByName",
      "submittedByEmail",
      "submittedByPhone",
      "submittedByZip",
    ];
    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        const value = req.body[field];
        if (value === null || value === undefined) {
          candidate[field] = null;
        } else {
          const normalized = String(value).trim();
          candidate[field] = normalized || null;
        }
      }
    });

    if (req.body.sortOrder !== undefined) {
      candidate.sortOrder = Number(req.body.sortOrder) || 0;
    }

    if (req.body.status !== undefined) {
      candidate.status = normalizeStatus(
        req.body.status,
        candidate.status || "accepted",
      );
    }

    if (req.body.tags !== undefined) {
      candidate.tags = parseJsonArray(req.body.tags);
    }

    if (req.body.socialLinks !== undefined) {
      candidate.socialLinks = parseSocialLinks(req.body.socialLinks);
    }

    if (req.body.removeHeadshot === "true") {
      deleteExistingImage(candidate.headshotImage);
      candidate.headshotImage = null;
    }

    if (req.file) {
      deleteExistingImage(candidate.headshotImage);
      candidate.headshotImage = `/uploads/${req.file.filename}`;
    }

    await candidate.save();
    res.json(candidate);
  } catch (err) {
    console.error("Update coalition candidate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/:id/status", ensureAdmin, async (req, res) => {
  try {
    const candidate = await CoalitionCandidate.findByPk(req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    const nextStatus = normalizeStatus(
      req.body.status,
      candidate.status || "pending",
    );
    candidate.status = nextStatus;
    await candidate.save();
    res.json({ id: candidate.id, status: candidate.status });
  } catch (err) {
    console.error("Update coalition candidate status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", ensureAdmin, async (req, res) => {
  try {
    const candidate = await CoalitionCandidate.findByPk(req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    deleteExistingImage(candidate.headshotImage);
    await candidate.destroy();
    res.json({ message: "Candidate deleted" });
  } catch (err) {
    console.error("Delete coalition candidate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

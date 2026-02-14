const express = require("express");
const router = express.Router();
const Event = require("../models/event");
const { ensureAdmin } = require("../middleware/auth");
const multer = require("multer");
const path = require("path");

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, "../uploads/"));
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
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

router.get("/", async (_req, res) => {
  try {
    const events = await Event.findAll({ order: [["eventDate", "ASC"]] });
    res.json(events);
  } catch (err) {
    console.error("Fetch events error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", ensureAdmin, upload.single("thumbnail"), async (req, res) => {
  try {
    const { title, description, eventDate, location } = req.body;
    if (!title || !eventDate) {
      return res.status(400).json({ error: "Title and date required" });
    }
    const event = await Event.create({
      title,
      description,
      eventDate,
      location,
      thumbnailImage: req.file ? `/uploads/${req.file.filename}` : null,
    });
    res.status(201).json(event);
  } catch (err) {
    console.error("Create event error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (err) {
    console.error("Fetch event error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put(
  "/:id",
  ensureAdmin,
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const event = await Event.findByPk(req.params.id);
      if (!event) return res.status(404).json({ error: "Event not found" });

      const { title, description, eventDate, location } = req.body;
      if (title !== undefined) event.title = title;
      if (description !== undefined) event.description = description;
      if (eventDate !== undefined) event.eventDate = eventDate;
      if (location !== undefined) event.location = location;
      if (req.file) event.thumbnailImage = `/uploads/${req.file.filename}`;

      await event.save();
      res.json(event);
    } catch (err) {
      console.error("Update event error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

router.delete("/:id", ensureAdmin, async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    await event.destroy();
    res.json({ message: "Event deleted" });
  } catch (err) {
    console.error("Delete event error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

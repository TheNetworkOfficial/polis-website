const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();
const User = require("../models/user");
const multer = require("multer");
const path = require("path");
const { ensureAuth } = require("../middleware/auth");

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads/"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  },
});

function avatarFilter(req, file, cb) {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"), false);
  }
}

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// — GET current user — GET /api/auth/profile
router.get("/profile", ensureAuth, async (req, res) => {
  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: { exclude: ["password_hash"] },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/profile", ensureAuth, async (req, res) => {
  try {
    const user = await User.findByPk(req.session.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const fields = ["username", "email", "firstName", "lastName", "phone"];
    const updates = {};
    fields.forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    await user.update(updates);
    const plain = user.get({ plain: true });
    delete plain.password_hash;
    res.json(plain);
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post(
  "/profile/avatar",
  ensureAuth,
  avatarUpload.single("avatar"),
  async (req, res) => {
    try {
      const user = await User.findByPk(req.session.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      user.avatarUrl = `/uploads/${req.file.filename}`;
      await user.save();
      res.json({ avatarUrl: user.avatarUrl });
    } catch (err) {
      console.error("Avatar upload error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// — REGISTER — POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, phone } = req.body;
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "Username, email and password required" });
    }
    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    const newUser = await User.create({
      username,
      email,
      password_hash,
      firstName,
      lastName,
      phone,
      isAdmin: false, // Default to false
    });
    // Auto-login
    req.session.userId = newUser.id;
    req.session.isAdmin = newUser.isAdmin;
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Register error:", err);
    res.status(400).json({ error: err.message });
  }
});

// — LOGIN — POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    // Success → set session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.isAdmin;
    res.json({ message: "Logged in successfully" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// — LOGOUT — POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ error: "Could not log out" });
    }
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully" });
  });
});

module.exports = router;

const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("../models/user");

const router = express.Router();

/** In-memory map of reset tokens: token -> { userId, expires } */
const resetTokens = new Map();

/**
 * Send an email using nodemailer. If SMTP env vars are not set,
 * the message will be logged to the console instead.
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 */
async function sendEmail(to, subject, text) {
  if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
    });
  } else {
    console.log(`EMAIL to ${to}: ${subject}\n${text}`);
  }
}

// Request password reset token
router.post("/password-reset/request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = await User.findOne({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const expires = Date.now() + 30 * 60 * 1000; // 30 minutes
      resetTokens.set(token, { userId: user.id, expires });
      await sendEmail(
        user.email,
        "Password Reset",
        `Use this token to reset your password: ${token}`,
      );
    }
    res.json({ message: "If the account exists, a reset token was sent" });
  } catch (err) {
    console.error("Password reset request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Confirm password reset
router.post("/password-reset/confirm", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ error: "Token and password required" });
    const data = resetTokens.get(token);
    if (!data || data.expires < Date.now())
      return res.status(400).json({ error: "Invalid or expired token" });
    const user = await User.findByPk(data.userId);
    if (!user) return res.status(400).json({ error: "Invalid token" });
    const password_hash = await bcrypt.hash(password, 12);
    await user.update({ password_hash });
    resetTokens.delete(token);
    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("Password reset confirm error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Send username to the user's email
router.post("/forgot-username", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = await User.findOne({ where: { email } });
    if (user) {
      await sendEmail(
        user.email,
        "Your username",
        `Your username is ${user.username}`,
      );
    }
    res.json({ message: "If the account exists, the username was sent" });
  } catch (err) {
    console.error("Forgot username error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

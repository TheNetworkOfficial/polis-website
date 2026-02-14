const express = require("express");
const router = express.Router();
const MailingListSignup = require("../models/mailingListSignup");

router.post("/", async (req, res) => {
  try {
    const { email, phone } = req.body;
    if (!email && !phone) {
      return res.status(400).json({ error: "Email or phone required" });
    }
    const entry = await MailingListSignup.create({ email, phone });
    res.status(201).json(entry);
  } catch (err) {
    console.error("Mailing list signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

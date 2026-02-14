const express = require("express");
const router = express.Router();
const Volunteer = require("../models/volunteer");

router.post("/", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, zip, discord } = req.body;
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: "Required fields missing" });
    }
    const entry = await Volunteer.create({
      firstName,
      lastName,
      email,
      phone,
      zip,
      discord,
    });
    res.status(201).json(entry);
  } catch (err) {
    console.error("Volunteer sign-up error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

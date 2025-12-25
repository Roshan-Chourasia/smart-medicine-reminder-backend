const express = require("express");
const router = express.Router();
const DoseTime = require("../models/DoseTime");

const allowedMeals = ["morning", "afternoon", "night"];

/**
 * Build a $set update for only the fields provided so we
 * don't wipe existing times when clients send partial payloads.
 */
function buildUpdate(body) {
  const set = {};

  if (typeof body.deviceId === "string" && body.deviceId.trim()) {
    set.deviceId = body.deviceId.trim();
  }

  for (const meal of allowedMeals) {
    if (body[meal] && typeof body[meal] === "object") {
      if ("before" in body[meal]) {
        set[`${meal}.before`] = body[meal].before ?? null;
      }
      if ("after" in body[meal]) {
        set[`${meal}.after`] = body[meal].after ?? null;
      }
    }
  }

  return set;
}

// Set / Update dose times (partial updates allowed)
router.post("/", async (req, res) => {
  try {
    const update = buildUpdate(req.body);

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided"
      });
    }

    const result = await DoseTime.findByIdAndUpdate(
      "main",
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get dose times
router.get("/", async (req, res) => {
  try {
    const data = await DoseTime.findById("main");

    if (!data) {
      // Return defaults if not yet set
      return res.json(new DoseTime());
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const DoseTime = require("../models/DoseTime");
const Patient = require("../models/Patient");
const auth = require("../middleware/auth");

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
// Authenticated web clients only; ESP32 uses GET /api/dose-time
router.post("/", auth, async (req, res) => {
  try {
    const update = buildUpdate(req.body);

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided"
      });
    }

    // Check if deviceId is linked to an active patient (if deviceId is being updated)
    if (update.deviceId) {
      // First ensure the device is linked to an active patient at all
      const patient = await Patient.findOne({
        deviceId: update.deviceId,
        deviceActive: true
      });

      if (!patient) {
        return res.status(403).json({
          success: false,
          message: "Device not linked to an active patient"
        });
      }

      // If the caller is a caregiver, also enforce that they are allowed
      // to manage this patient's schedule via caregivers[]
      if (req.userRole === "caregiver") {
        const authorized = await Patient.findOne({
          deviceId: update.deviceId,
          deviceActive: true,
          caregivers: req.userId
        });

        if (!authorized) {
          return res.status(403).json({
            success: false,
            message: "Caregiver access required for this patient's schedule"
          });
        }
      }
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
    const { deviceId } = req.query;
    
    // If deviceId is provided, check if it's linked to an active patient
    if (deviceId) {
      const patient = await Patient.findOne({ 
        deviceId: deviceId, 
        deviceActive: true 
      });
      
      if (!patient) {
        return res.status(403).json({
          success: false,
          message: "Device not linked to an active patient"
        });
      }
    }
    
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

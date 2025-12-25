const express = require("express");
const router = express.Router();
const DoseLog = require("../models/DoseLog");

const MEALS = ["morning", "afternoon", "night"];
const TIMINGS = ["before", "after"];
const STATUSES = ["taken", "missed"];

function validateLog(body) {
  if (!body.deviceId || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
    return { ok: false, message: "deviceId is required" };
  }
  if (!body.date || typeof body.date !== "string") {
    return { ok: false, message: "date is required" };
  }
  if (!MEALS.includes(body.meal)) {
    return { ok: false, message: "meal must be one of morning/afternoon/night" };
  }
  if (!TIMINGS.includes(body.timing)) {
    return { ok: false, message: "timing must be before/after" };
  }
  if (!body.scheduledTime || typeof body.scheduledTime !== "string") {
    return { ok: false, message: "scheduledTime is required" };
  }
  if (!STATUSES.includes(body.status)) {
    return { ok: false, message: "status must be taken/missed" };
  }

  return {
    ok: true,
    data: {
      deviceId: body.deviceId.trim(),
      date: body.date,
      meal: body.meal,
      timing: body.timing,
      scheduledTime: body.scheduledTime,
      status: body.status
    }
  };
}

/**
 * POST /api/dose-log
 * ESP32 sends taken / missed event
 */
router.post("/", async (req, res) => {
  try {
    const validated = validateLog(req.body);
    if (!validated.ok) {
      return res.status(400).json({ success: false, message: validated.message });
    }

    const log = new DoseLog(validated.data);

    await log.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dose-log?deviceId=DEVICE_001
 * Frontend fetches history for one device
 */
router.get("/", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: "deviceId is required"
      });
    }

    const logs = await DoseLog.find({ deviceId })
      .sort({ timestamp: -1 })
      .limit(limit);

    res.json(logs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

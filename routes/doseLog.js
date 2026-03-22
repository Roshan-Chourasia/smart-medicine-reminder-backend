const express = require("express");
const router = express.Router();
const DoseLog = require("../models/DoseLog");
const Patient = require("../models/Patient");
const nodemailer = require("nodemailer");

const MEALS = ["morning", "afternoon", "night"];
const TIMINGS = ["before", "after"];
const STATUSES = ["taken", "missed"];

function isEmail(value) {
  if (!value || typeof value !== "string") return false;
  // Basic email format check; avoids trying to email to phone numbers
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function prettifyMeal(meal) {
  if (!meal) return meal;
  return meal.charAt(0).toUpperCase() + meal.slice(1);
}

function prettifyTiming(timing) {
  if (!timing) return timing;
  return timing.charAt(0).toUpperCase() + timing.slice(1);
}

async function sendMissedDoseEmail({ patient, logData }) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return;

  // We currently store caregiver phone in `caregiverPhone`.
  // For this email feature, only send if it looks like an email address.
  // (If you later add caregiverEmail, we can switch to that safely.)
  const to = patient?.caregiverEmail || (isEmail(patient?.caregiverPhone) ? patient.caregiverPhone.trim() : null);
  if (!to) return;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    family: 4,
    auth: { user, pass }
  });

  const subject = "🚨 Medication Missed Alert";
  const mealLabel = `${prettifyMeal(logData.meal)} (${prettifyTiming(logData.timing)})`;

  const body = [
    subject,
    "",
    `Patient: ${patient?.name || "Unknown"}`,
    `Dose: ${mealLabel}`,
    `Time: ${logData.scheduledTime}`,
    `Status: MISSED`,
    "",
    "Please take necessary action."
  ].join("\n");

  await transporter.sendMail({
    from: user,
    to,
    subject,
    text: body
  });
}

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

    // Check if deviceId is linked to an active patient
    const patient = await Patient.findOne({ 
      deviceId: validated.data.deviceId, 
      deviceActive: true 
    });
    
    if (!patient) {
      return res.status(403).json({
        success: false,
        message: "Device not linked to an active patient"
      });
    }

    // Deduplicate retries so ESP32 re-sends don't spam DB/emails.
    const existing = await DoseLog.findOne({
      deviceId: validated.data.deviceId,
      date: validated.data.date,
      meal: validated.data.meal,
      timing: validated.data.timing,
      scheduledTime: validated.data.scheduledTime,
      status: validated.data.status
    });

    if (!existing) {
      const log = new DoseLog(validated.data);
      await log.save();
    }

    // Fire-and-forget notification only for missed doses.
    if (validated.data.status === "missed") {
      sendMissedDoseEmail({ patient, logData: validated.data }).catch((emailErr) => {
        console.warn("Failed to send missed dose email:", emailErr.message);
      });
    }
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

    // Check if deviceId is linked to an active patient
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

    const logs = await DoseLog.find({ deviceId })
      .sort({ timestamp: -1 })
      .limit(limit);

    res.json(logs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const DoseLog = require("../models/DoseLog");
const Patient = require("../models/Patient");
const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

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

/**
 * Send missed-dose alert.
 * - Production (Render, etc.): SENDGRID_API_KEY — HTTPS API (port 443), no SMTP blocking.
 * - Fallback: EMAIL_USER + EMAIL_PASS — Gmail SMTP on 587 + IPv4 (local / SMTP-allowed hosts).
 */
async function sendMissedDoseEmail({ patient, logData }) {
  console.log("[missed-dose-email] function triggered");

  const to =
    patient?.caregiverEmail ||
    (isEmail(patient?.caregiverPhone) ? patient.caregiverPhone.trim() : null);

  console.log("[missed-dose-email] recipient:", to || "(none)");

  if (!to) {
    console.log("[missed-dose-email] no valid caregiver email — set caregiverEmail or email-shaped caregiverPhone on patient");
    return;
  }

  const subject = "🚨 Medication Missed Alert";
  const mealLabel = `${prettifyMeal(logData.meal)} (${prettifyTiming(logData.timing)})`;
  const patientName = patient?.name || "Unknown";

  const text = [
    subject,
    "",
    `Patient: ${patientName}`,
    `Dose: ${mealLabel}`,
    `Time: ${logData.scheduledTime}`,
    `Status: MISSED`,
    "",
    "Please take necessary action."
  ].join("\n");

  const html = `
    <h2>Missed dose alert</h2>
    <p><b>Patient:</b> ${patientName}</p>
    <p><b>Dose:</b> ${mealLabel}</p>
    <p><b>Scheduled time:</b> ${logData.scheduledTime}</p>
    <p><b>Status:</b> MISSED</p>
    <p>Please take necessary action.</p>
  `.trim();

  if (process.env.SENDGRID_API_KEY) {
    console.log("[missed-dose-email] using SendGrid");
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    if (!from) {
      console.log("[missed-dose-email] EMAIL_FROM and EMAIL_USER both missing — cannot send");
      return;
    }
    try {
      const [response] = await sgMail.send({
        to,
        from,
        subject,
        text,
        html
      });
      const msgId =
        response.headers &&
        (response.headers["x-message-id"] || response.headers["X-Message-Id"]);
      console.log("[missed-dose-email] SendGrid accepted (202 = queued for delivery):", {
        from,
        to,
        statusCode: response.statusCode,
        xMessageId: msgId
      });
    } catch (err) {
      console.error(
        "[missed-dose-email] SendGrid error:",
        err.response?.body || err.message
      );
    }
    return;
  }

  console.log("[missed-dose-email] SendGrid not configured — falling back to Gmail SMTP (unexpected on Render)");

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) {
    console.log("[missed-dose-email] EMAIL_USER/EMAIL_PASS missing — cannot use SMTP fallback");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      family: 4,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: user,
      to,
      subject,
      text,
      html
    });
    console.log("[missed-dose-email] SMTP: mail sent successfully");
  } catch (err) {
    console.error("[missed-dose-email] SMTP error:", err.message);
  }
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

    console.log("[dose-log POST] success", {
      deviceId: validated.data.deviceId,
      status: validated.data.status,
      duplicateSkipped: Boolean(existing)
    });

    if (validated.data.status === "missed") {
      console.log("[dose-log POST] missed dose detected — sending alert email");
      try {
        await sendMissedDoseEmail({ patient, logData: validated.data });
      } catch (emailErr) {
        console.warn("[dose-log POST] sendMissedDoseEmail threw:", emailErr.message);
      }
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

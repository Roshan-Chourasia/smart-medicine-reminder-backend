require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

// CORS configuration - allow Vercel frontend and localhost for development
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:3000",
  "http://127.0.0.1:5500", // For local testing with Live Server
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
        callback(null, true);
      } else {
        // For development, allow all origins
        if (process.env.NODE_ENV !== "production") {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/medicineDB";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Routes
app.use("/api/dose-time", require("./routes/doseTime"));
app.use("/api/dose-log", require("./routes/doseLog"));

// Auth routes (will be implemented next); keep server running even if file is absent.
let authRoutes;
try {
  authRoutes = require("./routes/auth");
} catch (err) {
  console.warn("Auth routes not available yet:", err.message);
  authRoutes = express.Router();
}
app.use("/api/auth", authRoutes);

// Protect patient routes only (device routes remain open). Skip if route file missing.
try {
  const patientRoutes = require("./routes/patient");
  const authMiddleware = require("./middleware/auth");
  app.use("/api/patient", authMiddleware, patientRoutes);
} catch (err) {
  console.warn("Patient routes not available yet:", err.message);
}

// Public heartbeat endpoint (no auth required - ESP32 devices call this)
try {
  const Patient = require("./models/Patient");
  app.post("/api/device/heartbeat", async (req, res) => {
    try {
      const { deviceId } = req.body;
      
      if (!deviceId) {
        return res.status(400).json({ message: 'deviceId is required' });
      }
      
      // Update lastSeen timestamp for the patient with this deviceId
      const patient = await Patient.findOneAndUpdate(
        { deviceId: deviceId, deviceActive: true },
        { deviceLastSeen: new Date() },
        { new: true }
      );
      
      if (!patient) {
        return res.status(404).json({ message: 'Device not found or not active' });
      }
      
      res.json({ success: true, message: 'Heartbeat received' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to process heartbeat', error: err.message });
    }
  });
} catch (err) {
  console.warn("Heartbeat endpoint not available:", err.message);
}

// Public one-shot manual command poll (ESP32)
try {
  const Patient = require("./models/Patient");
  app.get("/api/device/manual-command", async (req, res) => {
    try {
      const deviceId = req.query.deviceId;
      if (!deviceId || typeof deviceId !== "string") {
        return res.status(400).json({ message: "deviceId is required" });
      }

      const patient = await Patient.findOne({
        deviceId: deviceId,
        deviceActive: true
      });

      if (!patient) {
        return res.status(404).json({ message: "Device not found or not active" });
      }

      const action = patient.deviceManualCommandAction;
      const slot = patient.deviceManualCommandSlot;

      // No pending command
      if (!action || !slot) {
        return res.json({ action: null, slot: null });
      }

      // Clear after consuming (one-shot)
      patient.deviceManualCommandAction = null;
      patient.deviceManualCommandSlot = null;
      patient.deviceManualCommandAt = null;
      await patient.save();

      return res.json({ action, slot });
    } catch (err) {
      return res.status(500).json({ message: "Failed to fetch manual command", error: err.message });
    }
  });
} catch (err) {
  console.warn("Manual command endpoint not available:", err.message);
}

// Device management routes (protected - web app only)
try {
  const deviceRoutes = require("./routes/device");
  const authMiddleware = require("./middleware/auth");
  app.use("/api/device", authMiddleware, deviceRoutes);
} catch (err) {
  console.warn("Device routes not available yet:", err.message);
}

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

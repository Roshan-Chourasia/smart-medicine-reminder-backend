const express = require('express');
const Patient = require('../models/Patient');
const auth = require('../middleware/auth');
const router = express.Router();

const allowedSlots = ['morning', 'afternoon', 'night'];
const allowedActions = ['open', 'close'];

// Helper: ensure the requester is a caregiver and is allowed to manage this patient
async function findAuthorizedPatient(patientId, userId, userRole) {
  // Must be logged in as caregiver to manage devices
  if (userRole !== 'caregiver') {
    return null;
  }

  // Allow either:
  // - legacy ownership by userId, OR
  // - explicit caregiver assignment in caregivers[]
  const patient = await Patient.findOne({
    _id: patientId,
    $or: [{ userId }, { caregivers: userId }]
  });

  return patient;
}

// Helper: find authorized patient by deviceId (for manual open/close)
async function findAuthorizedPatientByDevice(deviceId, userId, userRole) {
  if (userRole !== 'caregiver') return null;

  return Patient.findOne({
    deviceId,
    deviceActive: true,
    $or: [{ userId }, { caregivers: userId }]
  });
}

// POST /api/device/link - Link a device to a patient
router.post('/link', auth, async (req, res) => {
  try {
    const { patientId, deviceId } = req.body;
    
    if (!patientId || !deviceId) {
      return res.status(400).json({ message: 'patientId and deviceId are required' });
    }
    
    // Check if patient belongs to / is managed by the authenticated caregiver
    const patient = await findAuthorizedPatient(patientId, req.userId, req.userRole);
    if (!patient) {
      return res.status(403).json({ message: 'Caregiver access required for this patient' });
    }
    
    // Check if device is already linked to another active patient
    const existingPatient = await Patient.findOne({ 
      deviceId: deviceId, 
      deviceActive: true,
      _id: { $ne: patientId }
    });
    
    if (existingPatient) {
      return res.status(400).json({ 
        message: 'Device is already linked to another patient. Please unlink it first.' 
      });
    }
    
    // Link device to patient
    patient.deviceId = deviceId;
    patient.deviceActive = true;
    await patient.save();
    
    res.json({ success: true, patient });
  } catch (err) {
    res.status(500).json({ message: 'Failed to link device', error: err.message });
  }
});

// POST /api/device/unlink - Unlink device from patient (temporary logout)
router.post('/unlink', auth, async (req, res) => {
  try {
    const { patientId } = req.body;
    
    if (!patientId) {
      return res.status(400).json({ message: 'patientId is required' });
    }
    
    // Check if patient belongs to / is managed by the authenticated caregiver
    const patient = await findAuthorizedPatient(patientId, req.userId, req.userRole);
    if (!patient) {
      return res.status(403).json({ message: 'Caregiver access required for this patient' });
    }
    
    // Clear deviceId but keep patient data (temporary logout)
    patient.deviceId = null;
    patient.deviceActive = false;
    await patient.save();
    
    res.json({ success: true, message: 'Device unlinked successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to unlink device', error: err.message });
  }
});

// POST /api/device/disable - Disable device (keep linked but inactive)
router.post('/disable', auth, async (req, res) => {
  try {
    const { patientId } = req.body;
    
    if (!patientId) {
      return res.status(400).json({ message: 'patientId is required' });
    }
    
    // Check if patient belongs to / is managed by the authenticated caregiver
    const patient = await findAuthorizedPatient(patientId, req.userId, req.userRole);
    if (!patient) {
      return res.status(403).json({ message: 'Caregiver access required for this patient' });
    }
    
    if (!patient.deviceId) {
      return res.status(400).json({ message: 'Patient has no device linked' });
    }
    
    // Disable device but keep deviceId
    patient.deviceActive = false;
    await patient.save();
    
    res.json({ success: true, message: 'Device disabled successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to disable device', error: err.message });
  }
});

// POST /api/device/enable - Enable device (reactivate)
router.post('/enable', auth, async (req, res) => {
  try {
    const { patientId } = req.body;
    
    if (!patientId) {
      return res.status(400).json({ message: 'patientId is required' });
    }
    
    // Check if patient belongs to / is managed by the authenticated caregiver
    const patient = await findAuthorizedPatient(patientId, req.userId, req.userRole);
    if (!patient) {
      return res.status(403).json({ message: 'Caregiver access required for this patient' });
    }
    
    if (!patient.deviceId) {
      return res.status(400).json({ message: 'Patient has no device linked' });
    }
    
    // Check if device is already linked to another active patient
    const existingPatient = await Patient.findOne({ 
      deviceId: patient.deviceId, 
      deviceActive: true,
      _id: { $ne: patientId }
    });
    
    if (existingPatient) {
      return res.status(400).json({ 
        message: 'Device is already linked to another active patient. Please unlink it first.' 
      });
    }
    
    // Enable device
    patient.deviceActive = true;
    await patient.save();
    
    res.json({ success: true, message: 'Device enabled successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to enable device', error: err.message });
  }
});

// POST /api/device/manual-command - caregiver requests manual open/close
// Body: { deviceId, slot: 'morning'|'afternoon'|'night', action: 'open'|'close' }
router.post('/manual-command', auth, async (req, res) => {
  try {
    const { deviceId, slot, action } = req.body;

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ message: 'deviceId is required' });
    }
    if (!slot || !allowedSlots.includes(slot)) {
      return res.status(400).json({ message: 'slot must be one of morning/afternoon/night' });
    }
    if (!action || !allowedActions.includes(action)) {
      return res.status(400).json({ message: 'action must be one of open/close' });
    }

    const patient = await findAuthorizedPatientByDevice(deviceId, req.userId, req.userRole);
    if (!patient) {
      return res.status(403).json({ message: 'Caregiver access required for this device' });
    }

    // One-shot command; ESP32 polls and clears it after execution.
    patient.deviceManualCommandAction = action;
    patient.deviceManualCommandSlot = slot;
    patient.deviceManualCommandAt = new Date();
    await patient.save();

    res.json({ success: true, message: 'Manual command queued' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send manual command', error: err.message });
  }
});

// Note: Heartbeat endpoint is registered as a public route in server.js
// (no auth required since ESP32 devices don't have tokens)

module.exports = router;

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// Patient model - will work once models/Patient.js exists
let Patient;
try {
  Patient = require('../models/Patient');
} catch (err) {
  // Patient model doesn't exist yet - routes will return appropriate messages
  console.warn('Patient model not found. Patient routes will be limited.');
}

// Helper: Check if device is online (lastSeen within 90 seconds)
function isDeviceOnline(deviceLastSeen) {
  if (!deviceLastSeen) return false;
  const now = new Date();
  const diffMs = now - new Date(deviceLastSeen);
  const diffSeconds = diffMs / 1000;
  return diffSeconds < 90; // Device is online if last heartbeat was within 90 seconds
}

// Helper: Add online status to patient object
function addOnlineStatus(patient) {
  const patientObj = patient.toObject ? patient.toObject() : patient;
  if (patientObj.deviceId && patientObj.deviceActive) {
    patientObj.deviceOnline = isDeviceOnline(patientObj.deviceLastSeen);
  } else {
    patientObj.deviceOnline = false;
  }
  return patientObj;
}

// GET /api/patient - Get all patients for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    if (!Patient) {
      return res.status(503).json({ message: 'Patient model not available yet' });
    }
    const patients = await Patient.find({
      $or: [{ userId: req.userId }, { caregivers: req.userId }]
    });
    // Add online status to each patient
    const patientsWithStatus = patients.map(p => addOnlineStatus(p));
    res.json(patientsWithStatus);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch patients', error: err.message });
  }
});

// POST /api/patient - Create a new patient for the authenticated user
router.post('/', auth, async (req, res) => {
  try {
    if (!Patient) {
      return res.status(503).json({ message: 'Patient model not available yet' });
    }
    // Always set the owning user
    const payload = { ...req.body, userId: req.userId };

    // If the logged-in user is a caregiver, auto-add them to the caregivers list
    // so they have explicit management rights for this patient.
    if (req.userRole === 'caregiver') {
      payload.caregivers = [req.userId];
    }

    const patient = await Patient.create(payload);
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create patient', error: err.message });
  }
});

// GET /api/patient/:id - Get a specific patient (must belong to the user)
router.get('/:id', auth, async (req, res) => {
  try {
    if (!Patient) {
      return res.status(503).json({ message: 'Patient model not available yet' });
    }
    const patient = await Patient.findOne({
      _id: req.params.id,
      $or: [{ userId: req.userId }, { caregivers: req.userId }]
    });
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    res.json(addOnlineStatus(patient));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch patient', error: err.message });
  }
});

// PUT /api/patient/:id - Update a patient (must belong to the user)
router.put('/:id', auth, async (req, res) => {
  try {
    if (!Patient) {
      return res.status(503).json({ message: 'Patient model not available yet' });
    }
    const patient = await Patient.findOneAndUpdate(
      { _id: req.params.id, $or: [{ userId: req.userId }, { caregivers: req.userId }] },
      req.body,
      { new: true }
    );
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    res.json(addOnlineStatus(patient));
  } catch (err) {
    res.status(500).json({ message: 'Failed to update patient', error: err.message });
  }
});

// DELETE /api/patient/:id - Delete a patient (must belong to the user)
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!Patient) {
      return res.status(503).json({ message: 'Patient model not available yet' });
    }
    const patient = await Patient.findOneAndDelete({
      _id: req.params.id,
      $or: [{ userId: req.userId }, { caregivers: req.userId }]
    });
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    res.json({ message: 'Patient deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete patient', error: err.message });
  }
});

module.exports = router;

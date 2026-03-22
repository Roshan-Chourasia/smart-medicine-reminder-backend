const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Patient = require('../models/Patient');

const router = express.Router();

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const trimmedName = String(name).trim();
    if (!trimmedName) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const userData = { name: trimmedName, email: normalizedEmail, passwordHash };
    if (role === "patient" || role === "caregiver") {
      userData.role = role;
    }
    const createdUser = await User.create(userData);

    // If a patient user signs up, link any caregiver-created Patient records
    // that were created with the same patientEmail.
    if (createdUser.role === 'patient') {
      try {
        await Patient.updateMany(
          { patientEmail: normalizedEmail },
          { $set: { userId: createdUser._id } }
        );
      } catch (linkErr) {
        // Don't block signup if linking fails; user can still proceed.
        console.warn('Failed to link patient records on signup:', linkErr.message);
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Signup failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user._id, role: user.role }, 
      process.env.JWT_SECRET, 
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    res.json({
      token,
      name: user.name || null,
      email: user.email
    });
  } catch (err) {
    res.status(500).json({ message: 'Login failed' });
  }
});

module.exports = router;

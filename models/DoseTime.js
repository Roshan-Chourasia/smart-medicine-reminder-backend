const mongoose = require("mongoose");

const TimeSlotSchema = new mongoose.Schema({
  before: { type: String, default: null },
  after: { type: String, default: null }
}, { _id: false });

const DoseTimeSchema = new mongoose.Schema({
  _id: { type: String, default: "main" },
  deviceId: { type: String, default: "DEVICE_001" },
  morning: { type: TimeSlotSchema, default: () => ({ before: null, after: null }) },
  afternoon: { type: TimeSlotSchema, default: () => ({ before: null, after: null }) },
  night: { type: TimeSlotSchema, default: () => ({ before: null, after: null }) }
});

module.exports = mongoose.model("DoseTime", DoseTimeSchema);
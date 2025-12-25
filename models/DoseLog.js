const mongoose = require("mongoose");

const DoseLogSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  date: { type: String, required: true }, 
  meal: {                                   
    type: String,
    enum: ["morning", "afternoon", "night"],
    required: true
  },
  timing: {                             
    type: String,
    enum: ["before", "after"],
    required: true
  },
  scheduledTime: { type: String, required: true }, 
  status: {                               
    type: String,
    enum: ["taken", "missed"],
    required: true
  },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("DoseLog", DoseLogSchema);

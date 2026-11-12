
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// Frontend connection
const allowedOrigins = (
  process.env.FRONTEND_ORIGIN || "http://localhost:8000"
).split(",").map(origin => origin.trim());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS"));
  }
}));

// Request parsing
app.use(express.json({ limit: "20kb" }));

// Basic API route
app.get("/", (req, res) => {
  res.json({
    app: "HealthGuard Lite API",
    status: "running",
    version: "1.0.0"
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "HealthGuard Lite backend is healthy"
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(err.message === "Origin not allowed by CORS" ? 403 : 500)
    .json({
      success: false,
      message: "Request could not be processed"
    });
});

// Start server
app.listen(PORT, () => {
  console.log(`HealthGuard Lite API running on port ${PORT}`);
});

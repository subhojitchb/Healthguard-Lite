
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const { testConnection } = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = (
  process.env.FRONTEND_ORIGIN || "http://localhost:8000"
)
  .split(",")
  .map(origin => origin.trim());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS"));
  }
}));

// Parse JSON requests
app.use(express.json({ limit: "20kb" }));

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    app: "HealthGuard Lite API",
    status: "running",
    version: "1.0.0"
  });
});

// Database health check
app.get("/api/health", async (req, res) => {
  try {
    const database = await testConnection();

    res.status(200).json({
      success: true,
      server: "online",
      database: "connected",
      timestamp: database.current_time
    });

  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      success: false,
      server: "online",
      database: "unavailable"
    });
  }
});

// Authentication routes
app.use("/api/auth", authRoutes);

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found"
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  const status = err.message === "Origin not allowed by CORS"
    ? 403
    : 500;

  res.status(status).json({
    success: false,
    message: "Request could not be processed"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`HealthGuard Lite API running on port ${PORT}`);
});


const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createToken(userId) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "1h",
      issuer: "healthguard-lite"
    }
  );
}

// REGISTER
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body || {};

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof name !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Name, email and password are required"
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const displayName = name.trim();

  if (
    !EMAIL_REGEX.test(normalizedEmail) ||
    normalizedEmail.length > 255
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address"
    });
  }

  if (displayName.length < 2 || displayName.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Name must contain 2–100 characters"
    });
  }

  if (
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 12 characters and no more than 72 UTF-8 bytes"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      [normalizedEmail, passwordHash]
    );

    const user = result.rows[0];

    await client.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, $2)`,
      [user.id, displayName]
    );

    await client.query("COMMIT");

    const token = createToken(user.id);

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: displayName
      }
    });

  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to create account"
    });

  } finally {
    client.release();
  }
});


// LOGIN
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !EMAIL_REGEX.test(email.trim()) ||
    email.trim().length > 255 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid email or password"
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const profileResult = await pool.query(
      `SELECT display_name
       FROM profiles
       WHERE user_id = $1`,
      [user.id]
    );

    const token = createToken(user.id);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: profileResult.rows[0]?.display_name || ""
      }
    });

  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to complete login"
    });
  }
});

// VERIFY CURRENT SESSION
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT users.id, users.email, profiles.display_name
       FROM users
       LEFT JOIN profiles ON profiles.user_id = users.id
       WHERE users.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User account not found"
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name || ""
      }
    });

  } catch (error) {
    console.error("Session verification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify session"
    });
  }
});

module.exports = router;

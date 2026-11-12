
-- =====================================================
-- HEALTHGUARD LITE
-- PostgreSQL Database Schema
-- Version: 1.0.1
-- =====================================================

-- 1. USER ACCOUNTS
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email VARCHAR(255) NOT NULL,

    password_hash TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
ON users (LOWER(email));


-- 2. USER PROFILES
CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,

    display_name VARCHAR(100),

    age SMALLINT CHECK (
        age IS NULL OR age BETWEEN 1 AND 120
    ),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 3. HEALTH RECORDS
CREATE TABLE IF NOT EXISTS health_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    metric_type VARCHAR(20) NOT NULL
        CHECK (
            metric_type IN ('heart_rate', 'spo2')
        ),

    value NUMERIC(6,2) NOT NULL,

    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    source VARCHAR(50),

    quality VARCHAR(20),

    CONSTRAINT health_metric_value_check CHECK (
        (
            metric_type = 'heart_rate'
            AND value BETWEEN 30 AND 220
        )
        OR
        (
            metric_type = 'spo2'
            AND value BETWEEN 1 AND 100
        )
    )
);

CREATE INDEX IF NOT EXISTS health_records_user_time_idx
ON health_records (user_id, recorded_at DESC);


-- 4. DAILY STEP COUNTS
CREATE TABLE IF NOT EXISTS daily_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    step_date DATE NOT NULL,

    steps INTEGER NOT NULL
        CHECK (steps >= 0 AND steps <= 1000000),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_user_step_date
        UNIQUE (user_id, step_date)
);


-- 5. EMERGENCY CONTACTS
CREATE TABLE IF NOT EXISTS emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    contact_name VARCHAR(100) NOT NULL,

    contact_phone VARCHAR(30) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emergency_contacts_user_idx
ON emergency_contacts (user_id);


-- =====================================================
-- END OF HEALTHGUARD LITE DATABASE SCHEMA
-- =====================================================

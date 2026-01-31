-- Phase 2: Automation - Scheduled Generation & Auto-Retry Infrastructure
-- This migration adds tables for tracking scheduled generations and failed attempts

-- Table 1: Scheduled Generation Log (track all scheduled runs)
CREATE TABLE IF NOT EXISTS scheduled_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_type VARCHAR(50) NOT NULL,  -- 'Morning', 'Midday', 'Evening'
  regions TEXT[] NOT NULL,  -- Array of regions
  languages TEXT[] NOT NULL,  -- Array of languages
  scheduled_time TIMESTAMP NOT NULL,  -- When it was scheduled to run
  started_at TIMESTAMP,  -- When it actually started
  completed_at TIMESTAMP,  -- When it completed
  status VARCHAR(20) NOT NULL,  -- 'pending', 'running', 'success', 'failed'
  total_combinations INT,  -- Total region/language combinations
  success_count INT DEFAULT 0,  -- How many succeeded
  error_count INT DEFAULT 0,  -- How many failed
  metadata JSONB,  -- Additional info
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_logs_status ON scheduled_generation_logs(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_logs_timestamp ON scheduled_generation_logs(scheduled_time);

-- Table 2: Failed Generations (for auto-retry)
CREATE TABLE IF NOT EXISTS failed_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_type VARCHAR(50) NOT NULL,
  region VARCHAR(50) NOT NULL,
  language VARCHAR(50) NOT NULL,
  generation_date DATE NOT NULL,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  last_retry_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_gen_unresolved ON failed_generations(is_resolved, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_failed_gen_retry_time ON failed_generations(next_retry_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_failed_gen_unique ON failed_generations(edition_type, region, language, generation_date)
  WHERE is_resolved = FALSE;

-- Table 3: Generation Status (current state of each edition combo)
CREATE TABLE IF NOT EXISTS generation_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_type VARCHAR(50) NOT NULL,
  region VARCHAR(50) NOT NULL,
  language VARCHAR(50) NOT NULL,
  generation_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL,  -- 'pending', 'generating', 'success', 'failed'
  last_attempt_at TIMESTAMP,
  next_attempt_at TIMESTAMP,
  error_message TEXT,
  attempts INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gen_status_date ON generation_status(generation_date);
CREATE INDEX IF NOT EXISTS idx_gen_status_pending ON generation_status(status)
  WHERE status IN ('pending', 'generating');
CREATE UNIQUE INDEX IF NOT EXISTS idx_gen_status_unique
  ON generation_status(edition_type, region, language, generation_date);

-- Phase 1: Foundation - Cache Analytics, Refresh History, App Logs
-- This migration adds infrastructure for request coalescing, throttling, and analytics

-- Table 1: Cache Analytics (for visibility into cache performance)
CREATE TABLE IF NOT EXISTS cache_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL,
  cache_hits INT DEFAULT 0,
  cache_misses INT DEFAULT 1,
  hit_rate DECIMAL,
  total_requests INT,
  cost_per_generation DECIMAL,
  total_cost DECIMAL,
  cost_saved_by_cache DECIMAL,
  force_refreshes INT DEFAULT 0,
  last_refresh_time TIMESTAMP,
  generation_time_ms INT,
  api_call_breakdown JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cache_analytics_date ON cache_analytics(DATE(created_at));
CREATE INDEX IF NOT EXISTS idx_cache_analytics_key ON cache_analytics(cache_key);

-- Table 2: User Refresh History (for throttling force refreshes)
CREATE TABLE IF NOT EXISTS user_refresh_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  edition_key TEXT NOT NULL,
  force_refresh_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_history_user_edition ON user_refresh_history(user_id, edition_key);
CREATE INDEX IF NOT EXISTS idx_refresh_history_timestamp ON user_refresh_history(force_refresh_at);

-- Table 3: Application Logs (for comprehensive debugging)
CREATE TABLE IF NOT EXISTS app_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level VARCHAR(20) NOT NULL,
  service VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  message TEXT,
  metadata JSONB,
  user_id UUID,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_logs_service_timestamp ON app_logs(service, created_at);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);

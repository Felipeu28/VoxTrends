-- Phase 4: Content Expiration & Shareable Links
-- Tables for managing content lifecycle and shareable access

-- Shared editions: Allows unauthenticated access to specific editions via share links
CREATE TABLE IF NOT EXISTS shared_editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES daily_editions(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  share_token text NOT NULL UNIQUE,  -- Short token for URL: voxtrends.com/shared/audio/{share_token}
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,  -- 30 days from creation
  access_count bigint DEFAULT 0,
  last_accessed_at timestamp with time zone,
  metadata jsonb,  -- Track device/user agent info for analytics

  CONSTRAINT share_token_format CHECK (share_token ~ '^[a-z0-9]{12,}$')
);

-- Track content deletion schedule
CREATE TABLE IF NOT EXISTS content_expiration_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES daily_editions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tier text NOT NULL CHECK (tier IN ('free', 'pro', 'studio')),  -- From user subscription
  scheduled_deletion_at timestamp with time zone NOT NULL,
  deleted_at timestamp with time zone,
  skip_deletion boolean DEFAULT false,  -- User can manually preserve content (pro feature)
  reason text,  -- Why it was deleted: 'expired', 'manual', etc

  UNIQUE(edition_id, user_id)
);

-- Audit log for shared access (lightweight analytics)
CREATE TABLE IF NOT EXISTS shared_access_logs (
  id bigserial PRIMARY KEY,
  share_id uuid NOT NULL REFERENCES shared_editions(id) ON DELETE CASCADE,
  accessed_at timestamp with time zone NOT NULL DEFAULT now(),
  user_agent text,
  ip_hash text,  -- Hash to avoid storing PII
  country_code text,  -- From IP geolocation if available
  listened_duration_seconds integer  -- If implemented in frontend
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shared_editions_user_id ON shared_editions(created_by);
CREATE INDEX IF NOT EXISTS idx_shared_editions_expires_at ON shared_editions(expires_at);
CREATE INDEX IF NOT EXISTS idx_shared_editions_share_token ON shared_editions(share_token);
CREATE INDEX IF NOT EXISTS idx_content_expiration_scheduled_deletion ON content_expiration_schedule(scheduled_deletion_at);
CREATE INDEX IF NOT EXISTS idx_content_expiration_tier ON content_expiration_schedule(tier, scheduled_deletion_at);
CREATE INDEX IF NOT EXISTS idx_shared_access_share_id ON shared_access_logs(share_id);
CREATE INDEX IF NOT EXISTS idx_shared_access_accessed_at ON shared_access_logs(accessed_at);

-- Retention policies:
-- Free: 24 hours, Pro: 7 days, Studio: 30 days
-- Shareable links: Always 30 days from creation
-- Cleanup runs daily via cron job

-- Add user_id column to daily_editions (Phase 3+ requirement)
-- Tracks which user owns/generated each edition
ALTER TABLE daily_editions
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for user queries
CREATE INDEX IF NOT EXISTS idx_daily_editions_user_id ON daily_editions(user_id);

COMMENT ON COLUMN daily_editions.user_id IS 'User who generated/requested this edition';

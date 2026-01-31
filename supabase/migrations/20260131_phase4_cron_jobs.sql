-- Phase 4: Cron Jobs for Content Expiration
-- ⚠️ IMPORTANT: pg_cron extension MUST be enabled BEFORE running this!
--
-- Steps:
-- 1. Go to: Supabase Dashboard → Extensions
-- 2. Search for "pg_cron"
-- 3. Click to enable (if not already enabled)
-- 4. THEN run this migration
--
-- This migration requires the cleanup_expired_content() function (20260131_phase4_cleanup_function.sql)
-- Make sure to run that migration first!

-- Schedule daily cleanup at 1 AM UTC
SELECT cron.schedule(
  'cleanup-expired-content-daily',
  '0 1 * * *',
  'SELECT cleanup_expired_content();'
);

-- Helpful commands to check cron jobs:
-- View active cron jobs:
--   SELECT * FROM cron.job;
--
-- View job run history:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--
-- View cleanup results in app_logs:
--   SELECT * FROM app_logs WHERE service = 'cleanup-expired-content' ORDER BY created_at DESC LIMIT 10;
--
-- Manually trigger cleanup (for testing):
--   SELECT cleanup_expired_content();

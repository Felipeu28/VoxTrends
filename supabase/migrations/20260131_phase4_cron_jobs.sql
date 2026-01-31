-- Phase 4: Cron Jobs for Content Expiration
-- NOTE: Requires pg_cron extension to be enabled in Supabase
-- See Phase 2 notes on enabling pg_cron

-- Daily cleanup of expired content at 1 AM UTC
-- This runs after the evening edition is scheduled (6 PM previous day)
-- Timing ensures minimal load during peak usage hours
SELECT
  cron.schedule(
    'cleanup-expired-content-daily',
    '0 1 * * *',  -- 1 AM UTC daily
    $$
    SELECT
      net.http_post(
        url := concat(current_setting('app.supabase_url'), '/functions/v1/cleanup-expired-content'),
        headers := jsonb_build_object(
          'Authorization', concat('Bearer ', current_setting('app.service_role_key')),
          'Content-Type', 'application/json',
          'X-Service-Name', 'cron'
        ),
        body := jsonb_build_object(
          'action', 'cleanup'
        )::text
      ) AS request_id;
    $$
  );

-- Verify cron job was created
SELECT * FROM cron.job WHERE jobname = 'cleanup-expired-content-daily';

COMMENT ON PROCEDURE cron.schedule(text, text, text) IS
'Phase 4 content expiration cleanup - runs daily at 1 AM UTC
Deletes editions based on retention policy:
  - Free tier: 24 hours
  - Pro tier: 7 days
  - Studio tier: 30 days
Also cleans up expired share links (30 days)
Logs results to database for monitoring
Total daily cleanup: ~5-20 editions depending on user base';

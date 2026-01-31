-- Phase 2: Cron Jobs for Automated Scheduling
-- These jobs pre-generate editions at scheduled times and auto-retry failures
-- Run these commands in Supabase SQL Editor

-- IMPORTANT: pg_cron must be enabled in your Supabase project
-- If you get "schema cron does not exist" error:
-- 1. Go to Supabase Dashboard
-- 2. Click on your project
-- 3. Go to SQL Editor
-- 4. Check "Extensions" section - search for "pg_cron"
-- 5. If not enabled, click to enable it (or contact Supabase support)
-- 6. Then come back and run these cron job commands

-- Configuration:
-- Regions: us, global, colombia, venezuela, europe, asia (6 total)
-- Languages: en, es (English, Spanish only - 2 total)
-- Editions: Morning, Midday, Evening (3 total)
-- Total combinations per run: 6 × 2 = 12 combinations per edition × 3 editions = 36 total

-- ==================== MORNING EDITION (6:00 AM UTC) ====================
-- This runs every day at 6:00 AM UTC to pre-generate Morning editions
SELECT cron.schedule(
  'scheduled-generation-morning',
  '0 6 * * *',
  $$
  SELECT
    net.http_post(
      concat(
        (current_setting('app.supabase_url')),
        '/functions/v1/scheduled-generation'
      ),
      jsonb_build_object(
        'editionType', 'Morning',
        'regions', ARRAY['us', 'global', 'colombia', 'venezuela', 'europe', 'asia'],
        'languages', ARRAY['en', 'es']
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      timeout_milliseconds := 300000
    ) AS request_id
  $$
);

-- ==================== MIDDAY EDITION (12:00 PM UTC) ====================
-- This runs every day at 12:00 PM (noon) UTC to pre-generate Midday editions
SELECT cron.schedule(
  'scheduled-generation-midday',
  '0 12 * * *',
  $$
  SELECT
    net.http_post(
      concat(
        (current_setting('app.supabase_url')),
        '/functions/v1/scheduled-generation'
      ),
      jsonb_build_object(
        'editionType', 'Midday',
        'regions', ARRAY['us', 'global', 'colombia', 'venezuela', 'europe', 'asia'],
        'languages', ARRAY['en', 'es']
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      timeout_milliseconds := 300000
    ) AS request_id
  $$
);

-- ==================== EVENING EDITION (6:00 PM UTC) ====================
-- This runs every day at 6:00 PM (18:00) UTC to pre-generate Evening editions
SELECT cron.schedule(
  'scheduled-generation-evening',
  '0 18 * * *',
  $$
  SELECT
    net.http_post(
      concat(
        (current_setting('app.supabase_url')),
        '/functions/v1/scheduled-generation'
      ),
      jsonb_build_object(
        'editionType', 'Evening',
        'regions', ARRAY['us', 'global', 'colombia', 'venezuela', 'europe', 'asia'],
        'languages', ARRAY['en', 'es']
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      timeout_milliseconds := 300000
    ) AS request_id
  $$
);

-- ==================== AUTO-RETRY (Every 2-5 minutes) ====================
-- This runs every 2-5 minutes to retry failed generations with exponential backoff
-- Run every 5 minutes (*/5) to cover the retry windows
SELECT cron.schedule(
  'auto-retry-generation',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      concat(
        (current_setting('app.supabase_url')),
        '/functions/v1/auto-retry-generation'
      ),
      '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      timeout_milliseconds := 120000
    ) AS request_id
  $$
);

-- ==================== VIEW SCHEDULED JOBS ====================
-- To see all scheduled jobs:
-- SELECT * FROM cron.job;

-- ==================== UNSCHEDULE JOBS (if needed) ====================
-- To unschedule any job:
-- SELECT cron.unschedule('scheduled-generation-morning');
-- SELECT cron.unschedule('scheduled-generation-midday');
-- SELECT cron.unschedule('scheduled-generation-evening');
-- SELECT cron.unschedule('auto-retry-generation');

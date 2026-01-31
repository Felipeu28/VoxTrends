-- Phase 4: Database Function for Content Expiration Cleanup
-- This function is called by the cron job daily at 1 AM UTC

CREATE OR REPLACE FUNCTION cleanup_expired_content()
RETURNS TABLE (
  free_deleted bigint,
  pro_deleted bigint,
  studio_deleted bigint,
  shares_deleted bigint,
  total_deleted bigint
) AS $$
DECLARE
  v_free_deleted bigint := 0;
  v_pro_deleted bigint := 0;
  v_studio_deleted bigint := 0;
  v_shares_deleted bigint := 0;
BEGIN
  -- Delete expired editions for Free tier (24 hours)
  DELETE FROM daily_editions
  WHERE id IN (
    SELECT edition_id FROM content_expiration_schedule
    WHERE tier = 'free'
      AND skip_deletion = false
      AND deleted_at IS NULL
      AND scheduled_deletion_at <= NOW()
  );
  GET DIAGNOSTICS v_free_deleted = ROW_COUNT;

  -- Delete expired editions for Pro tier (7 days)
  DELETE FROM daily_editions
  WHERE id IN (
    SELECT edition_id FROM content_expiration_schedule
    WHERE tier = 'pro'
      AND skip_deletion = false
      AND deleted_at IS NULL
      AND scheduled_deletion_at <= NOW()
  );
  GET DIAGNOSTICS v_pro_deleted = ROW_COUNT;

  -- Delete expired editions for Studio tier (30 days)
  DELETE FROM daily_editions
  WHERE id IN (
    SELECT edition_id FROM content_expiration_schedule
    WHERE tier = 'studio'
      AND skip_deletion = false
      AND deleted_at IS NULL
      AND scheduled_deletion_at <= NOW()
  );
  GET DIAGNOSTICS v_studio_deleted = ROW_COUNT;

  -- Mark deletions in expiration schedule
  UPDATE content_expiration_schedule
  SET deleted_at = NOW(), reason = 'expired'
  WHERE deleted_at IS NULL
    AND scheduled_deletion_at <= NOW();

  -- Delete expired share links (30 days)
  DELETE FROM shared_editions
  WHERE expires_at <= NOW();
  GET DIAGNOSTICS v_shares_deleted = ROW_COUNT;

  -- Log results
  INSERT INTO app_logs (level, service, action, metadata)
  VALUES (
    'INFO',
    'cleanup-expired-content',
    'daily_cleanup',
    jsonb_build_object(
      'free_deleted', v_free_deleted,
      'pro_deleted', v_pro_deleted,
      'studio_deleted', v_studio_deleted,
      'shares_deleted', v_shares_deleted,
      'total_deleted', v_free_deleted + v_pro_deleted + v_studio_deleted
    )
  );

  RETURN QUERY SELECT v_free_deleted, v_pro_deleted, v_studio_deleted, v_shares_deleted,
    (v_free_deleted + v_pro_deleted + v_studio_deleted);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_content() IS
'Daily cleanup of expired editions and share links
Called by pg_cron at 1 AM UTC
Deletes editions based on tier retention policy:
  - Free: 24 hours
  - Pro: 7 days
  - Studio: 30 days
Cleans up share links older than 30 days
Logs results to app_logs for monitoring';

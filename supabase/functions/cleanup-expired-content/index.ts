import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, supabaseKey);

// Retention periods in hours
const RETENTION_PERIODS = {
  free: 24,
  pro: 7 * 24,      // 7 days
  studio: 30 * 24,  // 30 days
};

Deno.serve(async (req: Request) => {
  try {
    // Verify this is called from internal cron or authorized source
    const authHeader = req.headers.get("Authorization");
    const serviceName = req.headers.get("X-Service-Name");

    if (!authHeader?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const now = new Date();
    const startTime = performance.now();
    const results = {
      free_deleted: 0,
      pro_deleted: 0,
      studio_deleted: 0,
      error_count: 0,
      errors: [] as string[],
    };

    // Process each tier's expiration schedule
    for (const [tier, hoursRetention] of Object.entries(RETENTION_PERIODS)) {
      const deleteBefore = new Date(
        now.getTime() - hoursRetention * 60 * 60 * 1000
      );

      try {
        // Find expired editions scheduled for deletion
        const { data: expiredRecords, error: selectError } = await supabase
          .from("content_expiration_schedule")
          .select("edition_id, user_id")
          .eq("tier", tier)
          .eq("skip_deletion", false)
          .eq("deleted_at", null)
          .lt("scheduled_deletion_at", deleteBefore.toISOString());

        if (selectError) throw selectError;

        if (!expiredRecords || expiredRecords.length === 0) {
          console.log(`No expired ${tier} editions found`);
          continue;
        }

        console.log(
          `Found ${expiredRecords.length} expired ${tier} editions to delete`
        );

        // Delete expired editions (ON DELETE CASCADE will handle shared links)
        const editionIds = expiredRecords.map((r) => r.edition_id);
        const { error: deleteError } = await supabase
          .from("daily_editions")
          .delete()
          .in("id", editionIds);

        if (deleteError) throw deleteError;

        // Mark as deleted in expiration schedule
        const { error: updateError } = await supabase
          .from("content_expiration_schedule")
          .update({
            deleted_at: now.toISOString(),
            reason: "expired",
          })
          .in("edition_id", editionIds);

        if (updateError) throw updateError;

        // Increment counter
        results[`${tier}_deleted` as keyof typeof results] =
          expiredRecords.length;

        console.log(
          `Successfully deleted ${expiredRecords.length} ${tier} editions`
        );
      } catch (error) {
        results.error_count++;
        const errorMsg = `${tier} tier error: ${error.message}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Clean up expired shared links (30 days)
    try {
      const { data: expiredShares, error: shareSelectError } = await supabase
        .from("shared_editions")
        .select("id")
        .lt("expires_at", now.toISOString());

      if (shareSelectError) throw shareSelectError;

      if (expiredShares && expiredShares.length > 0) {
        const shareIds = expiredShares.map((s) => s.id);
        const { error: shareDeleteError } = await supabase
          .from("shared_editions")
          .delete()
          .in("id", shareIds);

        if (shareDeleteError) throw shareDeleteError;

        console.log(`Cleaned up ${shareIds.length} expired share links`);
      }
    } catch (error) {
      results.error_count++;
      results.errors.push(`Share cleanup error: ${error.message}`);
      console.error(`Share cleanup error: ${error.message}`);
    }

    const duration = performance.now() - startTime;

    const response = {
      ...results,
      duration_ms: Math.round(duration),
      timestamp: now.toISOString(),
    };

    console.log(JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cleanup function error:", error.message);
    return new Response(
      JSON.stringify({
        error: "Cleanup function failed",
        message: error.message,
      }),
      {
        status: 500,
      }
    );
  }
});

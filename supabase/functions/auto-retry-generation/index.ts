import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== CORS ====================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function handleCors(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
}

// ==================== CONFIGURATION ====================
const GENERATE_EDITION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-edition`;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [2, 5, 10]; // Backoff: 2min, 5min, 10min

// ==================== HELPERS ====================
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

async function generateEdition(
  editionType: string,
  region: string,
  language: string,
  serviceRoleKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(GENERATE_EDITION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        editionType,
        region,
        language,
        forceRefresh: false,
        voiceId: 'originals',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`HTTP ${response.status}: ${error.error || 'Unknown error'}`);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

// ==================== MAIN HANDLER ====================
async function handleAutoRetry(req: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    console.log('\n🔄 ===== AUTO-RETRY GENERATION =====');
    console.log(`⏰ Started at: ${new Date().toISOString()}`);

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch failed generations due for retry
    const now = new Date();
    const { data: failedGenerations, error: fetchError } = await supabaseClient
      .from('failed_generations')
      .select('*')
      .eq('is_resolved', false)
      .lte('next_retry_at', now.toISOString())
      .lt('retry_count', MAX_RETRIES)
      .order('retry_count', { ascending: true })
      .limit(50); // Process max 50 failed generations per run

    if (fetchError) {
      throw new Error(`Failed to fetch failed generations: ${fetchError.message}`);
    }

    if (!failedGenerations || failedGenerations.length === 0) {
      console.log('✅ No failed generations due for retry');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No failed generations to retry',
          retryCount: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`📋 Found ${failedGenerations.length} failed generations to retry`);

    // Retry each failed generation
    let retrySuccessCount = 0;
    let retryFailureCount = 0;
    const retryResults: any[] = [];

    for (const failed of failedGenerations) {
      console.log(
        `🔄 Retrying [${failed.edition_type}] ${failed.region}/${failed.language} (attempt ${failed.retry_count + 1}/${MAX_RETRIES})`
      );

      const result = await generateEdition(
        failed.edition_type,
        failed.region,
        failed.language,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      if (result.success) {
        console.log(
          `✅ [${failed.edition_type}] ${failed.region}/${failed.language} retry succeeded`
        );

        // Mark as resolved
        await supabaseClient
          .from('failed_generations')
          .update({
            is_resolved: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', failed.id);

        retrySuccessCount++;
        retryResults.push({
          editionType: failed.edition_type,
          region: failed.region,
          language: failed.language,
          status: 'recovered',
          attempts: failed.retry_count + 1,
        });
      } else {
        console.log(
          `❌ [${failed.edition_type}] ${failed.region}/${failed.language} retry failed: ${result.error}`
        );

        const newRetryCount = failed.retry_count + 1;

        if (newRetryCount >= MAX_RETRIES) {
          // Max retries exceeded, mark as unresolvable
          console.warn(
            `⚠️ Max retries (${MAX_RETRIES}) exceeded for [${failed.edition_type}] ${failed.region}/${failed.language}`
          );

          await supabaseClient
            .from('failed_generations')
            .update({
              retry_count: newRetryCount,
              is_resolved: false, // Keep for manual intervention
              error_message: `Max retries exceeded: ${result.error}`,
              last_retry_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', failed.id);
        } else {
          // Schedule next retry with exponential backoff
          const backoffMinutes = RETRY_BACKOFF_MINUTES[newRetryCount - 1] || 10;
          const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

          await supabaseClient
            .from('failed_generations')
            .update({
              retry_count: newRetryCount,
              error_message: result.error,
              last_retry_at: new Date().toISOString(),
              next_retry_at: nextRetryAt.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', failed.id);

          console.log(
            `⏰ Next retry scheduled in ${backoffMinutes} minutes at ${nextRetryAt.toISOString()}`
          );
        }

        retryFailureCount++;
        retryResults.push({
          editionType: failed.edition_type,
          region: failed.region,
          language: failed.language,
          status: 'retry_failed',
          attempts: failed.retry_count + 1,
          nextRetryIn: failed.retry_count + 1 >= MAX_RETRIES ? 'none' : `${RETRY_BACKOFF_MINUTES[newRetryCount - 1] || 10} min`,
        });
      }
    }

    const completionTime = Date.now() - startTime;

    console.log(`\n📊 ===== AUTO-RETRY COMPLETE =====`);
    console.log(`✅ Recovered: ${retrySuccessCount}`);
    console.log(`❌ Still failing: ${retryFailureCount}`);
    console.log(`⏱️ Duration: ${completionTime}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        retryCount: failedGenerations.length,
        successCount: retrySuccessCount,
        failureCount: retryFailureCount,
        completionTimeMs: completionTime,
        results: retryResults,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Auto-retry error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

// ==================== SERVER ====================
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method === 'POST') {
    return handleAutoRetry(req);
  }

  return new Response('Method not allowed', {
    status: 405,
    headers: corsHeaders,
  });
});

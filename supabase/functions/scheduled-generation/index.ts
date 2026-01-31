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
const REGIONS = ['us', 'uk', 'eu', 'asia'];
const LANGUAGES = ['en', 'es', 'fr', 'de'];
const EDITIONS = ['Morning', 'Midday', 'Evening'];
const GENERATE_EDITION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-edition`;

// ==================== HELPERS ====================
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

async function generateEdition(
  supabaseClient: any,
  editionType: string,
  region: string,
  language: string,
  serviceRoleKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`📢 [${editionType}] Generating for ${region}/${language}...`);

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

    console.log(`✅ [${editionType}] ${region}/${language} generated successfully`);
    return { success: true };
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`❌ [${editionType}] ${region}/${language} failed: ${errorMsg}`);

    // Record failed generation for auto-retry
    try {
      await supabaseClient
        .from('failed_generations')
        .upsert(
          {
            edition_type: editionType,
            region,
            language,
            generation_date: getTodayDate(),
            error_message: errorMsg,
            retry_count: 0,
            next_retry_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // Retry in 2 minutes
            is_resolved: false,
          },
          {
            onConflict: 'edition_type,region,language,generation_date',
          }
        );
    } catch (recordError) {
      console.warn(`⚠️ Failed to record failed generation: ${recordError}`);
    }

    return { success: false, error: errorMsg };
  }
}

// ==================== MAIN HANDLER ====================
async function handleScheduledGeneration(req: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { editionType, regions, languages } = body;

    if (!editionType) {
      return new Response(
        JSON.stringify({
          error: 'Missing editionType parameter',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`\n📅 ===== SCHEDULED GENERATION: ${editionType} =====`);
    console.log(`📍 Regions: ${regions.join(', ')}`);
    console.log(`🌐 Languages: ${languages.join(', ')}`);

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create scheduled log entry
    const logId = crypto.randomUUID();
    const totalCombinations = regions.length * languages.length;

    await supabaseClient
      .from('scheduled_generation_logs')
      .insert({
        id: logId,
        edition_type: editionType,
        regions,
        languages,
        scheduled_time: new Date().toISOString(),
        started_at: new Date().toISOString(),
        status: 'running',
        total_combinations: totalCombinations,
      });

    console.log(`📊 Starting generation for ${totalCombinations} region/language combinations...`);

    // Generate all combinations
    let successCount = 0;
    let errorCount = 0;
    const results: any[] = [];

    for (const region of regions) {
      for (const language of languages) {
        const result = await generateEdition(
          supabaseClient,
          editionType,
          region,
          language,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        if (result.success) {
          successCount++;
          results.push({ region, language, status: 'success' });
        } else {
          errorCount++;
          results.push({ region, language, status: 'failed', error: result.error });
        }
      }
    }

    // Update scheduled log with results
    const completionTime = Date.now() - startTime;
    await supabaseClient
      .from('scheduled_generation_logs')
      .update({
        completed_at: new Date().toISOString(),
        status: errorCount === 0 ? 'success' : 'failed',
        success_count: successCount,
        error_count: errorCount,
        metadata: {
          completionTimeMs: completionTime,
          successRate: `${Math.round((successCount / totalCombinations) * 100)}%`,
        },
      })
      .eq('id', logId);

    console.log(`\n📊 ===== GENERATION COMPLETE =====`);
    console.log(`✅ Success: ${successCount}/${totalCombinations}`);
    console.log(`❌ Errors: ${errorCount}/${totalCombinations}`);
    console.log(`⏱️ Duration: ${completionTime}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        editionType,
        totalCombinations,
        successCount,
        errorCount,
        completionTimeMs: completionTime,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Scheduled generation error:', error);

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
    return handleScheduledGeneration(req);
  }

  return new Response('Method not allowed', {
    status: 405,
    headers: corsHeaders,
  });
});

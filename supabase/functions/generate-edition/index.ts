import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../shared/cors.ts';   // <--- Changed to 'shared'
import { getPlanLimits } from '../shared/limits.ts'; // <--- Changed to 'shared'
import { GeminiService } from '../shared/gemini.ts'; // <--- Changed to 'shared'

console.log('Generate Edition Function Started');

serve(async (req) => {
  // 1. Handle CORS Preflight Request explicitly (Fixes the CORS Error)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { editionType, region, language } = await req.json();
    
    console.log('Request:', { editionType, region, language });

    // Validate inputs
    if (!editionType || !region || !language) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: editionType, region, language' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('User authenticated:', user.id);

    // Get user profile
    const { data: profile, error: profileError } = await supabaseClient
      .from('users')
      .select('plan')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Profile error:', profileError);
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userPlan = profile.plan || 'Free';
    const limits = getPlanLimits(userPlan);

    console.log('User plan:', userPlan, 'Limits:', limits);

    // Check region/language restrictions for free users
    if (userPlan === 'Free') {
      if (!limits.allowedRegions.includes(region)) {
        return new Response(
          JSON.stringify({ 
            error: 'Region not allowed on Free plan',
            upgrade: true,
            message: `Free users can only access ${limits.allowedRegions.join(', ')}. Upgrade to Pro for all regions.`
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!limits.allowedLanguages.includes(language)) {
        return new Response(
          JSON.stringify({ 
            error: 'Language not allowed on Free plan',
            upgrade: true,
            message: `Free users can only access ${limits.allowedLanguages.join(', ')}. Upgrade to Pro for all languages.`
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Get today's usage
    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabaseClient
      .from('daily_usage')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    const editionsUsed = usage?.editions_count || 0;

    console.log('Editions used today:', editionsUsed, 'Limit:', limits.dailyEditions);

    // Check daily limit
    if (editionsUsed >= limits.dailyEditions) {
      return new Response(
        JSON.stringify({ 
          error: 'Daily edition limit reached',
          upgrade: true,
          limit: limits.dailyEditions,
          used: editionsUsed,
          message: `You've used all ${limits.dailyEditions} editions for today. Upgrade to Pro for unlimited editions.`
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for cached edition
    const { data: cachedEdition } = await supabaseClient
      .from('daily_editions')
      .select('*')
      .eq('edition_type', editionType)
      .eq('region', region)
      .eq('language', language)
      .eq('date', today)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cachedEdition) {
      console.log('Found cached edition');
      
      // Don't increment usage for cache hits
      await supabaseClient.from('usage_analytics').insert({
        user_id: user.id,
        action_type: 'cache_hit',
        metadata: { editionType, region, language },
        cost_estimate: 0,
      });

      return new Response(
        JSON.stringify({
          cached: true,
          data: {
            text: cachedEdition.content,
            script: cachedEdition.script,
            audio: cachedEdition.audio_url,
            imageUrl: cachedEdition.image_url,
            links: cachedEdition.grounding_links || [],
            flashSummary: cachedEdition.flash_summary,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('No cache found, generating new edition...');

    // Generate new edition
    const gemini = new GeminiService(Deno.env.get('GEMINI_API_KEY') ?? '');

    console.log('Fetching trending news...');
    const { text, grounding } = await gemini.fetchTrendingNews(region, language);

    console.log('Generating script...');
    const script = await gemini.generatePodcastScript(text, language);

    console.log('Generating audio and image...');
    const [audioBase64, imageUrl, flashSummary] = await Promise.all([
      gemini.generateAudio(script),
      gemini.generateCoverArt(`${editionType} News ${region}`),
      gemini.generateFlashSummary(text, language),
    ]);

    console.log('Generation complete');

    // Cache the edition
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6);

    await supabaseClient.from('daily_editions').insert({
      edition_type: editionType,
      region,
      language,
      date: today,
      content: text,
      script,
      audio_url: audioBase64,
      image_url: imageUrl,
      grounding_links: grounding,
      flash_summary: flashSummary,
      expires_at: expiresAt.toISOString(),
    });

    console.log('Edition cached');

    // Increment usage
    await supabaseClient.rpc('increment_daily_usage', {
      p_user_id: user.id,
      p_action: 'edition',
    });

    console.log('Usage incremented');

    // Log analytics
    await supabaseClient.from('usage_analytics').insert({
      user_id: user.id,
      action_type: 'generate_edition',
      metadata: { editionType, region, language },
      cost_estimate: 0.10,
    });

    console.log('Analytics logged');

    return new Response(
      JSON.stringify({
        cached: false,
        data: {
          text,
          script,
          audio: audioBase64,
          imageUrl,
          links: grounding,
          flashSummary,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai';

// --- 1. INLINED SHARED DEPENDENCIES (Fixes Import Crashes) ---

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLAN_LIMITS = {
  Free: { dailyEditions: 3, allowedRegions: ['Global'], allowedLanguages: ['English'] },
  Pro: { dailyEditions: 999, allowedRegions: 'all', allowedLanguages: 'all' }
};

// --- 2. MAIN FUNCTION ---

console.log('Generate Edition Function Started');

serve(async (req) => {
  // Handle CORS Preflight immediately
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { editionType, region, language } = await req.json();
    
    // --- VALIDATION & AUTH ---
    if (!editionType || !region || !language) throw new Error('Missing required fields');

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('Server Config Error: Missing GEMINI_API_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    // --- CHECK LIMITS & PLAN ---
    const { data: profile } = await supabaseClient
      .from('users')
      .select('plan')
      .eq('id', user.id)
      .single();

    const userPlan = profile?.plan || 'Free';
    // @ts-ignore
    const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.Free;

    // Region/Language Check for Free users
    if (userPlan === 'Free') {
      if (!limits.allowedRegions.includes(region)) {
        return new Response(JSON.stringify({ 
          error: 'Region restricted', upgrade: true, 
          message: `Free users can only access ${limits.allowedRegions.join(', ')}.` 
        }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!limits.allowedLanguages.includes(language)) {
        return new Response(JSON.stringify({ 
          error: 'Language restricted', upgrade: true, 
          message: `Free users can only access ${limits.allowedLanguages.join(', ')}.` 
        }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // --- CHECK DAILY USAGE (DB) ---
    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabaseClient
      .from('daily_usage')
      .select('editions_count')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    const editionsUsed = usage?.editions_count || 0;

    if (editionsUsed >= limits.dailyEditions) {
      return new Response(JSON.stringify({ 
        error: 'Daily limit reached', upgrade: true, 
        message: 'Upgrade to Pro for unlimited editions.' 
      }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- CHECK CACHE (DB) ---
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
      // Log cache hit analytics
      await supabaseClient.from('usage_analytics').insert({
        user_id: user.id, action_type: 'cache_hit', metadata: { editionType, region }
      });

      return new Response(JSON.stringify({
        cached: true,
        data: {
          text: cachedEdition.content,
          script: cachedEdition.script,
          audio: cachedEdition.audio_url,
          imageUrl: cachedEdition.image_url,
          links: cachedEdition.grounding_links || [],
          flashSummary: cachedEdition.flash_summary,
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- GENERATE CONTENT (GEMINI) ---
    console.log('Generating fresh content...');
    const genAI = new GoogleGenAI({ apiKey });
    const model = genAI.models;

    // 1. News
    const newsRes = await model.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Research top 5 trending news in ${region} in ${language}. Focus on social velocity.`,
      config: { tools: [{ googleSearch: {} }] },
    });
    const text = newsRes.text || "No news found.";

    // 2. Script
    const scriptRes = await model.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Create a 30s podcast script for: ${text}. Hosts: Joe and Jane. Language: ${language}. Output only the script.`,
    });
    const script = scriptRes.text || "";

    // 3. Audio & Image (Placeholder for robustness, replace with real models if available)
    // Note: To prevent crashes if these models are preview-only, we use try/catch blocks
    let audioBase64 = null;
    let imageUrl = null;
    let flashSummary = "";

    try {
        const summaryRes = await model.generateContent({
            model: 'gemini-2.0-flash',
            contents: `3 bullet summary of: ${text}. Language: ${language}.`
        });
        flashSummary = summaryRes.text || "";
    } catch (e) { console.error("Summary failed", e); }

    // --- SAVE TO DB ---
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6);

    await supabaseClient.from('daily_editions').insert({
      edition_type: editionType, region, language, date: today,
      content: text, script, audio_url: audioBase64, image_url: imageUrl,
      flash_summary: flashSummary, expires_at: expiresAt.toISOString(),
      grounding_links: []
    });

    // Increment Usage
    await supabaseClient.rpc('increment_daily_usage', { p_user_id: user.id, p_action: 'edition' });
    
    // Log Analytics
    await supabaseClient.from('usage_analytics').insert({
       user_id: user.id, action_type: 'generate_edition', metadata: { editionType, region }
    });

    return new Response(JSON.stringify({
      cached: false,
      data: { text, script, audio: audioBase64, imageUrl, links: [], flashSummary }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

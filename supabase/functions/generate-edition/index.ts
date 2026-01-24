
// supabase/functions/generate-edition/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1.35.0';

serve(async (req) => {
  try {
    // 1. Parse request
    const { editionType, region, language } = await req.json();
    
    // 2. Get user from JWT
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw new Error('Unauthorized');
    
    // 3. Check daily limit
    const { data: profile } = await supabase
      .from('users')
      .select('plan')
      .eq('id', user.id)
      .single();
    
    const { data: usage } = await supabase
      .from('daily_usage')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', new Date().toISOString().split('T')[0])
      .single();
    
    const limits = profile.plan === 'Pro' ? { editions: 999 } : { editions: 3 };
    
    if (usage && usage.editions_count >= limits.editions) {
      return new Response(
        JSON.stringify({ error: 'Daily limit reached', limit: limits.editions }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 4. Check if edition cached
    const { data: cached } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_type', editionType)
      .eq('region', region)
      .eq('language', language)
      .eq('date', new Date().toISOString().split('T')[0])
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (cached) {
      // Don't increment usage for cached hits
      return new Response(JSON.stringify({ 
        cached: true, 
        data: cached 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 5. Generate new edition
    const gemini = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });
    
    // ... (your existing generation logic)
    const { text, grounding } = await fetchTrendingNews(gemini, region, language);
    const script = await generatePodcastScript(gemini, text, language);
    const audio = await generateAudio(gemini, script);
    const image = await generateCoverArt(gemini, `${editionType} ${region}`);
    
    // 6. Cache the edition
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6);
    
    await supabase.from('daily_editions').insert({
      edition_type: editionType,
      region,
      language,
      date: new Date().toISOString().split('T')[0],
      content: text,
      script,
      audio_url: audio, // base64 or uploaded to storage
      image_url: image,
      grounding_links: grounding,
      expires_at: expiresAt.toISOString(),
    });
    
    // 7. Increment usage
    await supabase.rpc('increment_daily_usage', {
      p_user_id: user.id,
      p_action: 'edition',
    });
    
    // 8. Log analytics
    await supabase.from('usage_analytics').insert({
      user_id: user.id,
      action_type: 'generate_edition',
      metadata: { editionType, region, language },
      cost_estimate: 0.10,
    });
    
    return new Response(JSON.stringify({
      cached: false,
      data: { text, script, audio, image, grounding }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

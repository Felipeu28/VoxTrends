import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai';

// ==================== CORS ====================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function handleCors(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
}

// ==================== PLAN LIMITS ====================
const PLAN_LIMITS = {
  Free: {
    dailyEditions: 3,
    dailyResearch: 2,
    vaultSize: 10,
    chatMessagesPerEdition: 10,
    allowedRegions: ['Global'],
    allowedLanguages: ['English'],
    audioQuality: '24khz',
    pdfExport: false,
    priorityQueue: false,
  },
  Pro: {
    dailyEditions: 999,
    dailyResearch: 999,
    vaultSize: 999,
    chatMessagesPerEdition: 999,
    allowedRegions: 'all',
    allowedLanguages: 'all',
    audioQuality: '48khz',
    pdfExport: true,
    priorityQueue: true,
  },
} as const;

type Plan = keyof typeof PLAN_LIMITS;

function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as Plan] || PLAN_LIMITS.Free;
}

// ==================== GEMINI SERVICE ====================
class GeminiService {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async fetchTrendingNews(region: string, language: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Research the top 5 trending news topics on X (Twitter) for: ${region}.
        Focus on real-time social velocity. Language: ${language}.
        Provide verified facts and specific details for a podcast summary.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text || 'No trending intelligence found.';
      const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        uri: chunk.web?.uri,
        title: chunk.web?.title,
      })).filter((c: any) => c.uri) || [];

      return { text, grounding };
    } catch (error) {
      console.error('Gemini Search Error:', error);
      throw new Error('Intelligence feed unreachable. Retrying...');
    }
  }

  async generatePodcastScript(trends: string, language: string, duration: string = '1 minute') {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Showrunner: 'VoxTrends'. Create a ${duration} podcast briefing for these trends: ${trends}.
        Language: ${language}.

        Hosts:
        - Joe: High-energy, charismatic main host.
        - Jane: Intelligent, analytical research expert.

        Format:
        Joe: [Welcome and hook]
        Jane: [Detailed analysis of trends]
        Joe: [Closing and sign-off]

        Output only the script text.`,
        config: { temperature: 0.8 },
      });
      return response.text;
    } catch (error) {
      console.error('Script Gen Error:', error);
      throw error;
    }
  }

  async generateAudio(script: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
              ],
            },
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (error) {
      console.error('TTS Synthesis Error:', error);
      return null;
    }
  }

  async generateCoverArt(topic: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `Futuristic podcast cover art for: ${topic}. Dark violet and cinematic lighting.` }],
        },
        config: {
          imageConfig: { aspectRatio: '16:9' },
        },
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
      }
    } catch (error) {
      console.error('Image Gen Error:', error);
    }
    return null;
  }

  async generateFlashSummary(text: string, language: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `3 punchy bullet points summary of: ${text}. Language: ${language}.`,
      });
      return response.text;
    } catch (error) {
      console.error('Summary Gen Error:', error);
      return '';
    }
  }
}

// ==================== MAIN FUNCTION ====================
console.log('Generate Edition Function Started');

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Parse request body
    const { editionType, region, language } = await req.json();

    console.log('Edition request:', { editionType, region, language });

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

    // Create Supabase client with Authorization header
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', code: 401, message: 'Invalid JWT' }),
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

    // Get today's usage
    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabaseClient
      .from('daily_usage')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    const editionsUsed = usage?.edition_count || 0;

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

    // Check for cached edition first
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
      console.log('Returning cached edition');

      // Still increment usage for cached editions
      await supabaseClient.rpc('increment_daily_usage', {
        p_user_id: user.id,
        p_action: 'edition',
      });

      return new Response(
        JSON.stringify({
          data: {
            text: cachedEdition.content,
            script: cachedEdition.script,
            audio: cachedEdition.audio_url,
            imageUrl: cachedEdition.image_url,
            links: cachedEdition.grounding_links,
            flashSummary: cachedEdition.flash_summary,
            cached: true,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating new edition...');

    // Initialize Gemini service
    const gemini = new GeminiService(Deno.env.get('GEMINI_API_KEY') ?? '');

    // Step 1: Fetch trending news
    console.log('Fetching trending news...');
    const { text: trendingNews, grounding: groundingLinks } = await gemini.fetchTrendingNews(region, language);
    console.log('Trending news fetched');

    // Step 2: Generate podcast script
    console.log('Generating podcast script...');
    const script = await gemini.generatePodcastScript(trendingNews, language, '2 minutes');
    console.log('Script generated');

    // Step 3: Generate audio (TTS)
    console.log('Generating audio...');
    const audioBase64 = await gemini.generateAudio(script || '');
    const audioUrl = audioBase64 ? `data:audio/mp3;base64,${audioBase64}` : null;
    console.log('Audio generated:', audioUrl ? 'success' : 'failed');

    // Step 4: Generate cover art
    console.log('Generating cover art...');
    const firstTopic = trendingNews.split('\n')[0] || 'Daily News';
    const imageUrl = await gemini.generateCoverArt(firstTopic);
    console.log('Cover art generated:', imageUrl ? 'success' : 'failed');

    // Step 5: Generate flash summary
    console.log('Generating flash summary...');
    const flashSummary = await gemini.generateFlashSummary(trendingNews, language);
    console.log('Flash summary generated');

    // Cache the edition
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6);

    await supabaseClient
      .from('daily_editions')
      .upsert({
        edition_type: editionType,
        region,
        language,
        date: today,
        content: trendingNews,
        script: script || '',
        audio_url: audioUrl,
        image_url: imageUrl,
        grounding_links: groundingLinks,
        flash_summary: flashSummary,
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: 'edition_type,region,language,date'
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
      cost_estimate: 0.15,
    });

    console.log('Analytics logged');

    return new Response(
      JSON.stringify({
        data: {
          text: trendingNews,
          script: script || '',
          audio: audioUrl,
          imageUrl,
          links: groundingLinks,
          flashSummary,
          cached: false,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai';

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

// Helper: Create WAV header for PCM audio (24kHz, 16-bit, mono)
function createWavHeader(pcmLength: number): Uint8Array {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmLength;
  const fileSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, fileSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // audio format (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  return new Uint8Array(buffer);
}

// Helper: Convert base64 PCM to base64 WAV
function pcmToWav(pcmBase64: string): string {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  const wavHeader = createWavHeader(pcmBytes.length);
  const wavBytes = new Uint8Array(wavHeader.length + pcmBytes.length);
  wavBytes.set(wavHeader, 0);
  wavBytes.set(pcmBytes, wavHeader.length);

  // Convert to base64
  let binary = '';
  for (let i = 0; i < wavBytes.length; i++) {
    binary += String.fromCharCode(wavBytes[i]);
  }
  return btoa(binary);
}

class GeminiService {
  private ai: GoogleGenAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.apiKey = apiKey;
  }

  async fetchTrendingNews(region: string, language: string) {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{
          role: 'user', parts: [{
            text: `Research the top 5 trending news topics on X (Twitter) for: ${region}.
        Focus on real-time social velocity. Language: ${language}.
        Provide verified facts and specific details for a podcast summary.
        Do not use emojis or markdown bolding in the output.` }]
        }],
        config: {
          tools: [{ googleSearch: {} }],
        }
      });

      const text = response.text?.replace(/[*#]/g, '') || '';
      const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        uri: chunk.web?.uri,
        title: chunk.web?.title,
      })).filter((c: any) => c.uri) || [];

      return { text, grounding };
    } catch (error: any) {
      console.error('Gemini Search Error:', error);
      throw new Error(`Intelligence feed error: ${error.message || error}`);
    }
  }

  async generatePodcastScript(trends: string, language: string, duration: string = '1 minute') {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{
          role: 'user', parts: [{
            text: `Showrunner: 'VoxTrends'. Create a ${duration} podcast briefing for these trends: ${trends}.
        Language: ${language}.

        Hosts:
        - Joe: High-energy, charismatic main host.
        - Jane: Intelligent, analytical research expert.

        Format:
        Joe: [Welcome and hook]
        Jane: [Detailed analysis of trends]
        Joe: [Closing and sign-off]

        Output only the script text. Do not use emojis.` }]
        }],
        config: {
          generationConfig: { temperature: 0.8 },
        }
      });
      return response.text || '';
    } catch (error) {
      console.error('Script Gen Error:', error);
      throw error;
    }
  }

  async generateAudio(script: string): Promise<{ data: string | null; error?: string }> {
    try {
      console.log('Starting TTS generation...');
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
              ]
            }
          }
        }
      });

      // Extract PCM audio from response
      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioData) {
        console.error('Gemini TTS returned empty audioContent');
        return { data: null, error: 'Gemini TTS returned empty audioContent' };
      }

      console.log('TTS returned audio data, converting PCM to WAV...');
      // Convert PCM to WAV for browser playback
      const wavBase64 = pcmToWav(audioData);
      console.log('WAV conversion complete');

      return { data: wavBase64 };
    } catch (error: any) {
      console.error('Gemini TTS Synthesis Error:', error);
      return { data: null, error: `Synthesis Error: ${error.message}` };
    }
  }

  async generateCoverArt(topic: string): Promise<string | null> {
    try {
      console.log('Generating cover art with Imagen...');
      const response = await this.ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: `Professional podcast cover art for news topic: "${topic}". Modern, sleek, dark theme with purple accents. High quality, abstract visualization.`,
        config: {
          numberOfImages: 1,
        }
      });

      const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (!imageBytes) {
        console.error('Imagen returned no image');
        return null;
      }

      console.log('Cover art generated successfully');
      return `data:image/png;base64,${imageBytes}`;
    } catch (error: any) {
      console.error('Imagen Error:', error);
      return null;
    }
  }

  async generateFlashSummary(text: string, language: string) {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{ role: 'user', parts: [{ text: `3 punchy bullet points summary of: ${text}. Language: ${language}. Do not use emojis.` }] }]
      });
      return response.text || '';
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
    // Check if the request body is valid JSON
    let body;
    try {
      body = await req.json();
    } catch (e) {
      console.error('Invalid JSON body:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { editionType, region, language } = body;

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
      {
        global: { headers: { Authorization: authHeader } },
        auth: {
          persistSession: false,
        }
      }
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

    // Step 1: Fetch trending news (REQUIRED)
    console.log('Fetching trending news...');
    const { text: trendingNews, grounding: groundingLinks } = await gemini.fetchTrendingNews(region, language);
    console.log('Trending news fetched');

    // Step 2: Generate flash summary (lightweight, do first)
    console.log('Generating flash summary...');
    let flashSummary = '';
    try {
      flashSummary = await gemini.generateFlashSummary(trendingNews, language);
      console.log('Flash summary generated');
    } catch (e) {
      console.error('Flash summary failed (non-critical):', e);
    }

    // Step 3: Generate podcast script (shorter = less TTS load)
    console.log('Generating podcast script...');
    let script = '';
    try {
      script = await gemini.generatePodcastScript(trendingNews, language, '30 seconds');
      console.log('Script generated');
    } catch (e) {
      console.error('Script generation failed (non-critical):', e);
    }

    // Step 4: Generate audio (OPTIONAL - graceful degradation)
    let audioUrl: string | null = null;
    let audioError: string | undefined;
    if (script) {
      console.log('Generating audio...');
      try {
        const audioResult = await gemini.generateAudio(script);
        audioUrl = audioResult.data ? `data:audio/wav;base64,${audioResult.data}` : null;
        audioError = audioResult.error;
        console.log('Audio generated:', audioUrl ? 'success' : 'failed', audioError ? `Error: ${audioError}` : '');
      } catch (e: any) {
        console.error('Audio generation failed (non-critical):', e);
        audioError = e.message;
      }
    }

    // Step 5: Generate cover art (OPTIONAL - skip to save resources)
    // Commenting out image generation to reduce resource usage
    const imageUrl: string | null = null;
    console.log('Skipping cover art generation to save resources');
    /*
    const firstTopic = trendingNews.split('\n')[0] || 'Daily News';
    try {
      imageUrl = await gemini.generateCoverArt(firstTopic);
      console.log('Cover art generated:', imageUrl ? 'success' : 'skipped');
    } catch (e) {
      console.error('Cover art failed (non-critical):', e);
    }
    */

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
      metadata: { editionType, region, language, audioError },
      cost_estimate: 0.15,
    });

    console.log('Analytics logged');

    return new Response(
      JSON.stringify({
        data: {
          text: trendingNews,
          script: script || '',
          audio: audioUrl,
          audioError, // Return the error to the client
          imageUrl,
          links: groundingLinks,
          flashSummary,
          cached: false,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } }
    );

  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

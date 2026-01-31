import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1.38.0';

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

// ==================== VOICE PROFILES ====================
const VOICE_PROFILES = {
  'originals': {
    hosts: { lead: 'Joe', expert: 'Jane' },
    voices: { lead: 'Puck', expert: 'Kore' },
    label: 'The Originals'
  },
  'deep-divers': {
    hosts: { lead: 'David', expert: 'Sarah' },
    voices: { lead: 'Charon', expert: 'Aoede' },
    label: 'The Deep-Divers'
  },
  'trendspotters': {
    hosts: { lead: 'Leo', expert: 'Maya' },
    voices: { lead: 'Fenrir', expert: 'Kore' },
    label: 'The Trendspotters'
  }
} as const;

type VoiceId = keyof typeof VOICE_PROFILES;

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
  const pcmBytes = Uint8Array.from(atob(pcmBase64), (c) => c.charCodeAt(0));
  const wavHeader = createWavHeader(pcmBytes.length);
  const wavBytes = new Uint8Array(wavHeader.length + pcmBytes.length);
  wavBytes.set(wavHeader, 0);
  wavBytes.set(pcmBytes, wavHeader.length);

  // Memory-efficient Uint8Array to Base64
  const chunks: string[] = [];
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < wavBytes.length; i += chunkSize) {
    const chunk = wavBytes.subarray(i, Math.min(i + chunkSize, wavBytes.length));
    // @ts-ignore: String.fromCharCode.apply is faster than a manual loop
    chunks.push(String.fromCharCode.apply(null, chunk));
  }
  return btoa(chunks.join(''));
}

class GeminiService {
  private ai: GoogleGenAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.apiKey = apiKey;
  }

  async fetchTrendingNews(region: string, language: string, editionType: string = 'Daily') {
    try {
      let timeFocus = "the last 24 hours";
      let thematicFocus = "";

      if (editionType === 'Morning') {
        timeFocus = "overnight and the very start of today";
        thematicFocus = "Focus on what happened while the region was sleeping and the key stories setting the agenda for today.";
      } else if (editionType === 'Midday') {
        timeFocus = "this morning and unfolding live events";
        thematicFocus = "Focus on how stories have developed since the morning and live breaking news from the last few hours.";
      } else if (editionType === 'Evening') {
        timeFocus = "the full day's cycle and closing events";
        thematicFocus = "Focus on the final outcomes of today's big stories and what is trending as the day comes to a close.";
      }

      console.log(`Generating detailed ${editionType} news briefing for ${region} in ${language}...`);
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{
          role: 'user', parts: [{
            text: `[STRICT INSTRUCTION: DO NOT INCLUDE ANY INTRODUCTORY TEXT OR FILLER. START IMMEDIATELY WITH THE FIRST TOPIC.]
        
        You are an expert news analyst and investigative journalist. 
        Research the top 5 most significant news topics and trending stories from ${timeFocus} in ${region}.
        ${thematicFocus}
        
        For EACH of the top 5 topics, you MUST provide a comprehensive and detailed report.
        
        CRITICAL CONSTRAINTS:
        - NEVER use numbered lists.
        - Use 3-4 LONG paragraphs with deep context and analysis for EACH topic.
        - Describe why it is trending and the atmosphere of the social conversation.
        - Include specific data, names, background history, and different societal perspectives.
        - DO NOT include ANY introductory text, acknowledging filler, or meta-talk (e.g., "Okay, I will investigate...", "Based on my research...", "Here are the top stories...").
        - START DIRECTLY with the first news report.
        
        Format the output as a high-quality journalistic deep-dive in ${language}.
        You MAY use simple markdown like headers (#) and bolding (**) for readability.
        DO NOT use emojis.
        Be extremely informative. Focus on qualitative density. We need high-quality content for a 2-minute podcast.` }]
        }],
        config: {
          tools: [{ googleSearch: {} }],
        }
      });

      // SDK native response.text() is robust when tools are used
      const text = response.text || '';
      console.log(`Fetched news briefing, length: ${text.length} characters`);
      if (!text) {
        console.warn('Gemini returned empty text for news briefing.');
        return { text: `Trending News Briefing for ${region}: [Content generation failed or returned empty]`, grounding: [] };
      }

      const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        uri: chunk.web?.uri,
        title: chunk.web?.title,
      })).filter((c: any) => c.uri) || [];

      return { text, grounding };
    } catch (error: any) {
      console.error('Gemini Search Error:', error);
      return { text: `Trending News Briefing for ${region}: [Detailed content unavailable due to technical error]`, grounding: [] };
    }
  }

  async generatePodcastScript(trends: string, language: string, duration: string = '1:30', hostLead: string = 'Joe', hostExpert: string = 'Jane') {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{
          role: 'user', parts: [{
            text: `Showrunner: 'VoxTrends'. Create a ${duration} podcast briefing for these trends: ${trends}.
        Language: ${language}.

        Hosts:
        - ${hostLead}: High-energy, charismatic main host.
        - ${hostExpert}: Intelligent, analytical research expert.

        Format:
        ${hostLead}: [Welcome and hook]
        ${hostExpert}: [Detailed analysis of trends]
        ${hostLead}: [Closing and sign-off]

        Output only the script text. Do not use emojis.` }]
        }],
        config: {
          generationConfig: { temperature: 0.8 },
        }
      });
      // Corrected to use response.text for this specific SDK version
      return response.text || '';
    } catch (error) {
      console.error('Script Gen Error:', error);
      throw error;
    }
  }

  async generateAudio(script: string, voiceLead: string = 'Puck', voiceExpert: string = 'Kore', hostLead: string = 'Joe', hostExpert: string = 'Jane'): Promise<{ data: string | null; error?: string }> {
    try {
      console.log(`Starting TTS generation with voices ${voiceLead} and ${voiceExpert}...`);
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: hostLead, voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceLead } } },
                { speaker: hostExpert, voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceExpert } } }
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
      console.log('Generating cover art with Imagen 4.0 for topic:', topic);
      const response = await this.ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: `Professional podcast cover art for news topic: "${topic}". Modern, sleek, dark theme with purple accents. High quality, abstract visualization.`,
        config: {
          numberOfImages: 1,
        }
      });

      console.log('Imagen Response received:', JSON.stringify(response).substring(0, 200));

      const image = response.generatedImages?.[0]?.image;
      const imageBytes = image?.imageBytes;

      if (!imageBytes) {
        console.error('Imagen returned no image bytes in response');
        return null;
      }

      // In Deno/Supabase, imageBytes can be a string (base64) or binary data (Uint8Array)
      let cleanBase64 = '';
      if (typeof imageBytes === 'string') {
        cleanBase64 = imageBytes.replace(/[\n\r\t\s]/g, '');
      } else {
        console.log('imageBytes returned as binary, converting to base64...');
        try {
          const bytes = new Uint8Array(imageBytes as any);
          const chunks: string[] = [];
          for (let i = 0; i < bytes.length; i += 0x8000) {
            // @ts-ignore
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
          }
          cleanBase64 = btoa(chunks.join(''));
        } catch (e) {
          console.error('Binary image conversion failed:', e);
          return null;
        }
      }

      const dataUri = `data:image/png;base64,${cleanBase64}`;
      console.log('Cover art generated successfully, URI length:', dataUri.length);
      return dataUri;
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

    const { editionType, region, language, forceRefresh, voiceId = 'originals' } = body;

    console.log('Edition request:', { editionType, region, language, forceRefresh, voiceId });

    // Select voice profile
    const profileKey = (VOICE_PROFILES[voiceId as VoiceId] ? voiceId : 'originals') as VoiceId;
    const voiceProfile = VOICE_PROFILES[profileKey];

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

    // Check for cached edition (SKIP if forceRefresh is true)
    if (!forceRefresh) {
      console.log('Checking for cached edition for:', { editionType, region, language, today });
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
        console.log('✅ Returning cached edition');

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
    } else {
      console.log('🚀 FORCE REFRESH REQUESTED: Bypassing Supabase cache and generating fresh content');
    }

    console.log('Generating new edition...');

    // Initialize Gemini service
    const gemini = new GeminiService(Deno.env.get('GEMINI_API_KEY') ?? '');

    // Helper: Add timeout to a promise
    const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
      const timeout = new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      );
      return Promise.race([promise, timeout]).catch(() => fallback);
    };

    // Step 1: Fetch trending news (REQUIRED - this is the core content)
    console.log('Fetching trending news...');
    const { text: trendingNews, grounding: groundingLinks } = await gemini.fetchTrendingNews(region, language, editionType);
    console.log('Trending news fetched, length:', trendingNews.length);

    if (!trendingNews || trendingNews.length < 50) {
      throw new Error('Failed to fetch trending news content');
    }

    // Extract first topic for image generation (clean it for better prompt)
    const firstTopic = trendingNews.split('\n')
      .find(line => line.trim().length > 5)
      ?.replace(/[*#]/g, '')
      ?.trim()
      ?.slice(0, 100) || 'Daily News Briefing';

    // Step 2-4: Sequential to smooth out resource spikes (Image, Summary, Script)
    console.log('Step 2: Generating flash summary...');
    let flashSummary = '';
    try {
      flashSummary = await gemini.generateFlashSummary(trendingNews, language);
    } catch (e) { console.error('Summary error:', e); }

    console.log('Step 3: Generating cover art...');
    let imageUrl = null;
    try {
      imageUrl = await withTimeout(gemini.generateCoverArt(firstTopic), 30000, null);
    } catch (e) { console.error('Image error:', e); }

    console.log('Step 4: Generating podcast script (90s)...');
    let script = '';
    try {
      script = await gemini.generatePodcastScript(
        trendingNews,
        language,
        '1:30',
        voiceProfile.hosts.lead,
        voiceProfile.hosts.expert
      );
    } catch (e) { console.error('Script error:', e); }

    console.log('Sequential generation complete:');
    console.log('  - Summary:', flashSummary ? 'success' : 'failed');
    console.log('  - Image:', imageUrl ? 'success' : 'failed/skipped');
    console.log('  - Script:', script ? `success (${script.length} chars)` : 'failed');

    // Step 5: Generate audio (requires script, run last)
    let audioUrl: string | null = null;
    let audioError: string | undefined;

    if (script && script.length > 50) {
      console.log('Generating audio from script...');
      try {
        const audioResult = await withTimeout(
          gemini.generateAudio(
            script,
            voiceProfile.voices.lead,
            voiceProfile.voices.expert,
            voiceProfile.hosts.lead,
            voiceProfile.hosts.expert
          ),
          45000, // 45s timeout for TTS
          { data: null, error: 'TTS timeout' }
        );
        audioUrl = audioResult.data ? `data:audio/wav;base64,${audioResult.data}` : null;
        audioError = audioResult.error;
        console.log('Audio generation:', audioUrl ? 'success' : 'failed', audioError || '');
      } catch (e: any) {
        console.error('Audio generation error:', e);
        audioError = e.message;
      }
    } else {
      console.log('Skipping audio - no script available');
      audioError = 'No script generated';
    }

    // STRICT VALIDATION: Only cache if the main components are successful
    if (!trendingNews || trendingNews.length < 500) {
      console.error('Validation Failed: News content too short or missing.');
      throw new Error('News research failed to produce quality content. Please try again.');
    }

    if (!audioUrl) {
      console.error('Validation Failed: Audio generation failed.');
      // If audio fails, we do NOT cache, so the next attempt starts fresh
      return new Response(
        JSON.stringify({
          error: 'Audio generation failed. Broadcast was not cached. Please try again.',
          details: audioError
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

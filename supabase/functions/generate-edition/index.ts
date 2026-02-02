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
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
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
    hosts: { lead: 'Alex', expert: 'Jordan' },
    voices: { lead: 'Puck', expert: 'Kore' },
    label: 'The Originals',
    description: 'Classic dynamic duo - upbeat and confident'
  },
  'deep-divers': {
    hosts: { lead: 'Marcus', expert: 'Elena' },
    voices: { lead: 'Charon', expert: 'Leda' },
    label: 'The Deep-Divers',
    description: 'Investigative pair - informative and youthful'
  },
  'trendspotters': {
    hosts: { lead: 'Kai', expert: 'Sophia' },
    voices: { lead: 'Alnilam', expert: 'Callirrhoe' },
    label: 'The Trendspotters',
    description: 'Energetic team - fresh perspectives on trending topics'
  }
} as const;

type VoiceId = keyof typeof VOICE_PROFILES;

// ==================== SPEAKER REMAPPING ====================
function remapScriptSpeakers(script: string, targetHosts: { lead: string; expert: string }): string {
  const speakerPattern = /^([A-Za-z]+):/gm;
  const speakers: string[] = [];
  let match;
  while ((match = speakerPattern.exec(script)) !== null) {
    if (!speakers.includes(match[1])) {
      speakers.push(match[1]);
    }
    if (speakers.length === 2) break;
  }

  if (speakers.length !== 2) return script;

  const [existingLead, existingExpert] = speakers;
  if (existingLead === targetHosts.lead && existingExpert === targetHosts.expert) {
    return script;
  }

  let remapped = script
    .replace(new RegExp(`^${existingLead}:`, 'gm'), '__LEAD_PLACEHOLDER__:')
    .replace(new RegExp(`^${existingExpert}:`, 'gm'), '__EXPERT_PLACEHOLDER__:');
  remapped = remapped
    .replace(/__LEAD_PLACEHOLDER__:/g, `${targetHosts.lead}:`)
    .replace(/__EXPERT_PLACEHOLDER__:/g, `${targetHosts.expert}:`);

  console.log(`🔤 Remapped speakers: ${existingLead}→${targetHosts.lead}, ${existingExpert}→${targetHosts.expert}`);
  return remapped;
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

  async fetchTrendingNews(region: string, language: string, editionType: string = 'Daily', previousTopics: string = '') {
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

      const dedupInstruction = previousTopics
        ? `\n        DEDUPLICATION: Earlier editions today already covered these topics: ${previousTopics}. Do NOT repeat any of these as a main topic. Pick fresh, distinct stories that complement what was already covered.\n`
        : '';

      // Get today's date explicitly for the prompt
      const today = new Date();
      const dateString = today.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      console.log(`Generating detailed ${editionType} news briefing for ${region} in ${language}...`);
      console.log(previousTopics ? `Dedup active — excluding ${previousTopics.split(',').length} previous topics` : 'No previous topics to deduplicate');
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{
          role: 'user', parts: [{
            text: `[STRICT INSTRUCTION: DO NOT INCLUDE ANY INTRODUCTORY TEXT OR FILLER. START IMMEDIATELY WITH THE FIRST TOPIC.]

        You are an expert news analyst and investigative journalist.
        TODAY'S DATE: ${dateString}
        Research the top 5 most significant news topics and trending stories from ${timeFocus} (specifically ${dateString}) in ${region}.
        Include stories that are trending on social media platforms including X (Twitter), Reddit, and other public forums.
        ${thematicFocus}
        ${dedupInstruction}
        For EACH of the top 5 topics, you MUST provide a comprehensive and detailed report.

        CRITICAL CONSTRAINTS:
        - NEVER use numbered lists.
        - Use 3-4 LONG paragraphs with deep context and analysis for EACH topic.
        - Describe why it is trending and the atmosphere of the social conversation, especially on X (Twitter).
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
            text: `You are writing a podcast script for VoxTrends, a daily news briefing show. Create a ${duration} episode based on these trends: ${trends}.
        Language: ${language}.

        Hosts:
        - ${hostLead}: High-energy, charismatic main host. Real person, warm personality.
        - ${hostExpert}: Intelligent, analytical research expert. Grounded and sharp.

        BRANDING — NON-NEGOTIABLE:
        - The FIRST line must be ${hostLead} welcoming listeners to VoxTrends BY NAME and introducing themselves. Example: "${hostLead}: Welcome back to VoxTrends, I'm ${hostLead} — and today we've got a big one."
        - The LAST line must be ${hostLead} signing off with VoxTrends. Example: "${hostLead}: That's your VoxTrends briefing for today. Stay curious, stay sharp — I'm ${hostLead}, see you next time."
        - These are real, named podcast hosts. They should feel like actual people, not a generic AI summary.

        LENGTH — STRICT:
        - This is a ${duration} briefing at a natural conversational pace (~150 words/minute).
        - Total script must be 280-320 words. Do NOT exceed 320 words.
        - Cover the 2-3 most important stories only. Depth over breadth — don't rush through everything.

        FORMAT RULES:
        - EVERY single line of dialogue MUST start with either "${hostLead}:" or "${hostExpert}:" followed by a space. No exceptions.
        - Switch speakers every 2-3 sentences. No long monologue blocks.
        - Both hosts speak roughly equally. Write it as a natural back-and-forth conversation.

        Structure:
        ${hostLead}: [VoxTrends welcome + hook — the most surprising detail]
        ${hostExpert}: [React, add context — 2 sentences max]
        ${hostLead}: [Follow-up question or transition]
        ${hostExpert}: [First story — 2-3 sentences with specific details]
        ${hostLead}: [Commentary or bridge to next story]
        ${hostExpert}: [Second story — 2-3 sentences]
        ... [continue alternating, 2-3 stories max]
        ${hostLead}: [VoxTrends sign-off]

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

  async generateAudio(script: string, voiceLead: string = 'Puck', voiceExpert: string = 'Kore', hostLead: string = 'Joe', hostExpert: string = 'Jane', language: string = 'English'): Promise<{ data: string | null; error?: string }> {
    try {
      // Map language names to BCP-47 locale codes for Gemini TTS
      const languageCodeMap: Record<string, string> = {
        'English': 'en-US',
        'Spanish': 'es-ES',
        'Portuguese': 'pt-BR',
        'French': 'fr-FR',
        'German': 'de-DE',
      };
      const languageCode = languageCodeMap[language] || 'en-US';

      console.log(`Starting TTS generation with voices ${voiceLead} and ${voiceExpert} in ${language} (${languageCode})...`);
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            languageCode: languageCode,
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

// ==================== PHASE 1: REQUEST COALESCING ====================
const inFlightGenerations = new Map<string, Promise<any>>();

function getCacheKey(editionType: string, region: string, language: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `${editionType}-${region}-${language}-${today}`;
}

async function recordCacheHit(supabaseClient: any, cacheKey: string, generationTimeMs: number) {
  try {
    const { data: existing } = await supabaseClient
      .from('cache_analytics')
      .select('*')
      .eq('cache_key', cacheKey)
      .single();

    if (existing) {
      const newHits = existing.cache_hits + 1;
      const newTotal = existing.total_requests + 1;
      const newHitRate = newHits / newTotal;

      await supabaseClient
        .from('cache_analytics')
        .update({
          cache_hits: newHits,
          total_requests: newTotal,
          hit_rate: newHitRate,
          cost_saved_by_cache: (existing.cost_saved_by_cache || 0) + 0.05,
          updated_at: new Date().toISOString(),
        })
        .eq('cache_key', cacheKey);
    } else {
      await supabaseClient
        .from('cache_analytics')
        .insert({
          cache_key: cacheKey,
          cache_hits: 1,
          cache_misses: 0,
          total_requests: 1,
          hit_rate: 1.0,
          cost_saved_by_cache: 0.05,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
    }

    console.log(`📊 Cache hit recorded: ${cacheKey}`);
  } catch (error) {
    console.warn(`⚠️ Failed to record cache hit: ${error}`);
  }
}

async function recordCacheMiss(supabaseClient: any, cacheKey: string, generationTimeMs: number) {
  try {
    const { data: existing } = await supabaseClient
      .from('cache_analytics')
      .select('*')
      .eq('cache_key', cacheKey)
      .single();

    const costPerGeneration = 0.50;

    if (existing) {
      const newMisses = existing.cache_misses + 1;
      const newTotal = existing.total_requests + 1;
      const newHitRate = existing.cache_hits / newTotal;

      await supabaseClient
        .from('cache_analytics')
        .update({
          cache_misses: newMisses,
          total_requests: newTotal,
          hit_rate: newHitRate,
          generation_time_ms: generationTimeMs,
          cost_per_generation: costPerGeneration,
          total_cost: (existing.total_cost || 0) + costPerGeneration,
          updated_at: new Date().toISOString(),
        })
        .eq('cache_key', cacheKey);
    } else {
      await supabaseClient
        .from('cache_analytics')
        .insert({
          cache_key: cacheKey,
          cache_hits: 0,
          cache_misses: 1,
          total_requests: 1,
          hit_rate: 0,
          generation_time_ms: generationTimeMs,
          cost_per_generation: costPerGeneration,
          total_cost: costPerGeneration,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
    }

    console.log(`📊 Cache miss recorded: ${cacheKey} (${generationTimeMs}ms)`);
  } catch (error) {
    console.warn(`⚠️ Failed to record cache miss: ${error}`);
  }
}

// ==================== PHASE 1: REFRESH THROTTLING ====================
async function isRefreshThrottled(supabaseClient: any, userId: string, editionKey: string): Promise<{ throttled: boolean; minutesUntilRefresh?: number }> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentRefresh, error } = await supabaseClient
      .from('user_refresh_history')
      .select('force_refresh_at')
      .eq('user_id', userId)
      .eq('edition_key', editionKey)
      .gte('force_refresh_at', oneHourAgo)
      .order('force_refresh_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code === 'PGRST116') {
      return { throttled: false };
    }

    if (recentRefresh) {
      const lastRefresh = new Date(recentRefresh.force_refresh_at);
      const nextAllowedRefresh = new Date(lastRefresh.getTime() + 60 * 60 * 1000);
      const minutesUntilRefresh = Math.ceil((nextAllowedRefresh.getTime() - Date.now()) / (60 * 1000));

      console.log(`🔒 Refresh throttled for ${editionKey}: ${minutesUntilRefresh} minutes remaining`);
      return { throttled: true, minutesUntilRefresh };
    }

    return { throttled: false };
  } catch (error) {
    console.warn(`⚠️ Error checking refresh throttle: ${error}`);
    return { throttled: false };
  }
}

async function recordRefresh(supabaseClient: any, userId: string, editionKey: string) {
  try {
    await supabaseClient
      .from('user_refresh_history')
      .insert({
        user_id: userId,
        edition_key: editionKey,
        force_refresh_at: new Date().toISOString(),
      });

    console.log(`📝 Refresh recorded for ${editionKey}`);
  } catch (error) {
    console.warn(`⚠️ Failed to record refresh: ${error}`);
  }
}

// ==================== MAIN FUNCTION ====================
console.log('Generate Edition Function Started');

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

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

    const { editionType, region, language, forceRefresh, voiceId = 'originals', generateAudio = false } = body;
    const isAskAction = body.action === 'ask';
    const isVoiceVariantAction = body.action === 'generate-voice-variant';

    console.log(isAskAction ? 'Q&A request received' : isVoiceVariantAction ? 'Voice variant request received' : 'Edition request:', { editionType, region, language, forceRefresh, voiceId });

    // Select voice profile
    const profileKey = (VOICE_PROFILES[voiceId as VoiceId] ? voiceId : 'originals') as VoiceId;
    const voiceProfile = VOICE_PROFILES[profileKey];

    // Validate edition inputs (skip for routed actions)
    if (!isAskAction && !isVoiceVariantAction && (!editionType || !region || !language)) {
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

    // ==================== Q&A ACTION ====================
    // ask-question is routed here because it was never deployed as a standalone function.
    // This early-returns before any edition logic runs.
    if (isAskAction) {
      const { context, question, history, language: qLanguage } = body;

      if (!context || !question) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: context, question' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Processing Q&A request...');

      let prompt = `You are the VoxTrends Intelligence Agent. Your role is to help users explore news with depth, critical thinking, and intellectual honesty.

News Context:
${context}

`;

      if (history && history.length > 0) {
        prompt += 'Previous conversation:\n';
        for (const msg of history) {
          const label = msg.role === 'user' ? 'User' : 'Assistant';
          prompt += `${label}: ${msg.text}\n`;
        }
        prompt += '\n';
      }

      prompt += `User: ${question}

Guidelines:
- Answer based strictly on the provided news context. If the context doesn't cover something, say so explicitly rather than speculating.
- Highlight what is NOT being reported or what perspectives are missing — this builds critical thinking.
- Be direct and specific. Avoid vague generalities.
- At the end of your answer, suggest 1-2 follow-up questions that would deepen understanding. Format them clearly as: "You might also explore: ..."
- Language: ${qLanguage || 'English'}`;

      try {
        const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '' });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        const answer = response.text || 'Unable to generate an answer.';
        console.log('Q&A answered successfully');

        return new Response(
          JSON.stringify({ data: { answer } }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (qaError: any) {
        console.error('Q&A error:', qaError);
        return new Response(
          JSON.stringify({ error: qaError.message || 'Failed to process question' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ==================== VOICE VARIANT ACTION ====================
    // generate-voice-variant is routed here because it was never deployed as a standalone function.
    // This early-returns before any edition logic runs.
    if (isVoiceVariantAction) {
      const { edition_id, voice_id } = body;

      if (!edition_id || !voice_id) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: edition_id, voice_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!VOICE_PROFILES[voice_id as VoiceId]) {
        return new Response(
          JSON.stringify({ error: `Invalid voice_id. Must be one of: ${Object.keys(VOICE_PROFILES).join(', ')}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch edition and verify ownership
      const { data: edition, error: editionError } = await supabaseClient
        .from('daily_editions')
        .select('id, script, user_id, language')
        .eq('id', edition_id)
        .single();

      if (editionError || !edition) {
        return new Response(
          JSON.stringify({ error: 'Edition not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (edition.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: 'Access denied: You do not own this edition' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!edition.script) {
        return new Response(
          JSON.stringify({ error: 'Edition script not available' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if variant already cached
      const { data: existingVariant } = await supabaseClient
        .from('voice_variants')
        .select('id, audio_url')
        .eq('edition_id', edition_id)
        .eq('voice_id', voice_id)
        .single();

      if (existingVariant) {
        console.log(`✅ Returning cached voice variant: ${voice_id}`);
        return new Response(
          JSON.stringify({ data: { variant_id: existingVariant.id, audio: existingVariant.audio_url, cached: true } }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate new variant
      console.log(`🎙️ Generating new voice variant: ${voice_id}`);
      const variantProfile = VOICE_PROFILES[voice_id as VoiceId];
      const gemini = new GeminiService(Deno.env.get('GEMINI_API_KEY') ?? '');
      const scriptForTTS = remapScriptSpeakers(edition.script, variantProfile.hosts);

      const audioResult = await gemini.generateAudio(
        scriptForTTS,
        variantProfile.voices.lead,
        variantProfile.voices.expert,
        variantProfile.hosts.lead,
        variantProfile.hosts.expert,
        edition.language || 'English'
      );

      if (!audioResult.data) {
        return new Response(
          JSON.stringify({ error: `Audio generation failed: ${audioResult.error}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const audioUrl = `data:audio/wav;base64,${audioResult.data}`;

      // Store variant
      const { data: variant, error: variantError } = await supabaseClient
        .from('voice_variants')
        .insert({
          edition_id,
          user_id: user.id,
          voice_id,
          audio_url: audioUrl,
          generation_time_ms: Date.now(),
          cost_estimate: 0.05,
        })
        .select()
        .single();

      if (variantError) {
        console.warn(`⚠️ Failed to store variant: ${variantError.message}`);
      }

      console.log(`✅ Voice variant generated: ${voice_id}`);

      return new Response(
        JSON.stringify({ data: { variant_id: variant?.id, audio: audioUrl, cached: false } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // ==================== PHASE 1: REQUEST COALESCING ====================
    const cacheKey = getCacheKey(editionType, region, language);

    // Check if this exact request is already being processed
    if (inFlightGenerations.has(cacheKey) && !forceRefresh) {
      console.log(`🔗 Request coalesced: Waiting for in-flight ${cacheKey}`);
      try {
        const coalescedResult = await inFlightGenerations.get(cacheKey);
        return new Response(
          JSON.stringify({
            data: coalescedResult,
            coalesced: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        console.warn(`⚠️ Coalesced request failed: ${error}`);
        // Fall through to generate new one
      }
    }

    // ==================== PHASE 1: REFRESH THROTTLING ====================
    if (forceRefresh) {
      const { throttled, minutesUntilRefresh } = await isRefreshThrottled(supabaseClient, user.id, cacheKey);

      if (throttled) {
        return new Response(
          JSON.stringify({
            error: `Refresh throttled. Please wait ${minutesUntilRefresh} minutes before refreshing again.`,
            throttled: true,
            minutesUntilRefresh,
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Record this refresh
      await recordRefresh(supabaseClient, user.id, cacheKey);
      console.log('🚀 FORCE REFRESH REQUESTED: Bypassing Supabase cache and generating fresh content');
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
        const cacheTime = Date.now() - startTime;
        console.log('✅ Found cached edition');

        // Record cache hit asynchronously
        recordCacheHit(supabaseClient, cacheKey, cacheTime).catch((err) =>
          console.warn(`⚠️ Failed to record cache hit: ${err}`)
        );

        // Still increment usage for cached editions
        await supabaseClient.rpc('increment_daily_usage', {
          p_user_id: user.id,
          p_action: 'edition',
        });

        // Count generated voice variants for this edition
        const { data: variants } = await supabaseClient
          .from('voice_variants')
          .select('voice_id')
          .eq('edition_id', cachedEdition.id);

        // ==================== PHASE 3: HANDLE AUDIO GENERATION FOR CACHED EDITIONS ====================
        let audioUrl = null;

        if (generateAudio && cachedEdition.script) {
          try {
            console.log('🎙️ Generating audio for cached edition with voice profile:', voiceId);
            const gemini = new GeminiService(Deno.env.get('GEMINI_API_KEY') ?? '');
            const scriptForTTS = remapScriptSpeakers(cachedEdition.script, voiceProfile.hosts);
            const audioResult = await gemini.generateAudio(
              scriptForTTS,
              voiceProfile.voices.lead,
              voiceProfile.voices.expert,
              voiceProfile.hosts.lead,
              voiceProfile.hosts.expert,
              cachedEdition.language || language || 'English'
            );

            if (audioResult.data) {
              audioUrl = `data:audio/wav;base64,${audioResult.data}`;
              console.log('✅ Audio generated successfully for cached edition');
            } else {
              console.warn('⚠️ Audio generation returned no data:', audioResult.error);
            }
          } catch (audioError: any) {
            console.error('❌ Audio generation error for cached edition:', audioError);
            // Don't fail the whole request if audio generation fails
          }
        }

        // ==================== PHASE 3: RETURN CACHED SCRIPT-READY EDITION ====================
        console.log('✅ Returning cached edition (script-ready)' + (audioUrl ? ' with audio' : ''));
        return new Response(
          JSON.stringify({
            data: {
              edition_id: cachedEdition.id,
              text: cachedEdition.content,
              script: cachedEdition.script,
              imageUrl: cachedEdition.image_url,
              links: cachedEdition.grounding_links,
              flashSummary: cachedEdition.flash_summary,
              audio: audioUrl,
              cached: true,
              scriptReady: true,
              voiceVariantsAvailable: ['originals', 'deep-divers', 'trendspotters'],
              voiceVariantsGeneratedCount: variants?.length || 0,
              message: audioUrl
                ? 'Content and script ready with audio!'
                : 'Content and script ready. Select a voice profile to generate audio.',
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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
    // First, gather topics from other editions generated today for the same region/language
    // so we can deduplicate and keep each edition feeling fresh
    let previousTopics = '';
    try {
      const { data: siblingEditions } = await supabaseClient
        .from('daily_editions')
        .select('content')
        .eq('region', region)
        .eq('language', language)
        .eq('date', today)
        .neq('edition_type', editionType);

      if (siblingEditions && siblingEditions.length > 0) {
        // Extract the first heading from each sibling edition as a topic summary
        const topics = siblingEditions.map((ed: any) => {
          const heading = (ed.content || '').split('\n')
            .find((line: string) => line.trim().length > 5)
            ?.replace(/[*#]/g, '')
            ?.trim()
            ?.slice(0, 80);
          return heading;
        }).filter(Boolean);

        if (topics.length > 0) {
          previousTopics = topics.join(', ');
          console.log(`Found ${topics.length} sibling edition(s) — passing topics for dedup`);
        }
      }
    } catch (e) {
      console.warn('⚠️ Failed to fetch sibling editions for dedup (non-fatal):', e);
    }

    console.log('Fetching trending news...');
    const { text: trendingNews, grounding: groundingLinks } = await gemini.fetchTrendingNews(region, language, editionType, previousTopics);
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

    // ==================== PHASE 3: CONTENT + SCRIPT ONLY ====================
    // Skip audio generation - users will select voice variant after content is ready
    // This reduces TTS cost by ~90% (only generate audio for variants they actually want)

    // Steps 2 & 3 are independent of each other — run in parallel to cut wall-clock time
    console.log('Steps 2+3: Generating flash summary and cover art in parallel...');
    const [flashSummary, imageUrl] = await Promise.all([
      gemini.generateFlashSummary(trendingNews, language).catch((e: any) => { console.error('Summary error:', e); return ''; }),
      withTimeout(gemini.generateCoverArt(firstTopic), 30000, null).catch((e: any) => { console.error('Image error:', e); return null; }),
    ]);

    console.log('Step 4: Generating podcast script (90s)...');
    let script = '';
    try {
      script = await gemini.generatePodcastScript(
        trendingNews,
        language,
        '2:00',
        voiceProfile.hosts.lead,
        voiceProfile.hosts.expert
      );
    } catch (e) { console.error('Script error:', e); }

    console.log('Content generation complete:');
    console.log('  - Summary:', flashSummary ? 'success' : 'failed');
    console.log('  - Image:', imageUrl ? 'success' : 'failed/skipped');
    console.log('  - Script:', script ? `success (${script.length} chars)` : 'failed');
    console.log('  🎙️ Audio generation: SKIPPED (Phase 3 on-demand voice variants)');

    // STRICT VALIDATION: Only cache if content is successful
    if (!trendingNews || trendingNews.length < 500) {
      console.error('Validation Failed: News content too short or missing.');
      throw new Error('News research failed to produce quality content. Please try again.');
    }

    if (!script || script.length < 50) {
      console.error('Validation Failed: Script generation failed.');
      return new Response(
        JSON.stringify({
          error: 'Script generation failed. Please try again.',
          details: 'Could not generate podcast script'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cache the edition
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6);

    // ==================== PHASE 3: CACHE SCRIPT-READY EDITION ====================
    // Store content + script, but NOT audio (audio will be generated per-variant on-demand)
    const { data: editionData, error: cacheError } = await supabaseClient
      .from('daily_editions')
      .upsert({
        edition_type: editionType,
        region,
        language,
        date: today,
        user_id: user.id,
        content: trendingNews,
        script: script || '',
        audio_url: null,  // Phase 3: No audio yet - generated on-demand
        image_url: imageUrl,
        grounding_links: groundingLinks,
        flash_summary: flashSummary,
        expires_at: expiresAt.toISOString(),
        script_ready: true,
        is_script_only: true,  // Marker for Phase 3 behavior
        content_generated_at: new Date().toISOString(),
      }, {
        onConflict: 'edition_type,region,language,date'
      })
      .select()
      .single();

    if (cacheError) {
      throw new Error(`Failed to cache edition: ${cacheError.message}`);
    }

    console.log('Edition cached (script-ready, audio on-demand per voice variant)');

    // ==================== PHASE 4: SCHEDULE CONTENT DELETION ====================
    // Create expiration schedule entry based on user's plan tier
    const retentionHours = {
      'Free': 24,
      'Pro': 7 * 24,      // 7 days
      'Studio': 30 * 24,  // 30 days
    };

    const tierRetentionHours = retentionHours[userPlan as keyof typeof retentionHours] || 24;
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setHours(scheduledDeletionAt.getHours() + tierRetentionHours);

    try {
      await supabaseClient
        .from('content_expiration_schedule')
        .upsert({
          edition_id: editionData.id,
          user_id: user.id,
          tier: userPlan,
          scheduled_deletion_at: scheduledDeletionAt.toISOString(),
        }, {
          onConflict: 'edition_id,user_id'
        });

      console.log(`📅 Content scheduled for deletion in ${tierRetentionHours} hours (${userPlan} tier)`);
    } catch (err) {
      console.warn(`⚠️ Failed to schedule content deletion: ${err}`);
      // Non-blocking error - don't fail the whole function
    }

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
      metadata: { editionType, region, language, voiceId },
      cost_estimate: 0.15,
    });

    console.log('Analytics logged');

    // ==================== PHASE 1: RECORD CACHE MISS ====================
    const generationTime = Date.now() - startTime;
    recordCacheMiss(supabaseClient, cacheKey, generationTime).catch((err) =>
      console.warn(`⚠️ Failed to record cache miss: ${err}`)
    );

    // ==================== PHASE 3: OPTIONAL AUDIO GENERATION ====================
    let audioUrl = null;

    if (generateAudio && script) {
      try {
        console.log('🎙️ Generating audio for voice profile:', voiceId);
        const audioResult = await gemini.generateAudio(
          script,
          voiceProfile.voices.lead,
          voiceProfile.voices.expert,
          voiceProfile.hosts.lead,
          voiceProfile.hosts.expert,
          language || 'English'
        );

        if (audioResult.data) {
          audioUrl = `data:audio/wav;base64,${audioResult.data}`;
          console.log('✅ Audio generated successfully');
        } else {
          console.warn('⚠️ Audio generation returned no data:', audioResult.error);
        }
      } catch (audioError: any) {
        console.error('❌ Audio generation error:', audioError);
        // Don't fail the whole request if audio generation fails
      }
    }

    // ==================== PHASE 3: RETURN SCRIPT-READY EDITION ====================
    // Return content + script, optionally with audio
    return new Response(
      JSON.stringify({
        data: {
          edition_id: editionData.id,
          text: trendingNews,
          script: script || '',
          imageUrl,
          links: groundingLinks,
          flashSummary,
          audio: audioUrl,  // Will be null if generateAudio was false or if generation failed
          cached: false,
          scriptReady: true,
          voiceVariantsAvailable: ['originals', 'deep-divers', 'trendspotters'],
          voiceVariantsGeneratedCount: audioUrl ? 1 : 0,
          message: audioUrl
            ? 'Content and script ready with audio!'
            : 'Content and script ready. Select a voice profile to generate audio.',
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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1.38.0';

// ==================== CORS ====================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function handleCors(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }
}

// ==================== MAIN FUNCTION ====================
console.log('Generate Voice Variant Function Started');

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Parse request body
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

    const { edition_id, voice_id } = body;

    console.log('Voice variant request:', { edition_id, voice_id });

    // Validate inputs
    if (!edition_id || !voice_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: edition_id, voice_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get authorization header - CRITICAL
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('❌ Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Authorization header present');

    // Create Supabase client with authorization
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false }
      }
    );

    console.log('🔐 Validating JWT...');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError) {
      console.error('❌ Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Invalid JWT', details: authError.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!user) {
      console.error('❌ No user found in JWT');
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'No user in JWT' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ User authenticated:', user.id);

    // Get the edition
    const { data: edition, error: editionError } = await supabaseClient
      .from('daily_editions')
      .select('id, script, user_id, content')
      .eq('id', edition_id)
      .single();

    if (editionError || !edition) {
      console.error('❌ Edition not found:', editionError);
      return new Response(
        JSON.stringify({ error: 'Edition not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership
    if (edition.user_id !== user.id) {
      console.error('❌ User does not own this edition');
      return new Response(
        JSON.stringify({ error: 'Access denied: You do not own this edition' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Edition found and owned by user');

    if (!edition.script) {
      return new Response(
        JSON.stringify({ error: 'Edition script not available' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate audio using Gemini
    console.log('🎙️ Generating audio for voice:', voice_id);
    const gemini = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '' });

    const voiceMap: Record<string, { lead: string; expert: string }> = {
      'originals': { lead: 'Puck', expert: 'Kore' },
      'deep-divers': { lead: 'Charon', expert: 'Aoede' },
      'trendspotters': { lead: 'Fenrir', expert: 'Kore' }
    };

    const voices = voiceMap[voice_id] || voiceMap['originals'];

    try {
      const response = await gemini.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: edition.script }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.lead } } },
                { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.expert } } }
              ]
            }
          }
        }
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioData) {
        console.error('❌ Gemini returned no audio data');
        return new Response(
          JSON.stringify({ error: 'Gemini TTS failed to generate audio' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('✅ Audio generated successfully');

      // Return the audio
      return new Response(
        JSON.stringify({
          data: {
            audio_url: `data:audio/wav;base64,${audioData}`,
            voice_id,
            edition_id
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (geminiError: any) {
      console.error('❌ Gemini error:', geminiError);
      return new Response(
        JSON.stringify({ error: 'Audio generation failed', details: geminiError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: any) {
    console.error('❌ Function error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


// ==================== GEMINI SERVICE ====================
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

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, fileSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  return new Uint8Array(buffer);
}

function pcmToWav(pcmBase64: string): string {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), (c) => c.charCodeAt(0));
  const wavHeader = createWavHeader(pcmBytes.length);
  const wavBytes = new Uint8Array(wavHeader.length + pcmBytes.length);
  wavBytes.set(wavHeader, 0);
  wavBytes.set(pcmBytes, wavHeader.length);

  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let i = 0; i < wavBytes.length; i += chunkSize) {
    const chunk = wavBytes.subarray(i, Math.min(i + chunkSize, wavBytes.length));
    // @ts-ignore
    chunks.push(String.fromCharCode.apply(null, chunk));
  }
  return btoa(chunks.join(''));
}

class GeminiService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateAudio(
    script: string,
    voiceLead: string,
    voiceExpert: string,
    hostLead: string,
    hostExpert: string
  ): Promise<{ data: string | null; error?: string }> {
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

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioData) {
        console.error('Gemini TTS returned empty audioContent');
        return { data: null, error: 'Gemini TTS returned empty audioContent' };
      }

      console.log('TTS returned audio data, converting PCM to WAV...');
      const wavBase64 = pcmToWav(audioData);
      console.log('WAV conversion complete');

      return { data: wavBase64 };
    } catch (error: any) {
      console.error('Gemini TTS Synthesis Error:', error);
      return { data: null, error: `Synthesis Error: ${error.message}` };
    }
  }
}

// ==================== MAIN FUNCTION ====================
console.log('Generate Voice Variant Function Started');

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
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

    const { edition_id, voice_id } = body;

    console.log('Voice variant request:', { edition_id, voice_id });

    // Validate inputs
    if (!edition_id || !voice_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: edition_id, voice_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate voice_id
    if (!VOICE_PROFILES[voice_id as VoiceId]) {
      return new Response(
        JSON.stringify({ error: `Invalid voice_id. Must be one of: ${Object.keys(VOICE_PROFILES).join(', ')}` }),
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
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false }
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

    // Verify user owns this edition
    const { data: edition, error: editionError } = await supabaseClient
      .from('daily_editions')
      .select('id, script, user_id')
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

    // ==================== REQUEST COALESCING ====================
    const variantCacheKey = getVariantCacheKey(edition_id, voice_id);

    if (inFlightVariants.has(variantCacheKey)) {
      console.log(`🔗 Voice variant request coalesced: Waiting for ${variantCacheKey}`);
      try {
        const coalescedResult = await inFlightVariants.get(variantCacheKey);
        return new Response(
          JSON.stringify({
            data: coalescedResult,
            coalesced: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        console.warn(`⚠️ Coalesced variant request failed: ${error}`);
        // Fall through to generate new one
      }
    }

    // Check if variant already exists
    const { data: existingVariant } = await supabaseClient
      .from('voice_variants')
      .select('id, audio_url')
      .eq('edition_id', edition_id)
      .eq('voice_id', voice_id)
      .single();

    if (existingVariant) {
      console.log(`✅ Returning cached voice variant: ${voice_id}`);
      return new Response(
        JSON.stringify({
          data: {
            variant_id: existingVariant.id,
            audio_url: existingVariant.audio_url,
            cached: true,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate new voice variant
    console.log(`🎙️ Generating new voice variant: ${voice_id}`);

    // Create in-flight promise
    const generationPromise = (async () => {
      const voiceProfile = VOICE_PROFILES[voice_id as VoiceId];
      const gemini = new GeminiService(Deno.env.get('GEMINI_API_KEY') ?? '');

      // Generate audio
      const audioResult = await gemini.generateAudio(
        edition.script,
        voiceProfile.voices.lead,
        voiceProfile.voices.expert,
        voiceProfile.hosts.lead,
        voiceProfile.hosts.expert
      );

      if (!audioResult.data) {
        throw new Error(`Audio generation failed: ${audioResult.error}`);
      }

      const audioUrl = `data:audio/wav;base64,${audioResult.data}`;
      const generationTime = Date.now() - startTime;

      // Store variant
      const { data: variant, error: variantError } = await supabaseClient
        .from('voice_variants')
        .insert({
          edition_id,
          user_id: user.id,
          voice_id,
          audio_url: audioUrl,
          generation_time_ms: generationTime,
          cost_estimate: 0.05,
        })
        .select()
        .single();

      if (variantError) {
        throw new Error(`Failed to store variant: ${variantError.message}`);
      }

      // Log cost
      await supabaseClient
        .from('voice_variant_costs')
        .insert({
          user_id: user.id,
          edition_id,
          voice_id,
          cost: 0.05,
        })
        .catch((err) => console.warn(`⚠️ Failed to log variant cost: ${err}`));

      // Increment usage (voice variant generation)
      await supabaseClient.rpc('increment_daily_usage', {
        p_user_id: user.id,
        p_action: 'voice_variant',
      }).catch((err) => console.warn(`⚠️ Failed to increment usage: ${err}`));

      console.log(`✅ Voice variant generated: ${voice_id} (${generationTime}ms)`);

      return {
        variant_id: variant.id,
        audio_url: audioUrl,
        generation_time_ms: generationTime,
        cached: false,
      };
    })();

    inFlightVariants.set(variantCacheKey, generationPromise);

    // Clean up promise from map after completion
    generationPromise.finally(() => {
      inFlightVariants.delete(variantCacheKey);
    });

    const result = await generationPromise;

    return new Response(
      JSON.stringify({ data: result }),
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

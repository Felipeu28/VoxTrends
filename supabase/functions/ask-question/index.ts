import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1.38.0';
import { corsHeaders, handleCors } from '../shared/cors.ts';

console.log('Ask Question Function Started');

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { context, question, history, language } = await req.json();

    if (!context || !question) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: context, question' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Authenticate user
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
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('User authenticated:', user.id);

    // Build prompt with conversation history
    let prompt = `You are the Vox Intelligence Agent for VoxTrends. Answer questions based on the following news context.\n\nLanguage: ${language || 'English'}\n\nNews Context:\n${context}\n\n`;

    if (history && history.length > 0) {
      prompt += 'Previous conversation:\n';
      for (const msg of history) {
        const label = msg.role === 'user' ? 'User' : 'Assistant';
        prompt += `${label}: ${msg.text}\n`;
      }
      prompt += '\n';
    }

    prompt += `User: ${question}\n\nProvide a concise, insightful answer based on the news context above. Be direct and informative.`;

    // Call Gemini
    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '' });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const answer = response.text || 'Unable to generate an answer.';

    console.log('Question answered successfully');

    return new Response(
      JSON.stringify({ data: { answer } }),
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

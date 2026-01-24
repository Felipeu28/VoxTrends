import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log('🔬 DEBUG VERSION - Generate Edition Function Started');

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('==================== NEW REQUEST ====================');
    console.log('📥 Method:', req.method);
    console.log('📥 URL:', req.url);
    console.log('📥 Headers:', Object.fromEntries(req.headers.entries()));
    
    // Parse Input
    const body = await req.json();
    console.log('📊 Request Body:', body);
    
    const { editionType, region, language } = body;
    
    // Check Authorization Header
    const authHeader = req.headers.get('Authorization');
    console.log('🔑 Authorization Header:', authHeader ? `EXISTS (${authHeader.substring(0, 20)}...)` : 'MISSING');
    
    if (!authHeader) {
      console.error('❌ NO AUTHORIZATION HEADER');
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract token
    const token = authHeader.replace('Bearer ', '');
    console.log('🔑 Token Length:', token.length);
    console.log('🔑 Token Start:', token.substring(0, 50));
    console.log('🔑 Token End:', token.substring(token.length - 50));
    
    // Check Environment Variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    console.log('🔧 SUPABASE_URL:', supabaseUrl ? 'SET' : 'MISSING');
    console.log('🔧 SUPABASE_ANON_KEY:', supabaseAnonKey ? `SET (${supabaseAnonKey.substring(0, 20)}...)` : 'MISSING');
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('❌ Missing Supabase environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    console.log('🔨 Creating Supabase client...');
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    console.log('✅ Supabase client created');

    // Try to verify token
    console.log('🔍 Attempting to verify token...');
    
    try {
      const { data, error } = await supabaseClient.auth.getUser(token);
      
      console.log('📊 getUser response:', {
        hasData: !!data,
        hasUser: !!data?.user,
        hasError: !!error,
        errorCode: error?.code,
        errorMessage: error?.message,
        errorStatus: error?.status,
      });
      
      if (error) {
        console.error('❌ Token verification error:', error);
        console.error('❌ Error details:', JSON.stringify(error, null, 2));
        
        return new Response(
          JSON.stringify({ 
            error: 'Authentication failed',
            details: error.message,
            code: error.code,
            hint: 'Token verification failed in Edge Function'
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (!data?.user) {
        console.error('❌ No user in response');
        return new Response(
          JSON.stringify({ error: 'No user found in token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log('✅ User verified:', {
        id: data.user.id,
        email: data.user.email,
        role: data.user.role,
        aud: data.user.aud,
      });
      
      // If we get here, auth worked!
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Authentication successful!',
          user: {
            id: data.user.id,
            email: data.user.email,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
      
    } catch (verifyError: any) {
      console.error('💥 Exception during token verification:', verifyError);
      console.error('💥 Exception type:', verifyError.constructor.name);
      console.error('💥 Exception message:', verifyError.message);
      console.error('💥 Exception stack:', verifyError.stack);
      
      return new Response(
        JSON.stringify({ 
          error: 'Token verification exception',
          details: verifyError.message,
          type: verifyError.constructor.name,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('💥 Top-level error:', error);
    console.error('💥 Error type:', error.constructor?.name);
    console.error('💥 Error message:', error.message);
    console.error('💥 Error stack:', error.stack);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        type: error.constructor?.name,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

console.log('Create Checkout Function Started');

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Parse request body
    const { priceId } = await req.json();
    
    console.log('Checkout request for price:', priceId);

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: 'Missing priceId' }),
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
    const { data: profile } = await supabaseClient
      .from('users')
      .select('stripe_customer_id, email, name')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create or retrieve Stripe customer
    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      console.log('Creating new Stripe customer');
      
      const customer = await stripe.customers.create({
        email: user.email || profile.email,
        name: profile.name,
        metadata: {
          supabase_user_id: user.id,
        },
      });

      customerId = customer.id;

      // Save customer ID to user profile
      await supabaseClient
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

      console.log('Stripe customer created:', customerId);
    } else {
      console.log('Using existing Stripe customer:', customerId);
    }

    // Get origin for redirect URLs
    const origin = req.headers.get('origin') || 'https://voxtrends.com';

    // Create checkout session
    console.log('Creating checkout session');
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
      metadata: {
        supabase_user_id: user.id,
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
      },
    });

    console.log('Checkout session created:', session.id);

    return new Response(
      JSON.stringify({ 
        sessionId: session.id,
        url: session.url,
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

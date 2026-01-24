import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno';

console.log('Stripe Webhook Function Started');

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  try {
    const body = await req.text();
    
    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret,
        undefined,
        Stripe.createSubtleCryptoProvider()
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    console.log('Webhook event received:', event.type);

    // Create Supabase client with service role key (admin access)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        console.log('Checkout session completed:', session.id);
        console.log('Metadata:', session.metadata);

        const userId = session.metadata?.supabase_user_id;
        
        if (!userId) {
          console.error('No supabase_user_id in metadata');
          return new Response('Missing user ID in metadata', { status: 400 });
        }

        // Upgrade user to Pro
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ 
            plan: 'Pro',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (updateError) {
          console.error('Error updating user plan:', updateError);
          throw updateError;
        }

        console.log('User upgraded to Pro:', userId);

        // Create subscription record
        const { error: subError } = await supabaseAdmin
          .from('subscriptions')
          .insert({
            user_id: userId,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            plan: 'pro_monthly',
            status: 'active',
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Approximate, will be updated by subscription.updated
          });

        if (subError) {
          console.error('Error creating subscription record:', subError);
          throw subError;
        }

        console.log('Subscription record created');

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        
        console.log('Subscription updated:', subscription.id);
        console.log('Status:', subscription.status);

        // Update subscription record
        const { error: updateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: subscription.status,
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);

        if (updateError) {
          console.error('Error updating subscription:', updateError);
          throw updateError;
        }

        // If subscription is canceled or past_due, downgrade user
        if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
          const { data: sub } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', subscription.id)
            .single();

          if (sub) {
            const { error: downgradeError } = await supabaseAdmin
              .from('users')
              .update({ 
                plan: 'Free',
                updated_at: new Date().toISOString(),
              })
              .eq('id', sub.user_id);

            if (downgradeError) {
              console.error('Error downgrading user:', downgradeError);
            } else {
              console.log('User downgraded to Free:', sub.user_id);
            }
          }
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        
        console.log('Subscription deleted:', subscription.id);

        // Get user ID from subscription
        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (sub) {
          // Downgrade user to Free
          const { error: downgradeError } = await supabaseAdmin
            .from('users')
            .update({ 
              plan: 'Free',
              updated_at: new Date().toISOString(),
            })
            .eq('id', sub.user_id);

          if (downgradeError) {
            console.error('Error downgrading user:', downgradeError);
          } else {
            console.log('User downgraded to Free:', sub.user_id);
          }

          // Update subscription status
          await supabaseAdmin
            .from('subscriptions')
            .update({ status: 'canceled' })
            .eq('stripe_subscription_id', subscription.id);
        }

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        
        console.log('Payment failed for invoice:', invoice.id);
        console.log('Customer:', invoice.customer);

        // You could send an email notification here
        // or set a flag in the database to show a payment retry prompt

        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

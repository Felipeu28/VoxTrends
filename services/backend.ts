import { supabase } from './supabase';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export class BackendService {
  /**
   * Generic function to call any Supabase Edge Function
   */
  private async callFunction(name: string, body: any) {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      // Handle specific error types
      if (response.status === 429 && data.upgrade) {
        // Daily limit reached
        const error = new Error(data.message || 'Daily limit reached');
        (error as any).upgrade = true;
        (error as any).limit = data.limit;
        (error as any).used = data.used;
        throw error;
      }

      if (response.status === 403 && data.upgrade) {
        // Feature not allowed on plan
        const error = new Error(data.message || 'Upgrade required');
        (error as any).upgrade = true;
        throw error;
      }

      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  /**
   * Generate a daily edition (Morning/Midday/Evening)
   */
  async generateEdition(
    editionType: 'Morning' | 'Midday' | 'Evening',
    region: string,
    language: string
  ) {
    return this.callFunction('generate-edition', {
      editionType,
      region,
      language,
    });
  }

  /**
   * Conduct research on a topic
   */
  async conductResearch(
    query: string,
    region: string,
    language: string
  ) {
    return this.callFunction('conduct-research', {
      query,
      region,
      language,
    });
  }

  /**
   * Create a Stripe checkout session
   */
  async createCheckoutSession(priceId: string) {
    return this.callFunction('create-checkout', {
      priceId,
    });
  }

  /**
   * Get user's current quota/usage
   */
  async getUserQuota() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase.rpc('get_remaining_quota', {
      p_user_id: user.id,
    });

    if (error) throw error;
    return data;
  }
}

export const backend = new BackendService();

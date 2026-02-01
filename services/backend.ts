import { supabase } from './supabase';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export class BackendService {
  /**
   * Generic function to call any Supabase Edge Function
   */
  private async callFunction(name: string, body: any) {
    console.log('🔍 [Backend] Getting session...');
    const { data: { session } } = await supabase.auth.getSession();

    console.log('🔍 [Backend] Session:', session ? 'EXISTS' : 'NULL');
    console.log('🔍 [Backend] User:', session?.user?.email);
    console.log('🔍 [Backend] Access token:', session?.access_token ? 'EXISTS' : 'MISSING');

    if (!session) {
      console.error('❌ [Backend] No session - user not authenticated');
      throw new Error('Not authenticated');
    }

    const url = `${FUNCTIONS_URL}/${name}`;
    console.log('🔍 [Backend] Calling:', url);
    console.log('🔍 [Backend] Body:', body);

    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // Token may have expired since session was loaded — refresh and retry once on 401
    if (response.status === 401) {
      console.log('🔍 [Backend] Got 401, refreshing session and retrying...');
      const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed) {
        throw new Error('Session expired. Please log in again.');
      }
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${refreshed.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    }

    console.log('🔍 [Backend] Response status:', response.status);

    const data = await response.json();
    console.log('🔍 [Backend] Response data:', data);

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

      if (response.status === 546 || data.code === 'WORKER_LIMIT') {
        const error = new Error('The server is currently processing too many requests. Please try again in 30 seconds.');
        (error as any).workerLimit = true;
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
    language: string,
    forceRefresh: boolean = false,
    voiceId: string = 'originals',
    generateAudio: boolean = false
  ) {
    return this.callFunction('generate-edition', {
      editionType,
      region,
      language,
      forceRefresh,
      voiceId,
      generateAudio,
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

  /**
   * Generate audio for a voice variant (Phase 3)
   */
  async generateVoiceVariant(editionId: string, voiceId: string) {
    return this.callFunction('generate-voice-variant', {
      edition_id: editionId,
      voice_id: voiceId,
    });
  }

  /**
   * Get share links for an edition (Phase 4)
   */
  async getShareLinks(editionId: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const url = `${FUNCTIONS_URL}/share-edition?edition_id=${editionId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to get share links');
    return data.shares || [];
  }

  /**
   * Create a share link for an edition (Phase 4)
   */
  async createShareLink(editionId: string) {
    return this.callFunction('share-edition', {
      edition_id: editionId,
    });
  }

  /**
   * Revoke a share link (Phase 4)
   */
  async revokeShareLink(shareId: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const url = `${FUNCTIONS_URL}/share-edition?share_id=${shareId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to revoke share link');
    }
  }

  /**
   * Ask a question about an edition's content
   */
  async askQuestion(context: string, question: string, history: { role: string; text: string }[], language: string) {
    const result = await this.callFunction('ask-question', {
      context,
      question,
      history,
      language,
    });
    return result.data?.answer || 'No answer available.';
  }

  /**
   * Get a shared edition by token (Phase 4 - public access)
   */
  async getSharedEdition(shareToken: string) {
    const url = `${FUNCTIONS_URL}/get-shared-edition?share_token=${shareToken}`;
    const response = await fetch(url, {
      method: 'GET',
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to get shared edition');
    return data.data;
  }
}

export const backend = new BackendService();

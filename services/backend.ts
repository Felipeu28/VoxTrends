// services/backend.ts
import { supabase } from './supabase';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

export class BackendService {
  private async callFunction(name: string, body: any) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    
    const response = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }
    
    return response.json();
  }
  
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
  
  async conductResearch(query: string, region: string, language: string) {
    return this.callFunction('conduct-research', {
      query,
      region,
      language,
    });
  }
}

export const backend = new BackendService();

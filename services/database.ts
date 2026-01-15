import { supabase } from './supabase';
import type { User, SavedClip, DailyEdition } from './supabase';

export class DatabaseService {
  // ==================== USER MANAGEMENT ====================
  
  async createUser(email: string, name: string, avatarUrl?: string): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .insert({
        email,
        name,
        avatar_url: avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  async getUser(userId: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  }
  
  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  async updateLastLogin(userId: string): Promise<void> {
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', userId);
  }
  
  // ==================== SAVED CLIPS ====================
  
  async saveClip(
    userId: string,
    title: string,
    type: 'Daily' | 'Research',
    content: string,
    metadata?: {
      flashSummary?: string;
      audioUrl?: string;
      imageUrl?: string;
      chatHistory?: any[];
      other?: Record<string, any>;
    }
  ): Promise<SavedClip> {
    const { data, error } = await supabase
      .from('saved_clips')
      .insert({
        user_id: userId,
        title,
        clip_type: type,
        content,
        flash_summary: metadata?.flashSummary,
        audio_url: metadata?.audioUrl,
        image_url: metadata?.imageUrl,
        chat_history: metadata?.chatHistory || [],
        metadata: metadata?.other || {},
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  async getUserClips(userId: string): Promise<SavedClip[]> {
    const { data, error } = await supabase
      .from('saved_clips')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }
  
  async deleteClip(clipId: string): Promise<void> {
    const { error } = await supabase
      .from('saved_clips')
      .delete()
      .eq('id', clipId);
    
    if (error) throw error;
  }
  
  async updateClipChatHistory(clipId: string, chatHistory: any[]): Promise<void> {
    const { error } = await supabase
      .from('saved_clips')
      .update({ chat_history: chatHistory })
      .eq('id', clipId);
    
    if (error) throw error;
  }
  
  // ==================== DAILY EDITIONS (CACHING) ====================
  
  async getCachedEdition(
    type: 'Morning' | 'Midday' | 'Evening',
    region: string,
    language: string
  ): Promise<DailyEdition | null> {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_type', type)
      .eq('region', region)
      .eq('language', language)
      .eq('date', today)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  }
  
  async cacheEdition(
    type: 'Morning' | 'Midday' | 'Evening',
    region: string,
    language: string,
    content: string,
    script: string,
    metadata: {
      audioUrl?: string;
      imageUrl?: string;
      groundingLinks?: any[];
      flashSummary?: string;
    }
  ): Promise<DailyEdition> {
    const today = new Date().toISOString().split('T')[0];
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6); // Cache for 6 hours
    
    const { data, error } = await supabase
      .from('daily_editions')
      .upsert({
        edition_type: type,
        region,
        language,
        date: today,
        content,
        script,
        audio_url: metadata.audioUrl,
        image_url: metadata.imageUrl,
        grounding_links: metadata.groundingLinks || [],
        flash_summary: metadata.flashSummary,
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: 'edition_type,region,language,date'
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  // ==================== ANALYTICS ====================
  
  async logUsage(
    userId: string,
    actionType: string,
    metadata?: Record<string, any>,
    costEstimate?: number
  ): Promise<void> {
    await supabase
      .from('usage_analytics')
      .insert({
        user_id: userId,
        action_type: actionType,
        metadata: metadata || {},
        cost_estimate: costEstimate,
      });
  }
  
  async getUserAnalytics(userId: string, days: number = 30): Promise<any[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const { data, error } = await supabase
      .from('usage_analytics')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }
}

export const db = new DatabaseService();

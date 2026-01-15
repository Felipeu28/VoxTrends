import { supabase } from './supabase';
import type { User, SavedClip, DailyEdition, UsageAnalytic } from './supabase';

export class DatabaseService {
  // ==================== USER MANAGEMENT ====================
  
  /**
   * Create a new user profile in the database
   */
  async createUser(userId: string, email: string, name: string, avatarUrl?: string): Promise<User> {
    try {
      const { data, error } = await supabase
        .from('users')
        .insert({
          id: userId,
          email,
          name,
          avatar_url: avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
          plan: 'Free',
          region: 'Global',
          language: 'English',
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Create user error:', error);
      throw new Error('Failed to create user profile');
    }
  }
  
  /**
   * Get user profile by ID
   */
  async getUser(userId: string): Promise<User | null> {
    try {
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
    } catch (error) {
      console.error('Get user error:', error);
      return null;
    }
  }
  
  /**
   * Update user profile
   */
  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    try {
      const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Update user error:', error);
      throw new Error('Failed to update user profile');
    }
  }
  
  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string): Promise<void> {
    try {
      await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', userId);
    } catch (error) {
      console.error('Update last login error:', error);
    }
  }
  
  // ==================== SAVED CLIPS ====================
  
  /**
   * Save a new clip to user's vault
   */
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
    try {
      const { data, error } = await supabase
        .from('saved_clips')
        .insert({
          user_id: userId,
          title,
          clip_type: type,
          content,
          flash_summary: metadata?.flashSummary || null,
          audio_url: metadata?.audioUrl || null,
          image_url: metadata?.imageUrl || null,
          chat_history: metadata?.chatHistory || [],
          metadata: metadata?.other || {},
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Save clip error:', error);
      throw new Error('Failed to save clip to vault');
    }
  }
  
  /**
   * Get all clips for a user
   */
  async getUserClips(userId: string): Promise<SavedClip[]> {
    try {
      const { data, error } = await supabase
        .from('saved_clips')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Get user clips error:', error);
      return [];
    }
  }
  
  /**
   * Delete a clip
   */
  async deleteClip(clipId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('saved_clips')
        .delete()
        .eq('id', clipId);
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Delete clip error:', error);
      throw new Error('Failed to delete clip');
    }
  }
  
  /**
   * Update clip's chat history
   */
  async updateClipChatHistory(clipId: string, chatHistory: any[]): Promise<void> {
    try {
      const { error } = await supabase
        .from('saved_clips')
        .update({ chat_history: chatHistory })
        .eq('id', clipId);
      
      if (error) throw error;
    } catch (error) {
      console.error('Update chat history error:', error);
    }
  }
  
  // ==================== DAILY EDITIONS (CACHING) ====================
  
  /**
   * Get cached edition if available and not expired
   */
  async getCachedEdition(
    type: 'Morning' | 'Midday' | 'Evening',
    region: string,
    language: string
  ): Promise<DailyEdition | null> {
    try {
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
    } catch (error) {
      console.error('Get cached edition error:', error);
      return null;
    }
  }
  
  /**
   * Cache a generated edition
   */
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
    try {
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
          audio_url: metadata.audioUrl || null,
          image_url: metadata.imageUrl || null,
          grounding_links: metadata.groundingLinks || [],
          flash_summary: metadata.flashSummary || null,
          expires_at: expiresAt.toISOString(),
        }, {
          onConflict: 'edition_type,region,language,date'
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Cache edition error:', error);
      throw new Error('Failed to cache edition');
    }
  }
  
  // ==================== ANALYTICS ====================
  
  /**
   * Log a usage event for analytics
   */
  async logUsage(
    userId: string,
    actionType: string,
    metadata?: Record<string, any>,
    costEstimate?: number
  ): Promise<void> {
    try {
      await supabase
        .from('usage_analytics')
        .insert({
          user_id: userId,
          action_type: actionType,
          metadata: metadata || {},
          cost_estimate: costEstimate || null,
        });
    } catch (error) {
      console.error('Log usage error:', error);
      // Don't throw - analytics failures shouldn't break the app
    }
  }
  
  /**
   * Get user's analytics for the past N days
   */
  async getUserAnalytics(userId: string, days: number = 30): Promise<UsageAnalytic[]> {
    try {
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
    } catch (error) {
      console.error('Get user analytics error:', error);
      return [];
    }
  }
}

// Export singleton instance
export const db = new DatabaseService();

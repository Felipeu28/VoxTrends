import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Type definitions
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  plan: 'Free' | 'Pro';
  region: string;
  language: string;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  preferences: Record<string, any>;
}

export interface SavedClip {
  id: string;
  user_id: string;
  title: string;
  clip_type: 'Daily' | 'Research';
  content: string;
  flash_summary: string | null;
  audio_url: string | null;
  image_url: string | null;
  chat_history: any[];
  metadata: Record<string, any>;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailyEdition {
  id: string;
  edition_type: 'Morning' | 'Midday' | 'Evening';
  region: string;
  language: string;
  date: string;
  content: string;
  script: string;
  audio_url: string | null;
  image_url: string | null;
  grounding_links: any[];
  flash_summary: string | null;
  generated_at: string;
  expires_at: string | null;
}

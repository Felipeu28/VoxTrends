import { supabase } from './supabase';
import { db } from './database';
import type { User } from '@supabase/supabase-js';

export class AuthService {
  // Sign up with email/password
  async signUp(email: string, password: string, name: string): Promise<User> {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (authError) throw authError;
    if (!authData.user) throw new Error('No user returned from signup');
    
    // Create user profile in our database
    await db.createUser(email, name);
    
    return authData.user;
  }
  
  // Sign in with email/password
  async signIn(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) throw error;
    if (!data.user) throw new Error('No user returned from signin');
    
    // Update last login
    await db.updateLastLogin(data.user.id);
    
    return data.user;
  }
  
  // Sign in with Google OAuth
  async signInWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
    });
    
    if (error) throw error;
  }
  
  // Sign out
  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }
  
  // Get current user
  async getCurrentUser(): Promise<User | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }
  
  // Listen to auth state changes
  onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(session?.user || null);
    });
  }
}

export const auth = new AuthService();

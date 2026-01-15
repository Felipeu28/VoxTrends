import { supabase } from './supabase';
import { db } from './database';
import type { User } from '@supabase/supabase-js';

export class AuthService {
  /**
   * Sign up a new user with email and password
   */
  async signUp(email: string, password: string, name: string): Promise<User> {
    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name,
          },
        },
      });
      
      if (authError) throw authError;
      if (!authData.user) throw new Error('No user returned from signup');
      
      // Create user profile in our database
      await db.createUser(authData.user.id, email, name);
      
      return authData.user;
    } catch (error: any) {
      console.error('Signup error:', error);
      throw new Error(error.message || 'Failed to sign up. Please try again.');
    }
  }
  
  /**
   * Sign in existing user with email and password
   */
  async signIn(email: string, password: string): Promise<User> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      if (!data.user) throw new Error('No user returned from signin');
      
      // Update last login timestamp
      await db.updateLastLogin(data.user.id);
      
      return data.user;
    } catch (error: any) {
      console.error('Signin error:', error);
      throw new Error(error.message || 'Failed to sign in. Please check your credentials.');
    }
  }
  
  /**
   * Sign in with Google OAuth
   */
  async signInWithGoogle(): Promise<void> {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Google OAuth error:', error);
      throw new Error('Failed to sign in with Google. Please try again.');
    }
  }
  
  /**
   * Sign out current user
   */
  async signOut(): Promise<void> {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error: any) {
      console.error('Signout error:', error);
      throw new Error('Failed to sign out. Please try again.');
    }
  }
  
  /**
   * Get currently authenticated user
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } catch (error) {
      console.error('Get current user error:', error);
      return null;
    }
  }
  
  /**
   * Listen to authentication state changes
   */
  onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(session?.user || null);
    });
  }
  
  /**
   * Reset password (send reset email)
   */
  async resetPassword(email: string): Promise<void> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Reset password error:', error);
      throw new Error('Failed to send reset email. Please try again.');
    }
  }
  
  /**
   * Update user password
   */
  async updatePassword(newPassword: string): Promise<void> {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Update password error:', error);
      throw new Error('Failed to update password. Please try again.');
    }
  }
}

// Export singleton instance
export const auth = new AuthService();

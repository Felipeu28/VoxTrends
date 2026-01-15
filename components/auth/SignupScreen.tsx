import React, { useState } from 'react';
import { auth } from '../../services/auth';
import { ICONS } from '../../constants';

interface Props {
  onSwitchToLogin: () => void;
}

const SignupScreen: React.FC<Props> = ({ onSwitchToLogin }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Validation
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    try {
      await auth.signUp(email, password, name);
      setSuccess(true);
      // Auth state change will trigger app reload
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setError(null);
    setLoading(true);

    try {
      await auth.signInWithGoogle();
      // User will be redirected to Google
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mb-6 mx-auto">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-3xl font-serif font-bold mb-3">Account Created!</h2>
          <p className="text-zinc-400 mb-8">
            Welcome to VoxTrends. You're all set to start listening.
          </p>
          <button
            onClick={onSwitchToLogin}
            className="px-8 py-4 bg-white text-black font-black rounded-2xl hover:bg-violet-600 hover:text-white transition-all"
          >
            GO TO LOGIN
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-12 animate-in fade-in duration-700">
          <div className="w-20 h-20 bg-violet-600 rounded-[2rem] flex items-center justify-center mb-6 mx-auto shadow-2xl shadow-violet-600/30">
            <ICONS.Podcast className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-serif font-bold mb-3">Join VoxTrends</h1>
          <p className="text-zinc-500">Create your account to get started</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm animate-in slide-in-from-top">
            {error}
          </div>
        )}

        {/* Signup Form */}
        <form onSubmit={handleSignup} className="space-y-5 mb-6">
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 block">
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-6 text-white placeholder-zinc-600 focus:outline-none focus:border-violet-600 transition-colors"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 block">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-6 text-white placeholder-zinc-600 focus:outline-none focus:border-violet-600 transition-colors"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 block">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-6 text-white placeholder-zinc-600 focus:outline-none focus:border-violet-600 transition-colors"
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-white text-black font-black rounded-2xl hover:bg-violet-600 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-zinc-800"></div>
          <span className="text-xs text-zinc-600 font-bold uppercase">Or</span>
          <div className="flex-1 h-px bg-zinc-800"></div>
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogleSignup}
          disabled={loading}
          className="w-full py-4 bg-zinc-900 border border-zinc-800 text-white font-bold rounded-2xl hover:border-violet-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Switch to Login */}
        <div className="mt-8 text-center">
          <p className="text-zinc-500">
            Already have an account?{' '}
            <button
              onClick={onSwitchToLogin}
              className="text-violet-400 hover:text-violet-300 font-bold transition-colors"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignupScreen;

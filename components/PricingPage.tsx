import React, { useState } from 'react';
import { backend } from '../services/backend';
import { ICONS } from '../constants';

interface Props {
  onClose: () => void;
  userPlan: 'Free' | 'Pro';
}

const PricingPage: React.FC<Props> = ({ onClose, userPlan }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stripe Price ID from your Stripe dashboard
  const STRIPE_PRICE_ID = 'price_1St5ssAfs41lV9gZ38wCKYlr';

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);

    try {
      const { url } = await backend.createCheckoutSession(STRIPE_PRICE_ID);
      
      if (url) {
        // Redirect to Stripe checkout
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      setError(err.message || 'Failed to start checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in">
      <div className="w-full max-w-4xl bg-zinc-950 border-2 border-violet-600 rounded-[3rem] p-10 md:p-16 relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 bg-zinc-900 rounded-lg text-zinc-500 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-serif font-bold mb-4">Upgrade to Pro</h2>
          <p className="text-zinc-400 text-lg">Unlimited everything. Cancel anytime.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Free Plan */}
          <div className="p-8 bg-zinc-900/50 border border-zinc-800 rounded-3xl">
            <h3 className="text-2xl font-bold mb-2">Free</h3>
            <p className="text-4xl font-black text-zinc-500 mb-6">$0<span className="text-lg font-normal">/mo</span></p>
            
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-zinc-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-zinc-400">3 daily editions</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-zinc-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-zinc-400">2 research queries per day</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-zinc-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-zinc-400">Global region only</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-zinc-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-zinc-400">English only</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-zinc-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-zinc-400">10 saved items max</span>
              </li>
            </ul>

            {userPlan === 'Free' && (
              <div className="mt-6 py-3 bg-zinc-800 rounded-xl text-center text-sm font-bold text-zinc-500">
                Current Plan
              </div>
            )}
          </div>

          {/* Pro Plan */}
          <div className="p-8 bg-gradient-to-br from-violet-600/20 to-purple-600/20 border-2 border-violet-600 rounded-3xl relative overflow-hidden">
            <div className="absolute top-4 right-4 px-3 py-1 bg-violet-600 rounded-lg text-xs font-black uppercase tracking-wider">
              Popular
            </div>

            <h3 className="text-2xl font-bold mb-2">Pro</h3>
            <p className="text-4xl font-black text-white mb-6">$5<span className="text-lg font-normal">/mo</span></p>
            
            <ul className="space-y-3 text-sm mb-8">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-white"><strong>Unlimited</strong> daily editions</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-white"><strong>Unlimited</strong> research queries</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-white"><strong>All regions</strong> (USA, Colombia, Spain, etc.)</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-white"><strong>All languages</strong> (English, Spanish)</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-white"><strong>Unlimited</strong> vault storage</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-white">PDF export & priority support</span>
              </li>
            </ul>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            {userPlan === 'Pro' ? (
              <div className="py-4 bg-emerald-600 rounded-2xl text-center font-black uppercase tracking-wider">
                Current Plan ✓
              </div>
            ) : (
              <button
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full py-4 bg-white text-black rounded-2xl font-black uppercase tracking-wider hover:bg-violet-600 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl"
              >
                {loading ? 'Loading...' : 'Upgrade Now'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-sm text-zinc-600">
          💳 Secure payment with Stripe • Cancel anytime • No hidden fees
        </p>
      </div>
    </div>
  );
};

export default PricingPage;

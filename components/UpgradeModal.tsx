import React from 'react';
import { ICONS } from '../constants';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  feature: 'editions' | 'research' | 'vault' | 'region' | 'language';
  onUpgrade: () => void;
}

const UpgradeModal: React.FC<Props> = ({ isOpen, onClose, feature, onUpgrade }) => {
  if (!isOpen) return null;

  const messages = {
    editions: {
      icon: '🎙️',
      title: 'Daily Edition Limit Reached',
      description: "You've generated all 3 editions for today. Upgrade to Pro for unlimited daily editions across all regions and languages.",
    },
    research: {
      icon: '🔬',
      title: 'Research Query Limit Reached',
      description: "You've used all 2 research queries for today. Upgrade to Pro for unlimited deep-dive research on any topic.",
    },
    vault: {
      icon: '🗂️',
      title: 'Vault Storage Full',
      description: "You've saved 10 items in your vault. Delete old items or upgrade to Pro for unlimited vault storage.",
    },
    region: {
      icon: '🌍',
      title: 'Region Locked',
      description: 'Free users can only access Global news. Upgrade to Pro to unlock all regions including USA, Colombia, Spain, Mexico, and Venezuela.',
    },
    language: {
      icon: '🗣️',
      title: 'Language Locked',
      description: 'Free users can only access English content. Upgrade to Pro to unlock Spanish and all future languages.',
    },
  };

  const msg = messages[feature];

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-[300] p-6 animate-in fade-in">
      <div className="bg-zinc-950 border-2 border-violet-600 rounded-3xl p-8 md:p-10 max-w-lg w-full relative animate-in slide-in-from-bottom duration-500">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-zinc-900 rounded-lg text-zinc-500 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Icon */}
        <div className="w-20 h-20 bg-gradient-to-br from-violet-600 to-purple-600 rounded-2xl flex items-center justify-center mb-6 mx-auto text-4xl">
          {msg.icon}
        </div>

        {/* Title */}
        <h3 className="text-2xl md:text-3xl font-serif font-bold text-center mb-4 text-white">
          {msg.title}
        </h3>

        {/* Description */}
        <p className="text-zinc-400 text-center mb-8 leading-relaxed">
          {msg.description}
        </p>

        {/* Pro Features */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-lg">VoxTrends Pro</h4>
            <div className="text-right">
              <p className="text-3xl font-black text-violet-400">$5</p>
              <p className="text-xs text-zinc-500">per month</p>
            </div>
          </div>

          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Unlimited</strong> daily editions</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Unlimited</strong> research queries</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">All regions</strong> (USA, Colombia, Spain, etc.)</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Multiple languages</strong> (English, Spanish)</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Unlimited</strong> vault storage</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>PDF export & priority queue</span>
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={onUpgrade}
            className="w-full py-4 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-2xl font-black text-base hover:from-violet-700 hover:to-purple-700 transition-all shadow-xl"
          >
            Upgrade to Pro - $5/month
          </button>

          <button
            onClick={onClose}
            className="w-full py-4 bg-zinc-900 text-zinc-400 rounded-2xl font-bold text-sm hover:text-white transition-all"
          >
            Maybe Later
          </button>
        </div>

        {/* Trust badge */}
        <p className="text-center text-xs text-zinc-600 mt-4">
          💳 Secure payment with Stripe • Cancel anytime
        </p>
      </div>
    </div>
  );
};

export default UpgradeModal;

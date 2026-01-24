import React, { useState, useEffect } from 'react';
import { backend } from '../services/backend';
import { useNavigate } from 'react-router-dom';

interface QuotaData {
  editions: {
    used: number;
    limit: number;
    remaining: number;
  };
  research: {
    used: number;
    limit: number;
    remaining: number;
  };
}

interface Props {
  userPlan: 'Free' | 'Pro';
  onUpdate?: () => void;
}

const QuotaDisplay: React.FC<Props> = ({ userPlan, onUpdate }) => {
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchQuota = async () => {
    try {
      setLoading(true);
      const data = await backend.getUserQuota();
      setQuota(data);
    } catch (error) {
      console.error('Failed to fetch quota:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, [onUpdate]);

  // Don't show for Pro users
  if (userPlan === 'Pro') return null;

  if (loading) {
    return (
      <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-20 mb-3"></div>
        <div className="space-y-2">
          <div className="h-2 bg-zinc-800 rounded"></div>
          <div className="h-2 bg-zinc-800 rounded"></div>
        </div>
      </div>
    );
  }

  if (!quota) return null;

  const editionsPercent = (quota.editions.used / quota.editions.limit) * 100;
  const researchPercent = (quota.research.used / quota.research.limit) * 100;

  return (
    <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
      <p className="text-xs text-zinc-500 mb-3 font-bold uppercase tracking-widest">
        Today's Usage
      </p>

      <div className="space-y-3">
        {/* Editions */}
        <div>
          <div className="flex justify-between items-center text-xs mb-1.5">
            <span className="text-zinc-400">Daily Editions</span>
            <span className={`font-bold ${quota.editions.remaining === 0 ? 'text-red-400' : 'text-violet-400'}`}>
              {quota.editions.used}/{quota.editions.limit}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${
                quota.editions.remaining === 0 ? 'bg-red-500' : 'bg-violet-600'
              }`}
              style={{ width: `${editionsPercent}%` }}
            />
          </div>
        </div>

        {/* Research */}
        <div>
          <div className="flex justify-between items-center text-xs mb-1.5">
            <span className="text-zinc-400">Research Queries</span>
            <span className={`font-bold ${quota.research.remaining === 0 ? 'text-red-400' : 'text-violet-400'}`}>
              {quota.research.used}/{quota.research.limit}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${
                quota.research.remaining === 0 ? 'bg-red-500' : 'bg-violet-600'
              }`}
              style={{ width: `${researchPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Upgrade prompt if at limit */}
      {(quota.editions.remaining === 0 || quota.research.remaining === 0) && (
        <button
          onClick={() => navigate('/pricing')}
          className="w-full mt-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:from-violet-700 hover:to-purple-700 transition-all shadow-lg"
        >
          Upgrade for Unlimited →
        </button>
      )}
    </div>
  );
};

export default QuotaDisplay;

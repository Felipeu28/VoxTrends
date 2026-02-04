import React from 'react';
import { ICONS } from '../constants';
import { EditionType } from '../types';

interface BroadcastTunerProps {
    region: string;
    language: string;
    activeEdition: EditionType;
    onRegionChange: (region: string) => void;
    onLanguageChange: (language: string) => void;
    onEditionChange: (edition: EditionType) => void;
    onRefresh: () => void;
    loading: boolean;
}

const REGIONS = [
    { id: 'Global', label: 'Global 🌎' },
    { id: 'USA', label: 'USA 🇺🇸' },
    { id: 'Europe', label: 'Europe 🇪🇺' },
    { id: 'Asia', label: 'Asia 🌏' },
    { id: 'Colombia', label: 'Colombia 🇨🇴' },
    { id: 'Venezuela', label: 'Venezuela 🇻🇪' },
];

const LANGUAGES = [
    { id: 'English', label: 'English 🇬🇧' },
    { id: 'Spanish', label: 'Spanish 🇪🇸' },
];

const EDITIONS = [EditionType.MORNING, EditionType.MIDDAY, EditionType.EVENING];

const BroadcastTuner: React.FC<BroadcastTunerProps> = ({
    region,
    language,
    activeEdition,
    onRegionChange,
    onLanguageChange,
    onEditionChange,
    onRefresh,
    loading
}) => {
    return (
        <div className="bg-zinc-950/50 backdrop-blur-xl border-b border-zinc-800 p-4 md:p-6 sticky top-0 z-40 animate-in slide-in-from-top duration-500">
            <div className="max-w-5xl mx-auto flex flex-col gap-4">

                {/* Top Row: Frequency/Edition Selectors */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient-right">
                        {EDITIONS.map((ed) => (
                            <button
                                key={ed}
                                onClick={() => onEditionChange(ed)}
                                className={`
                  relative px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
                  ${activeEdition === ed
                                        ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25 scale-105'
                                        : 'bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                                    }
                `}
                            >
                                {ed}
                                {activeEdition === ed && (
                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border-2 border-zinc-950" />
                                )}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={onRefresh}
                        disabled={loading}
                        title="Refresh Edition (Uses 1 Credit)"
                        className={`
              p-2.5 rounded-xl border transition-all
              ${loading
                                ? 'bg-violet-600/20 border-violet-600/30 text-violet-400 cursor-wait'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600'
                            }
            `}
                    >
                        <svg
                            className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                {/* Bottom Row: Region & Language Tuners */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="relative group">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-600 uppercase tracking-widest pointer-events-none group-hover:text-violet-500 transition-colors">
                            Region
                        </span>
                        <select
                            value={region}
                            onChange={(e) => onRegionChange(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-20 pr-8 text-sm font-bold text-white appearance-none cursor-pointer hover:border-violet-600/50 focus:border-violet-600 focus:ring-1 focus:ring-violet-600 outline-none transition-all"
                            style={{ backgroundImage: 'none' }}
                        >
                            {REGIONS.map(r => (
                                <option key={r.id} value={r.id}>{r.label}</option>
                            ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>

                    <div className="relative group">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-600 uppercase tracking-widest pointer-events-none group-hover:text-violet-500 transition-colors">
                            Lang
                        </span>
                        <select
                            value={language}
                            onChange={(e) => onLanguageChange(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-16 pr-8 text-sm font-bold text-white appearance-none cursor-pointer hover:border-violet-600/50 focus:border-violet-600 focus:ring-1 focus:ring-violet-600 outline-none transition-all"
                            style={{ backgroundImage: 'none' }}
                        >
                            {LANGUAGES.map(l => (
                                <option key={l.id} value={l.id}>{l.label}</option>
                            ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BroadcastTuner;

'use client';

import { useState } from 'react';
import { backend } from '../services/backend';

interface VoiceProfile {
  id: 'originals' | 'deep-divers' | 'trendspotters';
  label: string;
  emoji: string;
  vibe: string;
}

const VOICE_PROFILES: VoiceProfile[] = [
  { id: 'originals', label: 'The Originals', emoji: '🎙️', vibe: 'Dynamic & energetic' },
  { id: 'deep-divers', label: 'The Deep-Divers', emoji: '🔍', vibe: 'Thoughtful & analytical' },
  { id: 'trendspotters', label: 'The Trendspotters', emoji: '⚡', vibe: 'Fresh & forward-looking' },
];

interface VoiceSelectorProps {
  editionId: string;
  isScriptReady: boolean;
  onAudioGenerated?: (voiceId: string, audioUrl: string) => void;
}

export default function VoiceSelector({
  editionId,
  isScriptReady,
  onAudioGenerated,
}: VoiceSelectorProps) {
  const [selected, setSelected] = useState<string>('originals');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const result = await backend.generateVoiceVariant(editionId, selected);

      const audioUrl = result.data?.audio;
      if (!audioUrl) throw new Error('No audio returned');

      onAudioGenerated?.(selected, audioUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate audio');
    } finally {
      setGenerating(false);
    }
  };

  if (!isScriptReady) return null;

  const activeProfile = VOICE_PROFILES.find(p => p.id === selected);

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap gap-2.5">
        {VOICE_PROFILES.map((profile) => (
          <button
            key={profile.id}
            onClick={() => { setSelected(profile.id); setError(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all duration-200 text-sm font-semibold ${
              selected === profile.id
                ? 'bg-violet-600/20 border-violet-600 text-violet-300'
                : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            <span>{profile.emoji}</span>
            <span>{profile.label}</span>
          </button>
        ))}
      </div>

      <p className="text-zinc-500 text-[13px]">{activeProfile?.vibe}</p>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 text-red-300 px-4 py-2.5 rounded-xl text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={generating}
        className="px-7 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-full font-black text-sm transition-all duration-200 flex items-center gap-2 hover:shadow-lg hover:shadow-violet-600/40 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {generating ? (
          <>
            <span className="inline-block w-3.5 h-3.5 border-2 border-violet-200 border-t-transparent rounded-full animate-spin" />
            Generating...
          </>
        ) : (
          <>🎵 Generate Audio</>
        )}
      </button>
    </div>
  );
}

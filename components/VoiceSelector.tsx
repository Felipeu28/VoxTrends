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
  {
    id: 'originals',
    label: 'The Originals',
    emoji: '🎙️',
    vibe: 'Dynamic & energetic'
  },
  {
    id: 'deep-divers',
    label: 'The Deep-Divers',
    emoji: '🔍',
    vibe: 'Thoughtful & analytical'
  },
  {
    id: 'trendspotters',
    label: 'The Trendspotters',
    emoji: '⚡',
    vibe: 'Fresh & forward-looking'
  }
];

interface VoiceSelectorProps {
  editionId: string;
  isScriptReady: boolean;
  editionType: 'Morning' | 'Midday' | 'Evening';
  region: string;
  language: string;
  onAudioGenerated?: (voiceId: string, audioUrl: string) => void;
}

export default function VoiceSelector({
  editionId,
  isScriptReady,
  editionType,
  region,
  language,
  onAudioGenerated,
}: VoiceSelectorProps) {
  const [generatingVoice, setGeneratingVoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAudio, setGeneratedAudio] = useState<Record<string, string>>({});

  const handleGenerateAudio = async (voiceId: string) => {
    setGeneratingVoice(voiceId);
    setError(null);

    try {
      const result = await backend.generateEdition(
        editionType,
        region,
        language,
        false,
        voiceId,
        true
      );

      const audioUrl = result.data?.audio;

      if (!audioUrl) {
        throw new Error('No audio URL returned from generation');
      }

      setGeneratedAudio((prev) => ({
        ...prev,
        [voiceId]: audioUrl,
      }));

      if (onAudioGenerated) {
        onAudioGenerated(voiceId, audioUrl);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate audio'
      );
    } finally {
      setGeneratingVoice(null);
    }
  };

  if (!isScriptReady) {
    return null;
  }

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h3 className="text-sm font-black uppercase tracking-widest text-violet-500">Choose Your Voice</h3>
        <p className="text-zinc-400 text-sm">Select a voice profile to generate audio with your preferred personality</p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 text-red-300 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Voice Profile Cards - Full Width Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {VOICE_PROFILES.map((profile) => {
          const isGenerating = generatingVoice === profile.id;
          const isGenerated = profile.id in generatedAudio;

          return (
            <div
              key={profile.id}
              className="group bg-gradient-to-br from-zinc-800/40 to-zinc-900/40 border border-zinc-800 hover:border-violet-600/50 rounded-2xl p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-violet-600/20 hover:bg-gradient-to-br hover:from-zinc-800/60 hover:to-zinc-900/60"
            >
              {/* Emoji Icon */}
              <div className="text-6xl mb-4 group-hover:scale-110 transition-transform duration-300">
                {profile.emoji}
              </div>

              {/* Name */}
              <h4 className="text-lg font-black text-white mb-2">
                {profile.label}
              </h4>

              {/* Vibe */}
              <p className="text-sm text-zinc-400 mb-5">
                {profile.vibe}
              </p>

              {/* Action Button */}
              {isGenerated ? (
                <button
                  disabled
                  className="w-full px-4 py-3 bg-emerald-600/20 border border-emerald-600/50 text-emerald-400 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition"
                >
                  ✓ Ready
                </button>
              ) : isGenerating ? (
                <button
                  disabled
                  className="w-full px-4 py-3 bg-violet-600/30 border border-violet-600/50 text-violet-300 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition"
                >
                  <span className="inline-block animate-spin">⏳</span>
                </button>
              ) : (
                <button
                  onClick={() => handleGenerateAudio(profile.id)}
                  className="w-full px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-black text-sm transition-all duration-200 flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-violet-600/50"
                >
                  🎵 Generate
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Audio Players Section */}
      {Object.keys(generatedAudio).length > 0 && (
        <div className="border-t border-zinc-800 pt-6 space-y-4">
          <h4 className="text-sm font-black uppercase tracking-widest text-zinc-500">Generated Audio</h4>
          <div className="space-y-3">
            {VOICE_PROFILES.map((profile) => {
              if (!generatedAudio[profile.id]) return null;

              return (
                <div key={profile.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                  <div className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <span className="text-2xl">{profile.emoji}</span>
                    {profile.label}
                  </div>
                  <audio
                    controls
                    src={generatedAudio[profile.id]}
                    className="w-full h-8"
                    autoPlay={Object.keys(generatedAudio).length === 1}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

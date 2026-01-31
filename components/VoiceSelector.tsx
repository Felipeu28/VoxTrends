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
    <div className="w-full">
      {/* Elegant Floating Popover */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300">
        {/* Header - Minimal */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <span>🎙️</span>
            Choose Your Voice
          </h2>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-200 px-3 py-2 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {/* Voice Profile Cards - 3 in a row, sleek and minimal */}
        <div className="grid grid-cols-3 gap-3">
          {VOICE_PROFILES.map((profile) => {
            const isGenerating = generatingVoice === profile.id;
            const isGenerated = profile.id in generatedAudio;

            return (
              <div
                key={profile.id}
                className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-lg p-4 hover:border-purple-500 transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/20"
              >
                {/* Emoji Icon */}
                <div className="text-3xl mb-2">{profile.emoji}</div>

                {/* Name */}
                <h3 className="text-sm font-semibold text-white mb-1 line-clamp-1">
                  {profile.label}
                </h3>

                {/* One-line vibe */}
                <p className="text-xs text-gray-400 mb-3 line-clamp-1">
                  {profile.vibe}
                </p>

                {/* Action Button */}
                {isGenerated ? (
                  <button
                    disabled
                    className="w-full px-3 py-2 bg-green-900 text-green-200 rounded-lg font-medium text-xs flex items-center justify-center gap-1 transition"
                  >
                    ✓ Ready
                  </button>
                ) : isGenerating ? (
                  <button
                    disabled
                    className="w-full px-3 py-2 bg-purple-900/50 text-purple-200 rounded-lg font-medium text-xs flex items-center justify-center gap-1 transition"
                  >
                    <span className="inline-block animate-spin text-lg">⏳</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleGenerateAudio(profile.id)}
                    className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium text-xs transition-colors duration-200 flex items-center justify-center gap-1"
                  >
                    Generate
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Audio Player - appears only when audio is generated */}
        {Object.keys(generatedAudio).length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="space-y-2">
              {VOICE_PROFILES.map((profile) => {
                if (!generatedAudio[profile.id]) return null;

                return (
                  <div key={profile.id} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 min-w-20">
                      {profile.emoji} {profile.label.split(' ').pop()}
                    </span>
                    <audio
                      controls
                      src={generatedAudio[profile.id]}
                      className="flex-1 h-6 rounded"
                      autoPlay={Object.keys(generatedAudio).length === 1}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

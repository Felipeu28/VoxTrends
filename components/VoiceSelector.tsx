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
      {/* Beautiful Floating Popover - Readable & Elegant */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="text-4xl">🎙️</span>
            Choose Your Voice
          </h2>
          <p className="text-gray-400 text-sm mt-2">Select a voice profile to generate audio</p>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-200 px-4 py-3 rounded-lg text-sm mb-6">
            {error}
          </div>
        )}

        {/* Voice Profile Cards - Readable & Spacious */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {VOICE_PROFILES.map((profile) => {
            const isGenerating = generatingVoice === profile.id;
            const isGenerated = profile.id in generatedAudio;

            return (
              <div
                key={profile.id}
                className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 hover:border-purple-500 rounded-xl p-5 transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/30"
              >
                {/* Emoji Icon */}
                <div className="text-5xl mb-3">{profile.emoji}</div>

                {/* Name - Full text, readable */}
                <h3 className="text-lg font-bold text-white mb-2">
                  {profile.label}
                </h3>

                {/* Vibe - Readable size */}
                <p className="text-sm text-gray-300 mb-4">
                  {profile.vibe}
                </p>

                {/* Action Button */}
                {isGenerated ? (
                  <button
                    disabled
                    className="w-full px-4 py-3 bg-green-900 text-green-200 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition"
                  >
                    ✓ Ready
                  </button>
                ) : isGenerating ? (
                  <button
                    disabled
                    className="w-full px-4 py-3 bg-purple-900/60 text-purple-200 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition"
                  >
                    <span className="inline-block animate-spin text-xl">⏳</span>
                    Generating...
                  </button>
                ) : (
                  <button
                    onClick={() => handleGenerateAudio(profile.id)}
                    className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold text-sm transition-colors duration-200 flex items-center justify-center gap-2"
                  >
                    🎵 Generate
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Audio Players - Appears when audio is generated */}
        {Object.keys(generatedAudio).length > 0 && (
          <div className="border-t border-gray-800 pt-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Your Audio:</h3>
            <div className="space-y-3">
              {VOICE_PROFILES.map((profile) => {
                if (!generatedAudio[profile.id]) return null;

                return (
                  <div key={profile.id} className="bg-gray-800 rounded-lg p-3">
                    <div className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
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
    </div>
  );
}

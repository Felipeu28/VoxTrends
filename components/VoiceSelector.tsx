'use client';

import { useState } from 'react';
import { backend } from '../services/backend';

interface VoiceProfile {
  id: 'originals' | 'deep-divers' | 'trendspotters';
  label: string;
  description: string;
  hosts: {
    lead: string;
    expert: string;
  };
}

const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: 'originals',
    label: 'The Originals',
    description: 'Joe & Jane - Dynamic, energetic hosts',
    hosts: { lead: 'Joe', expert: 'Jane' }
  },
  {
    id: 'deep-divers',
    label: 'The Deep-Divers',
    description: 'David & Sarah - Thoughtful, analytical',
    hosts: { lead: 'David', expert: 'Sarah' }
  },
  {
    id: 'trendspotters',
    label: 'The Trendspotters',
    description: 'Leo & Maya - Cutting-edge, future-focused',
    hosts: { lead: 'Leo', expert: 'Maya' }
  }
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
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [generatingVoice, setGeneratingVoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAudio, setGeneratedAudio] = useState<Record<string, string>>({});

  const handleGenerateAudio = async (voiceId: string) => {
    setGeneratingVoice(voiceId);
    setError(null);

    try {
      // Call generate-edition with generateAudio flag to generate audio in one call
      const result = await backend.generateEdition(
        'Morning',  // These aren't used since we're regenerating, but required for API
        'Global',
        'English',
        false,      // forceRefresh
        voiceId,    // voiceId to use for this variant
        // New parameter - tell generate-edition to generate audio
        true        // generateAudio flag
      );

      const audioUrl = result.data?.audio;

      if (!audioUrl) {
        throw new Error('No audio URL returned from generation');
      }

      setGeneratedAudio((prev) => ({
        ...prev,
        [voiceId]: audioUrl,
      }));
      setSelectedVoice(voiceId);

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
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🎤</span>
          <h2 className="text-xl font-semibold text-gray-900">
            Choose Your Hosts
          </h2>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          Select a voice profile to generate audio with your preferred hosts
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Voice Profile Cards */}
        <div className="space-y-3">
          {VOICE_PROFILES.map((profile) => {
            const isGenerating = generatingVoice === profile.id;
            const isGenerated = profile.id in generatedAudio;
            const isSelected = selectedVoice === profile.id;

            return (
              <div
                key={profile.id}
                className={`border rounded-lg p-4 cursor-pointer transition ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-indigo-300 hover:bg-white'
                } ${isGenerating ? 'opacity-75' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">
                      {profile.label}
                    </h3>
                    <p className="text-sm text-gray-600 mb-2">
                      {profile.description}
                    </p>
                    <div className="text-xs text-gray-500 space-y-1">
                      <p>
                        <span className="font-medium">Lead:</span>{' '}
                        {profile.hosts.lead}
                      </p>
                      <p>
                        <span className="font-medium">Expert:</span>{' '}
                        {profile.hosts.expert}
                      </p>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="flex-shrink-0 ml-4">
                    {isGenerated ? (
                      <button
                        disabled
                        className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-medium text-sm flex items-center gap-2"
                      >
                        ✓ Ready
                      </button>
                    ) : isGenerating ? (
                      <button
                        disabled
                        className="px-4 py-2 bg-gray-200 text-gray-600 rounded-lg font-medium text-sm flex items-center gap-2"
                      >
                        <span className="inline-block animate-spin">⏳</span>
                        Generating...
                      </button>
                    ) : (
                      <button
                        onClick={() => handleGenerateAudio(profile.id)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition"
                      >
                        🎵 Generate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Audio Player */}
        {selectedVoice && generatedAudio[selectedVoice] && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              ▶️ Now Playing
            </h4>
            <audio
              controls
              src={generatedAudio[selectedVoice]}
              className="w-full h-10"
              autoPlay
            />
          </div>
        )}

        {/* Info */}
        <div className="mt-6 bg-indigo-100 border border-indigo-300 rounded-lg p-3 text-sm text-indigo-900">
          <p className="font-medium mb-1">💡 Quick tip:</p>
          <p>
            Each voice profile has its own personality. Try different hosts to
            find your favorite way to consume news!
          </p>
        </div>
      </div>
    </div>
  );
}

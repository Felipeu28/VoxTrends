'use client';

import { useState, useEffect } from 'react';
import { backend } from '../services/backend';

interface Edition {
  id: string;
  content: string;
  script: string;
  image_url?: string;
  flash_summary?: string;
  grounding_links?: any[];
  voiceVariants?: {
    available: string[];
    count: number;
    audioUrls: Record<string, string>;
  };
}

interface SharedEditionPlayerProps {
  shareToken: string;
  edition: Edition;
  isLoggedIn?: boolean;
  onLoginRequired?: () => void;
}

const VOICE_PROFILES = {
  originals: {
    label: 'The Originals',
    description: 'Joe & Jane - Dynamic, energetic hosts',
  },
  'deep-divers': {
    label: 'The Deep-Divers',
    description: 'David & Sarah - Thoughtful, analytical',
  },
  trendspotters: {
    label: 'The Trendspotters',
    description: 'Leo & Maya - Cutting-edge, future-focused',
  },
};

export default function SharedEditionPlayer({
  shareToken,
  edition,
  isLoggedIn = false,
  onLoginRequired,
}: SharedEditionPlayerProps) {
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select first available variant
  useEffect(() => {
    if (
      edition.voiceVariants?.available &&
      edition.voiceVariants.available.length > 0 &&
      !selectedVariant
    ) {
      setSelectedVariant(edition.voiceVariants.available[0]);
    }
  }, [edition.voiceVariants, selectedVariant]);

  const handleGenerateVariant = async (voiceId: string) => {
    if (!isLoggedIn) {
      onLoginRequired?.();
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const result = await backend.generateVoiceVariant(edition.id, voiceId);

      if (!result.data?.audio_url) {
        throw new Error('No audio URL returned from generation');
      }

      setSelectedVariant(voiceId);
      // In a real app, update the edition state with new variant
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate audio'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const selectedAudio = selectedVariant
    ? edition.voiceVariants?.audioUrls[selectedVariant]
    : null;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Shared Edition</h1>
        <p className="text-gray-600">Curated news, professionally narrated</p>
      </div>

      {/* Featured Image */}
      {edition.image_url && (
        <img
          src={edition.image_url}
          alt="Edition cover"
          className="w-full h-64 object-cover rounded-lg shadow-lg"
        />
      )}

      {/* Flash Summary */}
      {edition.flash_summary && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-6 rounded">
          <h3 className="font-semibold text-gray-900 mb-2">Quick Summary</h3>
          <p className="text-gray-700 text-sm">{edition.flash_summary}</p>
        </div>
      )}

      {/* Voice Variants Selection */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Choose Your Narrator
        </h2>

        {edition.voiceVariants?.count === 0 && (
          <p className="text-gray-600 mb-4">
            No audio narration available yet. Try logging in to generate your
            preferred voice.
          </p>
        )}

        <div className="space-y-3">
          {Object.entries(VOICE_PROFILES).map(([voiceId, profile]) => {
            const isAvailable =
              edition.voiceVariants?.available.includes(voiceId);
            const isSelected = selectedVariant === voiceId;

            return (
              <div
                key={voiceId}
                className={`border rounded-lg p-4 transition cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-100'
                    : 'border-gray-200 hover:border-indigo-300 hover:bg-white'
                }`}
                onClick={() => isAvailable && setSelectedVariant(voiceId)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">
                      {profile.label}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {profile.description}
                    </p>
                  </div>

                  <div className="flex-shrink-0 ml-4">
                    {isAvailable ? (
                      <button
                        className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        <Play className="w-4 h-4" />
                        Ready
                      </button>
                    ) : (
                      <button
                        onClick={() => handleGenerateVariant(voiceId)}
                        disabled={isGenerating}
                        className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition ${
                          isGenerating
                            ? 'bg-gray-200 text-gray-600 cursor-not-allowed'
                            : isLoggedIn
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-200 text-gray-700 cursor-not-allowed'
                        }`}
                      >
                        {isGenerating ? (
                          <>
                            <Loader className="w-4 h-4 animate-spin" />
                            Generating...
                          </>
                        ) : isLoggedIn ? (
                          <>
                            <Play className="w-4 h-4" />
                            Generate
                          </>
                        ) : (
                          <>
                            <Lock className="w-4 h-4" />
                            Login to Generate
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            {error}
          </div>
        )}
      </div>

      {/* Audio Player */}
      {selectedAudio && (
        <div className="bg-gray-900 rounded-lg p-6">
          <h3 className="text-white font-semibold mb-4">Now Playing</h3>
          <audio
            controls
            src={selectedAudio}
            className="w-full"
            autoPlay
            style={{
              filter: 'invert(0.8)',
            }}
          />
        </div>
      )}

      {/* Full Content */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Full Briefing
          </h2>
          <div className="prose prose-lg max-w-none">
            <div
              className="text-gray-700 whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: edition.content }}
            />
          </div>
        </div>

        {/* Sources */}
        {edition.grounding_links && edition.grounding_links.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Sources
            </h3>
            <ul className="space-y-2">
              {edition.grounding_links.map((link, idx) => (
                <li key={idx}>
                  <a
                    href={link.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {link.title || link.uri}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="border-t border-gray-200 pt-6 text-center text-sm text-gray-600">
        <p>
          This edition has been shared with you via VoxTrends. No account
          required to listen.
        </p>
      </div>
    </div>
  );
}

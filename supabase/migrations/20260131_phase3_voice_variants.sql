-- Phase 3: Voice Variants - On-Demand Voice Generation
-- Separates content generation from voice generation for massive cost savings

-- Voice variants: Store generated audio for different voice profiles
-- One script → multiple voice variants (users choose which one to listen to)
CREATE TABLE IF NOT EXISTS voice_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES daily_editions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_id text NOT NULL CHECK (voice_id IN ('originals', 'deep-divers', 'trendspotters')),
  audio_url text NOT NULL,  -- Data URI or storage URL for generated audio
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  generation_time_ms integer,  -- How long TTS took
  cost_estimate decimal(10, 4) DEFAULT 0.05,  -- Cost of generating this variant

  UNIQUE(edition_id, voice_id)
);

-- Voice variant generation status (for tracking in-flight requests)
CREATE TABLE IF NOT EXISTS voice_variant_generation_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES daily_editions(id) ON DELETE CASCADE,
  voice_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'generating', 'success', 'failed')),
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  UNIQUE(edition_id, voice_id)
);

-- Track voice variant generation costs for analytics
CREATE TABLE IF NOT EXISTS voice_variant_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  edition_id uuid NOT NULL REFERENCES daily_editions(id) ON DELETE CASCADE,
  voice_id text NOT NULL,
  cost decimal(10, 4) NOT NULL DEFAULT 0.05,
  generated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_voice_variants_edition_id ON voice_variants(edition_id);
CREATE INDEX IF NOT EXISTS idx_voice_variants_user_id ON voice_variants(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_variants_voice_id ON voice_variants(voice_id);
CREATE INDEX IF NOT EXISTS idx_voice_variants_created_at ON voice_variants(created_at);

CREATE INDEX IF NOT EXISTS idx_variant_status_edition_id ON voice_variant_generation_status(edition_id);
CREATE INDEX IF NOT EXISTS idx_variant_status_voice_id ON voice_variant_generation_status(voice_id);
CREATE INDEX IF NOT EXISTS idx_variant_status_status ON voice_variant_generation_status(status);

CREATE INDEX IF NOT EXISTS idx_variant_costs_user_id ON voice_variant_costs(user_id);
CREATE INDEX IF NOT EXISTS idx_variant_costs_edition_id ON voice_variant_costs(edition_id);
CREATE INDEX IF NOT EXISTS idx_variant_costs_user_date ON voice_variant_costs(user_id, generated_at);

-- Add new columns to daily_editions to support Phase 3
ALTER TABLE daily_editions
ADD COLUMN IF NOT EXISTS script_ready boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS content_generated_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS is_script_only boolean DEFAULT false;

COMMENT ON TABLE voice_variants IS
'Voice variants: Store generated audio for different voice profiles
One script → multiple voice variants (users choose which one)
Generated on-demand when user selects a voice profile
Key insight: Only generate audio for variants users actually want
Cost savings: ~90% TTS reduction vs generating all 3 profiles upfront';

COMMENT ON COLUMN daily_editions.script_ready IS
'Content and script have been generated (audio is on-demand per voice profile)';

COMMENT ON COLUMN daily_editions.is_script_only IS
'Edition is in script-ready state waiting for voice variant selection
Used to distinguish Phase 3 editions from earlier phases';

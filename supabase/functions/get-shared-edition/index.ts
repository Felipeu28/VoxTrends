import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");

const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Hash IP address for privacy (no PII stored)
function hashIP(ip: string): string {
  // Using Deno's crypto API for hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = Deno.crypto.subtle.digestSync("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const shareToken = url.searchParams.get("share_token");

    if (!shareToken) {
      return new Response(
        JSON.stringify({ error: "share_token is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify share link exists and isn't expired
    const now = new Date();
    const { data: shareLink, error: shareLinkError } = await supabase
      .from("shared_editions")
      .select("id, edition_id, expires_at")
      .eq("share_token", shareToken)
      .single();

    if (shareLinkError || !shareLink) {
      return new Response(
        JSON.stringify({ error: "Share link not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    if (new Date(shareLink.expires_at) < now) {
      return new Response(
        JSON.stringify({ error: "Share link expired" }),
        { status: 410, headers: corsHeaders }  // Gone
      );
    }

    // Get the edition content
    const { data: edition, error: editionError } = await supabase
      .from("daily_editions")
      .select("*")
      .eq("id", shareLink.edition_id)
      .single();

    if (editionError || !edition) {
      return new Response(
        JSON.stringify({ error: "Edition not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // ==================== PHASE 3: FETCH VOICE VARIANTS ====================
    // Get all voice variants available for this edition
    const { data: variants } = await supabase
      .from("voice_variants")
      .select("voice_id, audio_url, created_at")
      .eq("edition_id", shareLink.edition_id);

    const variantMap = variants?.reduce((acc, v) => {
      acc[v.voice_id] = v.audio_url;
      return acc;
    }, {} as Record<string, string>) || {};

    // Log access (async, non-blocking)
    const clientIP = req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const ipHash = hashIP(clientIP);

    supabase
      .from("shared_access_logs")
      .insert({
        share_id: shareLink.id,
        user_agent: req.headers.get("user-agent") || null,
        ip_hash: ipHash,
      })
      .then(() => {
        // Also increment access count on shared_editions (non-blocking)
        supabase
          .from("shared_editions")
          .update({
            access_count: (shareLink as any).access_count + 1,
            last_accessed_at: now.toISOString(),
          })
          .eq("id", shareLink.id)
          .then(() => console.log("Access logged and count updated"))
          .catch((err) => console.error("Failed to update access count:", err));
      })
      .catch((err) => console.error("Failed to log access:", err));

    // ==================== PHASE 3 & 4: RETURN SHARED EDITION WITH VARIANTS ====================
    // Return edition with share metadata and available voice variants
    return new Response(
      JSON.stringify({
        edition: {
          ...edition,
          voiceVariants: {
            available: Object.keys(variantMap),
            count: Object.keys(variantMap).length,
            audioUrls: variantMap,  // Map of voice_id -> audio_url
          },
        },
        share_metadata: {
          share_token: shareToken,
          shared_by: null,  // Privacy: don't expose creator
          shared_at: shareLink.created_at,
          expires_at: shareLink.expires_at,
          access_count: shareLink.access_count,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Get shared edition error:", error.message);
    return new Response(
      JSON.stringify({
        error: "Failed to retrieve shared edition",
        message: error.message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});

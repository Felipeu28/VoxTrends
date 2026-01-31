import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtDecode } from "https://esm.sh/jwt-decode";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");

const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

// Generate a short, unique token for share links (12+ alphanumeric chars)
function generateShareToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  const crypto = globalThis.crypto;
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);

  for (let i = 0; i < array.length; i++) {
    token += chars[array[i] % chars.length];
  }

  return token;
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
    // GET: Retrieve share links for an edition
    if (req.method === "GET") {
      const url = new URL(req.url);
      const editionId = url.searchParams.get("edition_id");

      if (!editionId) {
        return new Response(
          JSON.stringify({ error: "edition_id is required" }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Verify user owns this edition or it's shared with them
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: corsHeaders,
        });
      }

      let userId: string;
      try {
        const decoded = jwtDecode<{ sub: string }>(token);
        userId = decoded.sub;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: corsHeaders,
        });
      }

      // Verify user has access to this edition
      const { data: edition, error: editionError } = await supabase
        .from("daily_editions")
        .select("id, user_id")
        .eq("id", editionId)
        .single();

      if (editionError || !edition || edition.user_id !== userId) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: corsHeaders,
        });
      }

      // Get all share links for this edition
      const { data: shares, error: sharesError } = await supabase
        .from("shared_editions")
        .select("id, share_token, created_at, expires_at, access_count")
        .eq("edition_id", editionId)
        .order("created_at", { ascending: false });

      if (sharesError) throw sharesError;

      return new Response(
        JSON.stringify({
          edition_id: editionId,
          shares: shares || [],
          count: shares?.length || 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST: Create a new share link
    if (req.method === "POST") {
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: corsHeaders,
        });
      }

      let userId: string;
      try {
        const decoded = jwtDecode<{ sub: string }>(token);
        userId = decoded.sub;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: corsHeaders,
        });
      }

      const body = await req.json();
      const { edition_id } = body;

      if (!edition_id) {
        return new Response(
          JSON.stringify({ error: "edition_id is required" }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Verify user owns this edition
      const { data: edition, error: editionError } = await supabase
        .from("daily_editions")
        .select("id, user_id")
        .eq("id", edition_id)
        .single();

      if (editionError || !edition || edition.user_id !== userId) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: corsHeaders,
        });
      }

      // Generate share token and create link
      const shareToken = generateShareToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);  // 30 days

      const { data: shareLink, error: createError } = await supabase
        .from("shared_editions")
        .insert({
          edition_id,
          created_by: userId,
          share_token: shareToken,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (createError) throw createError;

      const shareUrl = `${Deno.env.get("APP_URL")}/shared/audio/${shareToken}`;

      return new Response(
        JSON.stringify({
          id: shareLink.id,
          edition_id: shareLink.edition_id,
          share_token: shareLink.share_token,
          share_url: shareUrl,
          created_at: shareLink.created_at,
          expires_at: shareLink.expires_at,
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE: Revoke a share link
    if (req.method === "DELETE") {
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: corsHeaders,
        });
      }

      let userId: string;
      try {
        const decoded = jwtDecode<{ sub: string }>(token);
        userId = decoded.sub;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: corsHeaders,
        });
      }

      const url = new URL(req.url);
      const shareId = url.searchParams.get("share_id");

      if (!shareId) {
        return new Response(
          JSON.stringify({ error: "share_id is required" }),
          { status: 400 }
        );
      }

      // Verify user created this share
      const { data: share, error: shareError } = await supabase
        .from("shared_editions")
        .select("id, created_by")
        .eq("id", shareId)
        .single();

      if (shareError || !share || share.created_by !== userId) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: corsHeaders,
        });
      }

      // Delete the share link
      const { error: deleteError } = await supabase
        .from("shared_editions")
        .delete()
        .eq("id", shareId);

      if (deleteError) throw deleteError;

      return new Response(
        JSON.stringify({ message: "Share link revoked" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Share function error:", error.message);
    return new Response(
      JSON.stringify({
        error: "Share function failed",
        message: error.message,
      }),
      { status: 500 }
    );
  }
});

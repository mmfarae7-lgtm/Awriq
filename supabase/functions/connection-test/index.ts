// AWRIQ Connection Test - tests if an independent system is reachable
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { url, institution_id } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return new Response(
        JSON.stringify({ success: false, error: "Only HTTP/HTTPS URLs are allowed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(parsedUrl.toString(), {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      if (institution_id) {
        await supabase.from("system_connections").update({
          last_test_at: new Date().toISOString(),
          last_test_success: response.ok,
          last_test_result: response.ok ? "Connection successful" : `HTTP ${response.status}`,
          status: response.ok ? "active" : "failed",
        }).eq("institution_id", institution_id);

        if (response.ok) {
          await supabase.from("institutions").update({
            connection_status: "connected",
            last_heartbeat_at: new Date().toISOString(),
          }).eq("id", institution_id);
        }
      }

      return new Response(
        JSON.stringify({
          success: response.ok,
          status: response.ok ? "ok" : "error",
          http_status: response.status,
          message: response.ok ? "Connection successful" : `HTTP ${response.status}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (fetchError) {
      clearTimeout(timeout);
      const errorMsg = fetchError instanceof Error ? fetchError.message : "Connection failed";

      if (institution_id) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await supabase.from("system_connections").update({
          last_test_at: new Date().toISOString(),
          last_test_success: false,
          last_test_result: errorMsg,
          status: "failed",
        }).eq("institution_id", institution_id);
      }

      return new Response(
        JSON.stringify({ success: false, status: "error", error: errorMsg }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

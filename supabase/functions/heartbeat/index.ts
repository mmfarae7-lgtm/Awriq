// AWRIQ Heartbeat API - receives heartbeat from independent systems
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
    const { system_id, tenant_id, system_version, status, timestamp } = await req.json();

    if (!system_id) {
      return new Response(
        JSON.stringify({ success: false, error: "system_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: institution, error: instError } = await supabase
      .from("institutions")
      .select("id, tenant_id")
      .eq("system_id", system_id)
      .maybeSingle();

    if (instError || !institution) {
      return new Response(
        JSON.stringify({ success: false, error: "Institution not found for given system_id" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tenant_id && tenant_id !== institution.tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Tenant ID mismatch" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hbStatus = status || "ok";
    const hbTimestamp = timestamp || new Date().toISOString();

    const { error: hbError } = await supabase.from("heartbeats").insert({
      institution_id: institution.id,
      system_id,
      tenant_id: institution.tenant_id,
      system_version: system_version || null,
      status: hbStatus,
      payload: { timestamp: hbTimestamp, received: new Date().toISOString() },
    });

    if (hbError) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to record heartbeat" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("institutions").update({
      last_heartbeat_at: new Date().toISOString(),
      last_sync_at: new Date().toISOString(),
      connection_status: "connected",
      system_version: system_version || null,
    }).eq("id", institution.id);

    await supabase.from("activity_logs").insert({
      action: "heartbeat_received",
      resource: "institution",
      resource_id: system_id,
      institution_id: institution.id,
      details: `Heartbeat received from ${system_id}`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        status: "ok",
        message: "Heartbeat recorded",
        received_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

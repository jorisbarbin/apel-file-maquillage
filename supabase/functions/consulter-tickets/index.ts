import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return Response.json({
      erreur: "Méthode non autorisée"
    }, {
      status: 405,
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const jeton = body.jeton_prive;
    // Vérification du format du jeton privé
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof jeton !== "string" || !uuidRegex.test(jeton)) {
      return Response.json({
        erreur: "Jeton privé invalide."
      }, {
        status: 400,
        headers: corsHeaders
      });
    }
    // Connexion serveur à Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Configuration serveur manquante");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Consultation des tickets de la famille
    const { data, error } = await supabase.rpc("consulter_mes_tickets", {
      p_jeton: jeton
    });
    if (error) {
      console.error("Erreur consultation :", error.message);
      return Response.json({
        erreur: "Impossible de consulter les tickets."
      }, {
        status: 500,
        headers: corsHeaders
      });
    }
    return Response.json({
      succes: true,
      tickets: data ?? []
    }, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Erreur serveur :", error);
    return Response.json({
      erreur: "Une erreur est survenue."
    }, {
      status: 500,
      headers: corsHeaders
    });
  }
});

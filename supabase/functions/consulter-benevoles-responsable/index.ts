import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function reponse(contenu, status = 200) {
  return Response.json(contenu, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store"
    }
  });
}
async function empreinte(texte) {
  const donnees = new TextEncoder().encode(texte);
  const hash = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(hash)).map((octet)=>octet.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return reponse({
      erreur: "Méthode non autorisée."
    }, 405);
  }
  try {
    let body;
    try {
      body = await req.json();
    } catch  {
      return reponse({
        erreur: "Requête invalide."
      }, 400);
    }
    const sessionToken = body?.session_token;
    if (typeof sessionToken !== "string" || !/^[0-9a-f]{64}$/.test(sessionToken)) {
      return reponse({
        erreur: "Session invalide."
      }, 401);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Configuration Supabase manquante");
      return reponse({
        erreur: "Service indisponible."
      }, 503);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Vérifier la session du responsable.
    const tokenHash = await empreinte(sessionToken);
    const { data: session, error: erreurSession } = await supabase.from("sessions").select("id").eq("token_hash", tokenHash).eq("role", "responsable").is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (erreurSession) {
      console.error("Erreur vérification session :", erreurSession.message);
      return reponse({
        erreur: "Impossible de vérifier la session."
      }, 503);
    }
    if (!session) {
      return reponse({
        erreur: "Accès responsable refusé."
      }, 403);
    }
    // Consulter la situation des bénévoles.
    const { data: benevoles, error: erreurBenevoles } = await supabase.rpc("situation_benevoles");
    if (erreurBenevoles) {
      console.error("Erreur consultation bénévoles :", erreurBenevoles.message);
      return reponse({
        erreur: "Consultation impossible."
      }, 500);
    }
    return reponse({
      succes: true,
      benevoles: benevoles || []
    });
  } catch (error) {
    console.error("Erreur consulter-benevoles-responsable :", error);
    return reponse({
      erreur: "Erreur serveur."
    }, 500);
  }
});

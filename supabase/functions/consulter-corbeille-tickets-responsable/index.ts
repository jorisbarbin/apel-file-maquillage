import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
function reponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}
async function sha256(texte) {
  const donnees = new TextEncoder().encode(texte);
  const hash = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(hash)).map((octet)=>octet.toString(16).padStart(2, "0")).join("");
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers
    });
  }
  if (req.method !== "POST") {
    return reponse({
      erreur: "Méthode non autorisée."
    }, 405);
  }
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error("Configuration Supabase manquante.");
      return reponse({
        erreur: "Service indisponible."
      }, 503);
    }
    let body;
    try {
      body = await req.json();
    } catch  {
      return reponse({
        erreur: "Requête invalide."
      }, 400);
    }
    const token = body?.session_token;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      return reponse({
        erreur: "Session invalide."
      }, 401);
    }
    const supabase = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Vérifier que le jeton appartient à une session responsable valide.
    const tokenHash = await sha256(token);
    const { data: session, error: erreurSession } = await supabase.from("sessions").select("id").eq("token_hash", tokenHash).eq("role", "responsable").is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (erreurSession) {
      console.error("Erreur vérification session :", erreurSession.message);
      return reponse({
        erreur: "Service indisponible."
      }, 503);
    }
    if (!session) {
      return reponse({
        erreur: "Accès responsable refusé."
      }, 403);
    }
    // Récupérer les tickets annulés depuis la corbeille.
    const { data: tickets, error: erreurCorbeille } = await supabase.rpc("corbeille_tickets_responsable");
    if (erreurCorbeille) {
      console.error("Erreur consultation corbeille :", erreurCorbeille.message);
      return reponse({
        erreur: "Consultation impossible."
      }, 500);
    }
    const corbeille = tickets ?? [];
    return reponse({
      succes: true,
      nombre_tickets: corbeille.length,
      tickets: corbeille
    });
  } catch (error) {
    console.error("Erreur consulter-corbeille-tickets-responsable :", error);
    return reponse({
      erreur: "Erreur serveur."
    }, 500);
  }
});

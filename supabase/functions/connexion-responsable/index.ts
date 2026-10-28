import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
function reponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function genererJeton() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b)=>b.toString(16).padStart(2, "0")).join("");
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
    const responsablePin = Deno.env.get("RESPONSABLE_PIN");
    const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!responsablePin || !rateLimitSecret || !supabaseUrl || !serviceRoleKey) {
      console.error("Configuration serveur incomplète.");
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
    // Limitation des tentatives par adresse IP apparente.
    // Protection de première étape, à renforcer avant production.
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor?.split(",").at(-1)?.trim() || req.headers.get("cf-connecting-ip") || "inconnue";
    const cleHash = await sha256(`connexion-responsable:${ip}:${rateLimitSecret}`);
    const { data: autorise, error: erreurLimite } = await supabase.rpc("autoriser_tentative_inscription", {
      p_cle_hash: cleHash
    });
    if (erreurLimite) {
      console.error("Erreur limitation :", erreurLimite.message);
      return reponse({
        erreur: "Service temporairement indisponible."
      }, 503);
    }
    if (!autorise) {
      return reponse({
        erreur: "Trop de tentatives. Réessayez dans quelques minutes."
      }, 429);
    }
    let body;
    try {
      body = await req.json();
    } catch  {
      return reponse({
        erreur: "Requête invalide."
      }, 400);
    }
    const pin = body?.pin;
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin) || pin !== responsablePin) {
      return reponse({
        erreur: "Code incorrect."
      }, 401);
    }
    // Création d'un jeton secret de session.
    const sessionToken = genererJeton();
    const tokenHash = await sha256(sessionToken);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const { error: erreurSession } = await supabase.from("sessions").insert({
      role: "responsable",
      benevole_id: null,
      token_hash: tokenHash,
      expires_at: expiresAt
    });
    if (erreurSession) {
      console.error("Erreur création session :", erreurSession.message);
      return reponse({
        erreur: "Connexion impossible."
      }, 500);
    }
    return reponse({
      succes: true,
      role: "responsable",
      session_token: sessionToken,
      expires_at: expiresAt
    });
  } catch (error) {
    console.error("Erreur connexion responsable :", error);
    return reponse({
      erreur: "Erreur serveur."
    }, 500);
  }
});

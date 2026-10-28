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
// Calculer une empreinte SHA-256
async function empreinte(texte) {
  const donnees = new TextEncoder().encode(texte);
  const hash = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(hash)).map((octet)=>octet.toString(16).padStart(2, "0")).join("");
}
// Comparer deux codes PIN
function pinsIdentiques(a, b) {
  if (a.length !== 4 || b.length !== 4) {
    return false;
  }
  let difference = 0;
  for(let i = 0; i < 4; i++){
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
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
    const body = await req.json();
    const benevoleId = body.benevole_id;
    const pin = body.pin;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Vérifier le format des informations
    if (typeof benevoleId !== "string" || !uuidRegex.test(benevoleId) || typeof pin !== "string" || !/^[0-9]{4}$/.test(pin)) {
      return reponse({
        erreur: "Identifiant ou code PIN invalide."
      }, 400);
    }
    // Récupérer les secrets du serveur
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const pinSecret = Deno.env.get("BENEVOLES_PIN");
    const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !pinSecret || !rateLimitSecret) {
      console.error("Configuration serveur incomplète");
      return reponse({
        erreur: "Service temporairement indisponible."
      }, 503);
    }
    // Connexion privilégiée à Supabase
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Limitation provisoire des tentatives
    const cleLimitation = await empreinte(`connexion-benevole:${benevoleId}:${rateLimitSecret}`);
    const { data: autorise, error: erreurLimite } = await supabase.rpc("autoriser_tentative_inscription", {
      p_cle_hash: cleLimitation
    });
    if (erreurLimite || autorise === null) {
      console.error("Erreur limitation :", erreurLimite?.message);
      return reponse({
        erreur: "Vérification temporairement indisponible."
      }, 503);
    }
    if (autorise !== true) {
      return reponse({
        erreur: "Trop de tentatives. Réessayez dans quelques minutes."
      }, 429);
    }
    // Vérifier que le bénévole existe et est actif
    const { data: benevole, error: erreurBenevole } = await supabase.from("benevoles").select("id, prenom, actif").eq("id", benevoleId).eq("actif", true).maybeSingle();
    if (erreurBenevole || !benevole || !pinsIdentiques(pin, pinSecret)) {
      return reponse({
        erreur: "Bénévole ou code PIN incorrect."
      }, 401);
    }
    // Créer un jeton de session aléatoire
    const octets = crypto.getRandomValues(new Uint8Array(32));
    const jeton = Array.from(octets).map((octet)=>octet.toString(16).padStart(2, "0")).join("");
    // Stocker uniquement son empreinte
    const tokenHash = await empreinte(jeton);
    // Session valable 8 heures
    const expiration = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    // Enregistrer la session
    const { error: erreurSession } = await supabase.from("sessions").insert({
      id: crypto.randomUUID(),
      benevole_id: benevole.id,
      role: "benevole",
      token_hash: tokenHash,
      expires_at: expiration
    });
    if (erreurSession) {
      console.error("Erreur création session :", erreurSession.message);
      return reponse({
        erreur: "Impossible de créer la session."
      }, 500);
    }
    // Retourner les informations de connexion
    return reponse({
      succes: true,
      benevole: {
        id: benevole.id,
        prenom: benevole.prenom
      },
      session_token: jeton,
      expires_at: expiration
    });
  } catch (error) {
    console.error("Erreur connexion bénévole :", error);
    return reponse({
      erreur: "Une erreur est survenue."
    }, 500);
  }
});

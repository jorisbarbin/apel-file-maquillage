import { createClient } from "npm:@supabase/supabase-js@2";
async function calculerEmpreinte(adresseIP, secret) {
  const encodeur = new TextEncoder();
  const cle = await crypto.subtle.importKey("raw", encodeur.encode(secret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const signature = await crypto.subtle.sign("HMAC", cle, encodeur.encode(adresseIP));
  return Array.from(new Uint8Array(signature)).map((octet)=>octet.toString(16).padStart(2, "0")).join("");
}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function reponse(body, status) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store"
    }
  });
}
Deno.serve(async (req)=>{
  // Autoriser les vérifications CORS du navigateur
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
    const prenoms = body.prenoms;
    const demandeId = body.demande_id;
    const turnstileToken = body.turnstile_token;
    const recuperationHash = body.recuperation_hash;
    // 1. Vérifier les prénoms
    if (!Array.isArray(prenoms) || prenoms.length < 1 || prenoms.length > 10 || !prenoms.every((p)=>typeof p === "string" && p.trim().length >= 1 && p.trim().length <= 50)) {
      return reponse({
        erreur: "Veuillez saisir entre 1 et 10 prénoms valides."
      }, 400);
    }
    // 2. Vérifier l'identifiant de la demande
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof demandeId !== "string" || !uuidRegex.test(demandeId)) {
      return reponse({
        erreur: "Identifiant de demande invalide."
      }, 400);
    }
    // Vérifier l'empreinte privée de récupération.
    if (typeof recuperationHash !== "string" || !/^[0-9a-f]{64}$/.test(recuperationHash)) {
      return reponse({
        erreur: "Preuve de récupération invalide."
      }, 400);
    }
    // 3. Exiger un jeton Cloudflare Turnstile
    if (typeof turnstileToken !== "string" || turnstileToken.length === 0 || turnstileToken.length > 2048) {
      return reponse({
        erreur: "Vérification de sécurité manquante."
      }, 403);
    }
    // 4. Récupérer la clé secrète côté serveur
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret) {
      console.error("Secret Turnstile manquant");
      return reponse({
        erreur: "Configuration de sécurité indisponible."
      }, 500);
    }
    // 5. Demander à Cloudflare de vérifier le jeton
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        secret: turnstileSecret,
        response: turnstileToken
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!verification.ok) {
      console.error("Service Turnstile indisponible");
      return reponse({
        erreur: "Vérification de sécurité indisponible."
      }, 503);
    }
    const resultat = await verification.json();
    const domainesAutorises = [
      "localhost",
      "apel-file-maquillage.vercel.app"
    ];
    if (resultat.success !== true || !domainesAutorises.includes(resultat.hostname)) {
      return reponse({
        erreur: "Vérification de sécurité refusée. Veuillez réessayer."
      }, 403);
    }
    // 6. Connexion privilégiée à Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Configuration Supabase manquante");
      return reponse({
        erreur: "Configuration serveur indisponible."
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Limiter les tentatives d'inscription
    const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
    if (!rateLimitSecret) {
      console.error("Secret de limitation manquant");
      return reponse({
        erreur: "Protection temporairement indisponible."
      }, 503);
    }
    // Récupérer provisoirement l'adresse transmise par Supabase
    const forwardedFor = req.headers.get("x-forwarded-for");
    if (!forwardedFor) {
      console.error("Adresse réseau indisponible");
      return reponse({
        erreur: "Vérification réseau indisponible."
      }, 503);
    }
    // Éviter de faire confiance à la première valeur,
    // qui peut avoir été fournie par le client.
    // Cette sélection devra être validée sur l'infrastructure réelle.
    const adresseIP = forwardedFor.split(",").at(-1)?.trim();
    if (!adresseIP) {
      return reponse({
        erreur: "Identification réseau impossible."
      }, 503);
    }
    const empreinte = await calculerEmpreinte(adresseIP, rateLimitSecret);
    // Demander à PostgreSQL d'autoriser ou non la tentative
    const { data: autorise, error: erreurLimite } = await supabase.rpc("autoriser_tentative_inscription", {
      p_cle_hash: empreinte
    });
    if (erreurLimite) {
      console.error("Erreur limitation :", erreurLimite.message);
      return reponse({
        erreur: "Vérification des inscriptions indisponible."
      }, 503);
    }
    if (autorise !== true) {
      return reponse({
        erreur: "Trop de tentatives d'inscription. Veuillez réessayer dans quelques minutes."
      }, 429);
    }
    // 7. Inscrire les enfants uniquement après validation
    const { data, error } = await supabase.rpc("inscrire_enfants_securise", {
      p_prenoms: prenoms.map((p)=>p.trim()),
      p_demande_id: demandeId,
      p_recuperation_hash: recuperationHash
    });
    if (error) {
      console.error("Erreur inscription :", error.message);
      return reponse({
        erreur: "Inscription impossible. Vérifiez que le stand est ouvert."
      }, 400);
    }
    return reponse({
      succes: true,
      tickets: data
    }, 200);
  } catch (error) {
    console.error("Erreur serveur :", error);
    return reponse({
      erreur: "Une erreur est survenue."
    }, 500);
  }
});

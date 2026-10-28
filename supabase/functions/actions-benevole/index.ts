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
// Calcule l'empreinte du jeton de session
async function empreinte(texte) {
  const donnees = new TextEncoder().encode(texte);
  const hash = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(hash)).map((octet)=>octet.toString(16).padStart(2, "0")).join("");
}
// Ne renvoyer que les informations utiles au bénévole
function ticketPublic(ticket) {
  if (!ticket) return null;
  return {
    numero: ticket.numero,
    prenom: ticket.prenom,
    statut: ticket.statut
  };
}
Deno.serve(async (req)=>{
  // Autoriser les requêtes depuis l'application React
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
    const sessionToken = body.session_token;
    const action = body.action;
    // Vérifier les paramètres
    if (typeof sessionToken !== "string" || !/^[0-9a-f]{64}$/.test(sessionToken)) {
      return reponse({
        erreur: "Session invalide."
      }, 401);
    }
    // Les quatre actions autorisées
    if (![
      "etat",
      "appeler",
      "terminer",
      "absent"
    ].includes(action)) {
      return reponse({
        erreur: "Action non autorisée."
      }, 400);
    }
    // Secrets Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Configuration Supabase manquante");
      return reponse({
        erreur: "Service indisponible."
      }, 503);
    }
    // Connexion exclusivement côté serveur
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Retrouver la session grâce à son empreinte
    const tokenHash = await empreinte(sessionToken);
    const { data: session, error: erreurSession } = await supabase.from("sessions").select("id, benevole_id, role, expires_at, revoked_at").eq("token_hash", tokenHash).maybeSingle();
    if (erreurSession) {
      console.error("Erreur lecture session :", erreurSession.message);
      return reponse({
        erreur: "Impossible de vérifier la session."
      }, 503);
    }
    // Vérifier que la session est valide
    if (!session || session.role !== "benevole" || !session.benevole_id || !session.expires_at || session.revoked_at !== null || new Date(session.expires_at).getTime() <= Date.now()) {
      return reponse({
        erreur: "Session expirée ou invalide. Veuillez vous reconnecter."
      }, 401);
    }
    // Vérifier que le bénévole est toujours actif
    const { data: benevole, error: erreurBenevole } = await supabase.from("benevoles").select("id, prenom, actif").eq("id", session.benevole_id).eq("actif", true).maybeSingle();
    if (erreurBenevole) {
      console.error("Erreur lecture bénévole :", erreurBenevole.message);
      return reponse({
        erreur: "Service indisponible."
      }, 503);
    }
    if (!benevole) {
      return reponse({
        erreur: "Accès bénévole désactivé."
      }, 403);
    }
    // ACTION 1 : Consulter uniquement son enfant actuel
    if (action === "etat") {
      const { data: tickets, error } = await supabase.from("tickets").select("numero, prenom, statut").eq("benevole_id", benevole.id).in("statut", [
        "appele",
        "en_cours"
      ]).limit(1);
      if (error) {
        console.error("Erreur état :", error.message);
        return reponse({
          erreur: "Impossible de consulter le ticket."
        }, 503);
      }
      return reponse({
        succes: true,
        benevole: benevole.prenom,
        ticket: ticketPublic(tickets?.[0])
      });
    }
    // ACTION 2 : Appeler le prochain enfant
    if (action === "appeler") {
      // Ne pas appeler un autre enfant si la bénévole
      // possède déjà un ticket actif.
      const { data: ticketsEnCours, error: erreurEnCours } = await supabase.from("tickets").select("numero, prenom, statut").eq("benevole_id", benevole.id).in("statut", [
        "appele",
        "en_cours"
      ]).limit(1);
      if (erreurEnCours) {
        console.error("Erreur vérification ticket :", erreurEnCours.message);
        return reponse({
          erreur: "Impossible de vérifier le ticket actuel."
        }, 503);
      }
      if (ticketsEnCours?.length) {
        return reponse({
          succes: true,
          benevole: benevole.prenom,
          ticket: ticketPublic(ticketsEnCours[0])
        });
      }
      const { data: ticket, error } = await supabase.rpc("appeler_suivant", {
        p_benevole_id: benevole.id
      });
      if (error) {
        console.error("Erreur appel :", error.message);
        return reponse({
          erreur: "Impossible d'appeler le prochain enfant."
        }, 500);
      }
      return reponse({
        succes: true,
        benevole: benevole.prenom,
        ticket: ticketPublic(ticket)
      });
    }
    // ACTION 3 : Terminer le maquillage
    if (action === "terminer") {
      const { data: ticket, error } = await supabase.rpc("terminer_maquillage", {
        p_benevole_id: benevole.id
      });
      if (error) {
        console.error("Erreur fin maquillage :", error.message);
        return reponse({
          erreur: "Impossible de terminer le maquillage."
        }, 500);
      }
      return reponse({
        succes: true,
        benevole: benevole.prenom,
        ticket: ticketPublic(ticket)
      });
    }
    // ACTION 4 : Signaler un enfant absent
    if (action === "absent") {
      const { data: ticket, error } = await supabase.rpc("signaler_enfant_absent", {
        p_benevole_id: benevole.id
      });
      if (error) {
        console.error("Erreur signalement absence :", error.message);
        return reponse({
          erreur: "Impossible de signaler l'absence."
        }, 500);
      }
      return reponse({
        succes: true,
        benevole: benevole.prenom,
        ticket: ticketPublic(ticket)
      });
    }
    return reponse({
      erreur: "Action non autorisée."
    }, 400);
  } catch (error) {
    console.error("Erreur actions bénévole :", error);
    return reponse({
      erreur: "Une erreur est survenue."
    }, 500);
  }
});

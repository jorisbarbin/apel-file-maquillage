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
      return reponse({
        erreur: "Configuration indisponible."
      }, 503);
    }
    const supabase = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    let body;
    try {
      body = await req.json();
    } catch  {
      return reponse({
        erreur: "Requête invalide."
      }, 400);
    }
    const sessionToken = body.session_token;
    if (typeof sessionToken !== "string" || !/^[a-f0-9]{64}$/.test(sessionToken)) {
      return reponse({
        erreur: "Session invalide."
      }, 401);
    }
    const tokenHash = await sha256(sessionToken);
    // Vérifier que la session appartient à un responsable.
    const { data: session, error: erreurSession } = await supabase.from("sessions").select("id").eq("token_hash", tokenHash).eq("role", "responsable").is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (erreurSession) {
      console.error("Vérification session :", erreurSession.message);
      return reponse({
        erreur: "Service indisponible."
      }, 503);
    }
    if (!session) {
      return reponse({
        erreur: "Accès responsable refusé."
      }, 403);
    }
    // Consultation sans modification.
    if (body.action === "etat") {
      const { data, error } = await supabase.from("stands").select("id, nom, statut").eq("nom", "Maquillage - Marché de Noël").single();
      if (error) {
        console.error("Consultation stand :", error.message);
        return reponse({
          erreur: "Consultation impossible."
        }, 500);
      }
      return reponse({
        succes: true,
        stand: data
      });
    }
    // Modification contrôlée.
    if (body.action === "changer-statut") {
      if (typeof body.statut !== "string" || ![
        "ouvert",
        "suspendu",
        "ferme"
      ].includes(body.statut)) {
        return reponse({
          erreur: "Statut non autorisé."
        }, 400);
      }
      const { data, error } = await supabase.from("stands").update({
        statut: body.statut
      }).eq("nom", "Maquillage - Marché de Noël").select("id, nom, statut").single();
      if (error) {
        console.error("Modification stand :", error.message);
        return reponse({
          erreur: "Modification impossible."
        }, 500);
      }
      return reponse({
        succes: true,
        stand: data
      });
    }
    // ACTION : Remettre un enfant absent en fin de file
    if (body.action === "remettre-en-attente") {
      const numero = body.numero;
      if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero <= 0) {
        return reponse({
          erreur: "Numéro de ticket invalide."
        }, 400);
      }
      const { data: ticket, error } = await supabase.rpc("remettre_absent_en_attente", {
        p_ticket_numero: numero
      });
      if (error) {
        console.error("Retour enfant absent :", error.message);
        return reponse({
          erreur: "Impossible de remettre cet enfant en attente."
        }, 400);
      }
      return reponse({
        succes: true,
        ticket: {
          numero: ticket.numero,
          prenom: ticket.prenom,
          statut: ticket.statut
        }
      });
    }
    // ACTION : Ajouter un bénévole
    if (body.action === "ajouter-benevole") {
      const demandeId = body.demande_id;
      if (typeof demandeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(demandeId)) {
        return reponse({
          erreur: "Identifiant de demande invalide."
        }, 400);
      }
      if (typeof body.prenom !== "string" || body.prenom.trim().length < 2 || body.prenom.trim().length > 35) {
        return reponse({
          erreur: "Le prénom doit contenir entre 2 et 35 caractères."
        }, 400);
      }
      const { data: benevole, error } = await supabase.rpc("ajouter_benevole", {
        p_prenom: body.prenom.trim(),
        p_demande_id: demandeId
      });
      if (error) {
        console.error("Ajout bénévole :", error.message);
        return reponse({
          erreur: "Impossible d'ajouter ce bénévole."
        }, 500);
      }
      return reponse({
        succes: true,
        benevole: {
          id: benevole.id,
          prenom: benevole.prenom,
          actif: benevole.actif
        }
      });
    }
    // ACTION : Activer ou désactiver un bénévole
    if (body.action === "modifier-etat-benevole") {
      const benevoleId = body.benevole_id;
      const actif = body.actif;
      // Vérifier l'identifiant et le statut demandé.
      if (typeof benevoleId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(benevoleId) || typeof actif !== "boolean") {
        return reponse({
          erreur: "Paramètres du bénévole invalides."
        }, 400);
      }
      const { data: benevole, error } = await supabase.rpc("modifier_etat_benevole", {
        p_benevole_id: benevoleId,
        p_actif: actif
      });
      if (error) {
        console.error("Modification bénévole :", error.message);
        return reponse({
          erreur: "Impossible de modifier ce bénévole. Vérifiez qu'il n'a pas d'enfant en cours."
        }, 400);
      }
      return reponse({
        succes: true,
        benevole: {
          id: benevole.id,
          prenom: benevole.prenom,
          actif: benevole.actif
        }
      });
    }
    // ACTION : Annuler un ticket enfant
    if (body.action === "annuler-ticket") {
      const numero = body.numero;
      if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero <= 0) {
        return reponse({
          erreur: "Numéro de ticket invalide."
        }, 400);
      }
      const { data: ticket, error } = await supabase.rpc("annuler_ticket_responsable", {
        p_ticket_numero: numero
      });
      if (error) {
        console.error("Annulation ticket :", error.message);
        return reponse({
          erreur: "Impossible d'annuler ce ticket. Vérifiez qu'il est toujours en attente."
        }, 400);
      }
      return reponse({
        succes: true,
        ticket: {
          numero: ticket.numero,
          prenom: ticket.prenom,
          statut: ticket.statut
        }
      });
    }
    // ACTION : Restaurer un ticket annulé
    if (body.action === "restaurer-ticket") {
      const numero = body.numero;
      if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero <= 0) {
        return reponse({
          erreur: "Numéro de ticket invalide."
        }, 400);
      }
      const { data: ticket, error } = await supabase.rpc("restaurer_ticket_responsable", {
        p_ticket_numero: numero
      });
      if (error) {
        console.error("Restauration ticket :", error.message);
        return reponse({
          erreur: "Impossible de restaurer ce ticket. Vérifiez qu'il est bien annulé."
        }, 400);
      }
      return reponse({
        succes: true,
        ticket: {
          numero: ticket.numero,
          prenom: ticket.prenom,
          statut: ticket.statut
        }
      });
    }
    // ACTION : Retirer un bénévole vers la corbeille
    if (body.action === "retirer-benevole") {
      const benevoleId = body.benevole_id;
      if (typeof benevoleId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(benevoleId)) {
        return reponse({
          erreur: "Identifiant du bénévole invalide."
        }, 400);
      }
      const { data: benevole, error } = await supabase.rpc("retirer_benevole_responsable", {
        p_benevole_id: benevoleId
      });
      if (error) {
        console.error("Retrait bénévole :", error.message);
        return reponse({
          erreur: "Impossible de retirer ce bénévole. Vérifiez qu'il ne prend pas en charge un enfant."
        }, 400);
      }
      return reponse({
        succes: true,
        benevole: {
          id: benevole.id,
          prenom: benevole.prenom,
          actif: benevole.actif,
          retire: benevole.retire
        }
      });
    }
    // ACTION : Restaurer un bénévole depuis la corbeille
    if (body.action === "restaurer-benevole") {
      const benevoleId = body.benevole_id;
      if (typeof benevoleId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(benevoleId)) {
        return reponse({
          erreur: "Identifiant du bénévole invalide."
        }, 400);
      }
      const { data: benevole, error } = await supabase.rpc("restaurer_benevole_responsable", {
        p_benevole_id: benevoleId
      });
      if (error) {
        console.error("Restauration bénévole :", error.message);
        return reponse({
          erreur: "Impossible de restaurer ce bénévole. Vérifiez qu'il est bien dans la corbeille."
        }, 400);
      }
      return reponse({
        succes: true,
        benevole: {
          id: benevole.id,
          prenom: benevole.prenom,
          actif: benevole.actif,
          retire: benevole.retire
        }
      });
    }
    return reponse({
      erreur: "Action inconnue."
    }, 400);
  } catch (error) {
    console.error("Gestion stand :", error);
    return reponse({
      erreur: "Erreur serveur."
    }, 500);
  }
});

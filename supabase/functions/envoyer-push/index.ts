import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
// Aucun envoi réseau tant que cette variable n'est pas explicitement activée.
const envoiPushActif = Deno.env.get("PUSH_SEND_ENABLED") === "true";
// Mode test par défaut : aucune diffusion multi-familles implicite.
const modePush = Deno.env.get("PUSH_MODE") ?? "test";

// Le mode multi-familles nécessite une autorisation indépendante.
const diffusionMultifamillesAutorisee =
  Deno.env.get("PUSH_MULTI_FAMILY_ENABLED") === "true";

const modePushValide =
  modePush === "test" || modePush === "production";
// En développement, interdire l'envoi réel tant qu'aucun
// abonnement de test n'est explicitement autorisé.
const abonnementTestAutorise = Deno.env.get(
  "PUSH_TEST_ENDPOINT"
);
const clePubliqueVapid = Deno.env.get("VAPID_PUBLIC_KEY");
const clePriveeVapid = Deno.env.get("VAPID_PRIVATE_KEY");
const sujetVapid = Deno.env.get("VAPID_SUBJECT");

if (clePubliqueVapid && clePriveeVapid && sujetVapid) {
  webpush.setVapidDetails(
    sujetVapid,
    clePubliqueVapid,
    clePriveeVapid
  );
}

const reponse = (message: string, statut: number) =>
  Response.json(
    { message },
    {
      status: statut,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );

Deno.serve(async (req) => {
  // Fonction exclusivement réservée au serveur.
  if (req.method !== "POST") {
    return reponse("Méthode non autorisée.", 405);
  }

  if (!modePushValide) {
    return reponse("Mode Push non reconnu.", 503);
  }

  if (
    modePush === "production" &&
    !diffusionMultifamillesAutorisee
  ) {
    return reponse(
      "Diffusion multi-familles non autorisée.",
      503
    );
  }

  const secretAttendu = Deno.env.get("PUSH_WORKER_SECRET");

  if (!secretAttendu) {
    console.error("PUSH_WORKER_SECRET manquant.");
    return reponse("Configuration serveur manquante.", 503);
  }

  const autorisation = req.headers.get("Authorization");

  if (autorisation !== `Bearer ${secretAttendu}`) {
    return reponse("Accès non autorisé.", 401);
  }

  if (!clePubliqueVapid || !clePriveeVapid || !sujetVapid) {
    return reponse("Configuration VAPID manquante.", 503);
  }

  // Connexion à Supabase avec les droits du serveur uniquement.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return reponse("Configuration Supabase manquante.", 503);
  }

  // Autoriser uniquement Supabase local en mode test.
  // En production, exiger une URL Supabase HTTPS explicitement prévue.
  const adresseSupabase = new URL(supabaseUrl);

  const baseLocale = ["127.0.0.1", "localhost", "kong"].includes(
    adresseSupabase.hostname
  );

  if (modePush === "test" && !baseLocale) {
    return reponse("Base de données non locale en mode test.", 503);
  }

  if (modePush === "production") {
    const projetProductionAttendu = Deno.env.get(
      "PUSH_PRODUCTION_PROJECT_ID"
    );

    const domaineAttendu = projetProductionAttendu
      ? `${projetProductionAttendu}.supabase.co`
      : null;

    if (
      !domaineAttendu ||
      adresseSupabase.protocol !== "https:" ||
      adresseSupabase.hostname !== domaineAttendu ||
      adresseSupabase.port !== ""
    ) {
      return reponse("Projet Supabase de production non autorisé.", 503);
    }
  }

  console.log(
    "Connexion Supabase autorisée :",
    adresseSupabase.hostname
  );

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // 1. Préparer les destinataires des notifications.
    const { error: erreurPreparation } = await supabase.rpc(
      "preparer_destinataires_push"
    );

    if (erreurPreparation) {
      console.error("Préparation Push :", erreurPreparation.message);
      return reponse("Préparation des notifications impossible.", 500);
    }

    // En mode simulation, ne réserver aucun envoi.
    // Une simulation ne doit pas consommer de tentative.
    if (!envoiPushActif) {
      return Response.json({
        succes: true,
        preparationEffectuee: true,
        envoisReserves: 0,
        modeSimulation: true,
        abonnementTestConfigure: Boolean(abonnementTestAutorise),
        envoiEffectue: false,
      });
    }

    // Sécurité : aucun envoi réel sans abonnement de test autorisé.
    if (modePush === "test" && !abonnementTestAutorise) {
      return reponse(
        "Envoi réel interdit : abonnement de test non configuré.",
        503
      );
    }

    // Vérifier que l'abonnement de test pointe vers Google FCM.
    let endpointTestValide = false;

    try {
      const urlTest = new URL(abonnementTestAutorise ?? "");

      endpointTestValide =
        urlTest.protocol === "https:" &&
        urlTest.hostname === "fcm.googleapis.com" &&
        urlTest.port === "";
    } catch {
      endpointTestValide = false;
    }

    if (modePush === "test" && !endpointTestValide) {
      return reponse(
        "Adresse de l'abonnement de test invalide.",
        503
      );
    }

    // En test : un seul envoi vers l'abonnement autorisé.
    // En production : un lot limité à 20 notifications.
    const limiteEnvois = modePush === "test" ? 1 : 20;

    const { data: envois, error: erreurReservation } =
      await supabase.rpc("reserver_envois_push", {
        p_limite: limiteEnvois,
        p_endpoint_test:
          modePush === "test" ? abonnementTestAutorise : null,
      });

    if (erreurReservation) {
      console.error(
        "Réservation Push :",
        erreurReservation?.message ?? "Erreur inconnue"
      );

      return reponse(
        "Réservation des notifications impossible.",
        500
      );
    }

    // Traiter les abonnements réservés.
    let envoisReussis = 0;
    let envoisEchoues = 0;
    let abonnementsExpires = 0;

    for (const envoi of envois ?? []) {
      // En mode test, refuser tout destinataire différent
      // de l'abonnement Chrome explicitement autorisé.
      if (
        modePush === "test" &&
        (!abonnementTestAutorise ||
          envoi.endpoint !== abonnementTestAutorise)
      ) {
        console.error(
          "Abonnement réservé différent de l'abonnement de test."
        );

        const { data: finalisation, error: erreurFinalisation } =
          await supabase.rpc("finaliser_envoi_push", {
            p_envoi_id: envoi.envoi_id,
            p_reservation_id: envoi.reservation_id,
            p_resultat: "echec",
            p_erreur: "Abonnement différent de celui autorisé pour le test",
          });

        if (erreurFinalisation || finalisation !== true) {
          console.error(
            "Impossible de finaliser l'envoi refusé :",
            erreurFinalisation?.message ?? "Réservation obsolète"
          );
        }

        continue;
      }
      const abonnement = {
        endpoint: envoi.endpoint,
        keys: {
          p256dh: envoi.cle_p256dh,
          auth: envoi.cle_auth,
        },
      };

      // Autoriser uniquement les fournisseurs Web Push connus.
      const fournisseursAutorises = new Set([
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ]);

      let destinationValide = false;

      try {
        const destination = new URL(envoi.endpoint);

        destinationValide =
          destination.protocol === "https:" &&
          destination.port === "" &&
          fournisseursAutorises.has(destination.hostname);
      } catch {
        destinationValide = false;
      }

      if (!destinationValide) {
        console.error("Destination Push non autorisée.");

        const { error: erreurFinalisation } = await supabase.rpc(
          "finaliser_envoi_push",
          {
            p_envoi_id: envoi.envoi_id,
            p_reservation_id: envoi.reservation_id,
            p_resultat: "echec",
            p_erreur: "Destination Push non autorisée",
          }
        );

        if (erreurFinalisation) {
          console.error(
            "Finalisation Push :",
            erreurFinalisation?.message ?? "Erreur inconnue"
          );
        }

        continue;
      }

      const message = JSON.stringify({
        title: "🎨 Le coin des petits lutins",
        body:
          envoi.type_notification === "appele"
            ? `C'est au tour de ${envoi.prenom} ! Présentez-vous au stand maquillage.`
            : `Le tour de ${envoi.prenom} approche ! Il reste 5 enfants ou moins devant vous.`,
        tag: `apel-${envoi.type_notification}-${envoi.envoi_id}`,
        url: "/",
      });

      let resultat: "envoye" | "echec" | "expire" = "echec";
      let erreurEnvoi: string | null = null;

      try {
        await webpush.sendNotification(abonnement, message, {
          TTL: 300,
          urgency: "high",
          timeout: 10000,
        });

        resultat = "envoye";
      } catch (error) {
        const erreurPush = error as {
          statusCode?: number;
          message?: string;
        };

        if (
          erreurPush.statusCode === 404 ||
          erreurPush.statusCode === 410
        ) {
          resultat = "expire";
        }

        erreurEnvoi = erreurPush.message ?? "Erreur Web Push";
      }

      const { data: finalisation, error: erreurFinalisation } =
        await supabase.rpc("finaliser_envoi_push", {
          p_envoi_id: envoi.envoi_id,
          p_reservation_id: envoi.reservation_id,
          p_resultat: resultat,
          p_erreur: erreurEnvoi,
        });

      if (erreurFinalisation || finalisation !== true) {
        console.error(
          "Finalisation Push impossible :",
          erreurFinalisation?.message ?? "Réservation obsolète"
        );
        continue;
      }

      // Compter uniquement les résultats confirmés par PostgreSQL.
      if (resultat === "envoye") {
        envoisReussis++;
      } else if (resultat === "expire") {
        abonnementsExpires++;
      } else {
        envoisEchoues++;
      }
    }

    // Résultat du traitement des notifications Push.
    return Response.json({
      succes: true,
      preparationEffectuee: true,
      envoisReserves: envois?.length ?? 0,
      envoisReussis,
      envoisEchoues,
      abonnementsExpires,
      modeSimulation: false,
      envoiEffectue: envoisReussis > 0,
    });

  } catch (error) {
    console.error("Traitement Push :", error);
    return reponse("Traitement des notifications impossible.", 500);
  }
});

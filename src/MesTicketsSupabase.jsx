import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import {
  activerAudio,
  jouerAlerteSonore,
} from "./alertesSonores";
import { creerAbonnementPush } from "./notificationsPush";

const CLE_JETONS = "apel-jetons-familles";

function recupererJetons() {
  let jetons = [];

  try {
    const valeur = JSON.parse(
      localStorage.getItem(CLE_JETONS) || "[]"
    );

    if (Array.isArray(valeur)) {
      jetons = valeur.filter(
        (jeton) => typeof jeton === "string"
      );
    }
  } catch {
    jetons = [];
  }

  // Récupérer également l'ancien jeton de test
  const ancienJeton = localStorage.getItem("apel-jeton-test");

  if (ancienJeton && !jetons.includes(ancienJeton)) {
    jetons.push(ancienJeton);
  }

  // Éviter les doublons
  jetons = [...new Set(jetons)];

  // Sauvegarder la liste complète
  localStorage.setItem(
    CLE_JETONS,
    JSON.stringify(jetons)
  );

  return jetons;
}

export default function MesTicketsSupabase() {
  const [tickets, setTickets] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [audioActif, setAudioActif] = useState(false);
  const [pushActif, setPushActif] = useState(false);
  const [activationPushEnCours, setActivationPushEnCours] = useState(false);

  const anciensTicketsRef = useRef(null);
  const audioActifRef = useRef(false);

  async function activerAlertes() {
    const succes = await activerAudio();

    setAudioActif(succes);
    audioActifRef.current = succes;

    if (succes) {
      jouerAlerteSonore();
    }
  }

  async function activerNotificationsPush() {
    const jetons = recupererJetons();

    if (jetons.length === 0) {
      alert("Aucune inscription familiale trouvée sur cet appareil.");
      return;
    }

    setActivationPushEnCours(true);

    try {
      // Demander l'autorisation et créer l'abonnement du navigateur.
      const abonnement = await creerAbonnementPush();

      // Associer cet appareil à toutes les familles suivies.
      const resultats = await Promise.allSettled(
        jetons.map(async (jeton) => {
          const { data, error } = await supabase.functions.invoke(
            "abonner-push",
            {
              body: {
                jeton_prive: jeton,
                abonnement,
              },
            }
          );

          if (error || !data?.succes) {
            throw new Error("Enregistrement familial impossible.");
          }
        })
      );

      const echecs = resultats.filter(
        (resultat) => resultat.status === "rejected"
      );

      if (echecs.length > 0) {
        throw new Error(
          `Notifications enregistrées pour ${jetons.length - echecs.length
          } inscription(s) sur ${jetons.length}.`
        );
      }

      setPushActif(true);
    } catch (error) {
      console.error("Activation Push :", error);

      alert(
        error.message || "Impossible d'activer les notifications."
      );
    } finally {
      setActivationPushEnCours(false);
    }
  }

  const actualiserTickets = useCallback(async () => {
    const jetons = recupererJetons();

    if (jetons.length === 0) {
      setTickets([]);
      setChargement(false);
      setErreur("");
      return;
    }

    setChargement(true);

    try {
      // Consulter tous les groupes de tickets
      const resultats = await Promise.all(
        jetons.map(async (jeton) => {
          const { data, error } =
            await supabase.functions.invoke(
              "consulter-tickets",
              {
                body: {
                  jeton_prive: jeton,
                },
              }
            );

          if (error || !data?.succes) {
            throw new Error(
              "Impossible de consulter certains tickets."
            );
          }

          return data.tickets || [];
        })
      );

      // Rassembler les tickets
      const tousLesTickets = resultats.flat();

      // Supprimer les doublons éventuels
      const ticketsUniques = Array.from(
        new Map(
          tousLesTickets.map((ticket) => [
            ticket.numero,
            ticket,
          ])
        ).values()
      );

      // Trier par numéro
      ticketsUniques.sort(
        (a, b) => a.numero - b.numero
      );


      const anciensTickets = anciensTicketsRef.current;

      if (anciensTickets && audioActifRef.current) {
        for (const ticket of ticketsUniques) {
          const ancien = anciensTickets.get(ticket.numero);

          if (!ancien) continue;

          const approche =
            ancien.statut === "attente" &&
            ticket.statut === "attente" &&
            Number(ancien.enfants_devant) > 5 &&
            Number(ticket.enfants_devant) <= 5;

          const appele =
            ancien.statut !== "appele" &&
            ancien.statut !== "en_cours" &&
            (ticket.statut === "appele" ||
              ticket.statut === "en_cours");

          if (approche || appele) {
            jouerAlerteSonore();
            break;
          }
        }
      }

      anciensTicketsRef.current = new Map(
        ticketsUniques.map((ticket) => [
          ticket.numero,
          {
            statut: ticket.statut,
            enfants_devant: ticket.enfants_devant,
          },
        ])
      );


      setTickets(ticketsUniques);
      setErreur("");
    } catch (error) {
      console.error("Erreur consultation :", error);

      setErreur(
        "Impossible d'actualiser les tickets. Nouvelle tentative dans quelques secondes."
      );
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    // Charger les tickets au démarrage
    actualiserTickets();

    // Actualisation automatique toutes les 10 secondes
    const intervalle = setInterval(() => {
      if (document.visibilityState === "visible") {
        actualiserTickets();
      }
    }, 10000);

    // Nouvelle inscription
    function nouvelleInscription() {
      actualiserTickets();
    }

    window.addEventListener(
      "apel-tickets-changed",
      nouvelleInscription
    );

    // Retour sur l'application
    function gererVisibilite() {
      if (document.visibilityState === "visible") {
        actualiserTickets();
      }
    }

    document.addEventListener(
      "visibilitychange",
      gererVisibilite
    );

    return () => {
      clearInterval(intervalle);

      window.removeEventListener(
        "apel-tickets-changed",
        nouvelleInscription
      );

      document.removeEventListener(
        "visibilitychange",
        gererVisibilite
      );
    };
  }, [actualiserTickets]);

  // Ne rien afficher si aucun ticket n'est enregistré
  if (!chargement && tickets.length === 0 && !erreur) {
    return null;
  }

  return (
    <section className="card">
      <h2>🎨 Mes tickets</h2>

      <p className="muted">
        Retrouvez vos inscriptions et suivez votre place
        dans la file d'attente.
      </p>

      {chargement && tickets.length === 0 && (
        <p>Chargement de vos tickets...</p>
      )}

      {erreur && <p className="error">{erreur}</p>}


      <div className="card" style={{ marginBottom: "16px" }}>
        <h3>🔔 Alertes de passage</h3>

        <p className="muted">
          Recevez une alerte sonore lorsque votre tour approche.
          Cette fonction nécessite de garder la page ouverte
          et active.
        </p>

        <button
          className="outline"
          onClick={activerAlertes}
          disabled={audioActif}
        >
          {audioActif
            ? "✅ Alertes sonores activées"
            : "🔔 Activer les alertes sonores"}
        </button>
      </div>

      <button
        className="outline"
        type="button"
        onClick={activerNotificationsPush}
        disabled={activationPushEnCours || pushActif}
      >
        {activationPushEnCours
          ? "Activation des notifications..."
          : pushActif
            ? "✅ Notifications activées"
            : "📲 Activer les notifications sur mon téléphone"}
      </button>

      <div className="ticketgrid">
        {tickets.map((ticket) => (
          <div className="ticket" key={ticket.numero}>
            <div className="ticket-top">
              <span>
                Ticket #{String(ticket.numero).padStart(3, "0")}
              </span>

              <strong>{ticket.prenom}</strong>
            </div>

            {ticket.statut === "attente" ? (
              <>
                <div className="big">
                  {ticket.enfants_devant}
                </div>

                <b>
                  {ticket.enfants_devant === 1
                    ? "enfant devant vous"
                    : "enfants devant vous"}
                </b>

                {ticket.enfants_devant <= 5 && (
                  <p>🔔 Rapprochez-vous du stand !</p>
                )}
              </>
            ) : ticket.statut === "appele" ||
              ticket.statut === "en_cours" ? (
              <>
                <div className="big">🎨</div>

                <b>C'est votre tour !</b>

                <p>Présentez-vous au stand de maquillage.</p>
              </>
            ) : ticket.statut === "termine" ? (
              <p>✅ Maquillage terminé</p>
            ) : ticket.statut === "annule" ? (
              <p>Ticket annulé</p>
            ) : ticket.statut === "absent" ? (
              <p>Enfant absent</p>
            ) : (
              <p>Statut : {ticket.statut}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
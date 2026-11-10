import { telechargerTicketsPDF } from "./ticketsPDF";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import {
  activerAudio,
  jouerAlerteSonore,
} from "./alertesSonores";
import {
  creerAbonnementPush,
  recupererAbonnementPushExistant,
} from "./notificationsPush";

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
  const jetonsPushSynchronisesRef = useRef(new Set());
  const synchronisationPushEnCoursRef = useRef(false);

  const synchroniserNotificationsPush = useCallback(async () => {
    if (synchronisationPushEnCoursRef.current) return;

    synchronisationPushEnCoursRef.current = true;

    try {
      const jetons = recupererJetons();
      if (jetons.length === 0) {
        setPushActif(false);
        return;
      }

      // Réutiliser uniquement un abonnement déjà autorisé.
      const abonnement = await recupererAbonnementPushExistant();

      if (!abonnement) {
        setPushActif(false);
        return;
      }

      const nouveauxJetons = jetons.filter(
        (jeton) => !jetonsPushSynchronisesRef.current.has(jeton)
      );

      if (nouveauxJetons.length > 0) {
        setPushActif(false);
      }

      const resultats = await Promise.allSettled(
        nouveauxJetons.map(async (jeton) => {
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
            throw new Error("Synchronisation Push impossible.");
          }

          jetonsPushSynchronisesRef.current.add(jeton);
        })
      );

      const toutEstSynchronise =
        resultats.every((r) => r.status === "fulfilled") &&
        jetons.every((jeton) =>
          jetonsPushSynchronisesRef.current.has(jeton)
        );

      setPushActif(toutEstSynchronise);
    } catch (error) {
      console.error("Synchronisation Push :", error);
      setPushActif(false);
    } finally {
      synchronisationPushEnCoursRef.current = false;
    }
  }, []);

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

      jetons.forEach((jeton) => {
        jetonsPushSynchronisesRef.current.add(jeton);
      });

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
    // Synchroniser les familles sans demander de nouvelle autorisation iOS.
    void synchroniserNotificationsPush();

    const jetons = recupererJetons();

    if (jetons.length === 0) {
      setTickets([]);
      setChargement(false);
      setErreur("");
      return;
    }

    // Le chargement initial est déjà activé par useState(true).
    // Les actualisations suivantes restent silencieuses.
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

          const enfantsDevant = Number(ticket.enfants_devant);
          const enfantsDevantAvant = Number(ancien.enfants_devant);
          // Un rappel sonore lorsque la file atteint 5, 4, 3 ou 2 enfants.
          // Si plusieurs places avancent entre deux relevés, une seule alerte
          // signale la nouvelle position, sans rejouer les anciens seuils.
          const approche =
            ancien.statut === "attente" &&
            ticket.statut === "attente" &&
            Number.isFinite(enfantsDevant) &&
            Number.isFinite(enfantsDevantAvant) &&
            enfantsDevant >= 2 &&
            enfantsDevant <= 5 &&
            enfantsDevantAvant > enfantsDevant;

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
  }, [synchroniserNotificationsPush]);

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
          Recevez un rappel sonore à 5, 4, 3 puis 2 enfants devant vous,
          et lorsque votre enfant est appelé. Gardez la page ouverte
          et active pour entendre les alertes.
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

      <button type="button" className="outline" onClick={() => telechargerTicketsPDF(tickets)}>📄 Télécharger mes tickets (PDF)</button>
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
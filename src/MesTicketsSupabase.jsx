import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

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
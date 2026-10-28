import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

const CLE_SESSION = "apel-session-benevole";
const MESSAGE_ACCES_REFUSE =
    "🔒 Votre accès bénévole a été désactivé ou votre session a expiré. Contactez le responsable du stand.";

// Une panne réseau ne doit jamais être confondue avec une session refusée.
async function verifierReponseFonction(data, error, message) {
    if (error) {
        const statut = error.context?.status;
        if (statut === 401 || statut === 403) {
            const refus = new Error(MESSAGE_ACCES_REFUSE);
            refus.accesRefuse = true;
            throw refus;
        }
        throw new Error(message);
    }
    if (!data?.succes) {
        throw new Error(data?.erreur || message);
    }
}


export default function EspaceBenevole() {
    const [benevoles, setBenevoles] = useState([]);
    const [benevoleId, setBenevoleId] = useState("");
    const [pin, setPin] = useState("");
    const [session, setSession] = useState(null);
    const [ticket, setTicket] = useState(null);
    const [chargement, setChargement] = useState(false);
    const [erreur, setErreur] = useState("");

    // Charger les bénévoles actifs
    useEffect(() => {
        async function chargerBenevoles() {
            const { data, error } = await supabase.rpc(
                "liste_benevoles_maquillage"
            );

            if (error) {
                console.error("Erreur liste bénévoles :", error.message);
                setErreur("Impossible de charger les bénévoles.");
                return;
            }

            setBenevoles(data || []);
        }

        chargerBenevoles();
    }, []);

    // Consulter le ticket attribué à la bénévole
    const actualiserTicket = useCallback(async (token) => {
        if (!token) return;

        const { data, error } = await supabase.functions.invoke(
            "actions-benevole",
            {
                body: {
                    session_token: token,
                    action: "etat",
                },
            }
        );

        await verifierReponseFonction(data, error, "Impossible de consulter le ticket.");

        setTicket(data.ticket);
    }, []);

    // Retrouver une session existante après un rechargement
    useEffect(() => {
        let actif = true;

        async function restaurerSession() {
            const valeur = sessionStorage.getItem(CLE_SESSION);

            if (!valeur) return;

            try {
                const ancienneSession = JSON.parse(valeur);

                if (
                    !ancienneSession?.session_token ||
                    Date.parse(ancienneSession.expires_at) <= Date.now()
                ) {
                    sessionStorage.removeItem(CLE_SESSION);
                    return;
                }

                await actualiserTicket(ancienneSession.session_token);

                if (actif) {
                    setSession(ancienneSession);
                }
            } catch (err) {
                if (!actif) return;
                if (err.accesRefuse) {
                    sessionStorage.removeItem(CLE_SESSION);
                    setTicket(null);
                    setErreur(MESSAGE_ACCES_REFUSE);
                } else {
                    // Garder la session si Supabase est momentanément indisponible.
                    try {
                        const ancienneSession = JSON.parse(valeur);
                        if (ancienneSession?.session_token && Date.parse(ancienneSession.expires_at) > Date.now()) {
                            setSession(ancienneSession);
                        }
                    } catch {
                        sessionStorage.removeItem(CLE_SESSION);
                    }
                    setErreur("Connexion temporairement indisponible. Réessayez dans un instant.");
                }
            }
        }

        restaurerSession();

        return () => {
            actif = false;
        };
    }, [actualiserTicket]);

    // Connexion avec le PIN
    async function connecter() {
        if (!benevoleId || !/^\d{4}$/.test(pin) || chargement) {
            return;
        }

        setChargement(true);
        setErreur("");

        try {
            const { data, error } = await supabase.functions.invoke(
                "connexion-benevole",
                {
                    body: {
                        benevole_id: benevoleId,
                        pin,
                    },
                }
            );

            if (error || !data?.succes) {
                throw new Error("Connexion refusée.");
            }

            const nouvelleSession = {
                session_token: data.session_token,
                benevole: data.benevole,
                expires_at: data.expires_at,
            };

            // Vérifier l'accès avant d'afficher l'espace de travail.
            await actualiserTicket(data.session_token);
            sessionStorage.setItem(CLE_SESSION, JSON.stringify(nouvelleSession));
            setSession(nouvelleSession);
            setPin("");
        } catch (err) {
            console.error("Connexion bénévole :", err);
            setErreur(err.accesRefuse
                ? MESSAGE_ACCES_REFUSE
                : "Connexion impossible. Vérifiez le code PIN ou réessayez plus tard.");
        } finally {
            setChargement(false);
        }
    }

    // Appeler ou terminer un enfant
    async function effectuerAction(action) {
        if (!session || chargement) return;

        setChargement(true);
        setErreur("");

        try {
            const { data, error } = await supabase.functions.invoke(
                "actions-benevole",
                {
                    body: {
                        session_token: session.session_token,
                        action,
                    },
                }
            );

            await verifierReponseFonction(data, error, "Action impossible.");

            // Libérer la bénévole après une fin de maquillage
            // ou lorsqu'un enfant est déclaré absent.
            if (action === "terminer" || action === "absent") {
                setTicket(null);
            } else {
                setTicket(data.ticket);
            }
        } catch (err) {
            console.error("Action bénévole :", err);
            if (err.accesRefuse) {
                deconnecter(MESSAGE_ACCES_REFUSE);
            } else {
                setErreur("Impossible d'effectuer cette action.");
            }
        } finally {
            setChargement(false);
        }
    }

    // Actualiser automatiquement le ticket
    useEffect(() => {
        if (!session) return;

        const intervalle = setInterval(() => {
            if (document.visibilityState !== "visible") return;

            actualiserTicket(session.session_token).then(() => {
                setErreur("");
            }).catch((err) => {
                console.error("Actualisation bénévole :", err);
                if (err.accesRefuse) {
                    deconnecter(MESSAGE_ACCES_REFUSE);
                } else {
                    setErreur("Impossible d'actualiser le ticket. Réessayez dans un instant.");
                }
            });
        }, 10000);

        return () => clearInterval(intervalle);
    }, [session, actualiserTicket]);

    function deconnecter(message = "") {
        sessionStorage.removeItem(CLE_SESSION);
        setSession(null);
        setTicket(null);
        setPin("");
        setErreur(typeof message === "string" ? message : "");
    }

    // Écran de connexion
    if (!session) {
        return (
            <section className="card login">
                <h2>🎨 Accès bénévoles</h2>

                <p className="muted">
                    Sélectionnez votre prénom et saisissez le code
                    communiqué par le responsable.
                </p>

                <label>
                    Votre prénom
                    <select
                        value={benevoleId}
                        onChange={(e) => setBenevoleId(e.target.value)}
                    >
                        <option value="">Choisir un bénévole</option>

                        {benevoles.map((benevole) => (
                            <option key={benevole.id} value={benevole.id}>
                                {benevole.prenom}
                            </option>
                        ))}
                    </select>
                </label>

                <label>
                    Code PIN
                    <input
                        className="pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="••••"
                        value={pin}
                        onChange={(e) =>
                            setPin(e.target.value.replace(/\D/g, ""))
                        }
                    />
                </label>

                <button
                    className="primary"
                    onClick={connecter}
                    disabled={
                        chargement ||
                        !benevoleId ||
                        pin.length !== 4
                    }
                >
                    {chargement ? "Connexion..." : "Se connecter"}
                </button>

                {erreur && <p className="error">{erreur}</p>}
            </section>
        );
    }

    // Espace de travail de la bénévole
    return (
        <>
            <div className="sectionhead">
                <div>
                    <div className="eyebrow">ESPACE BÉNÉVOLE</div>
                    <h1>Bonjour {session.benevole.prenom} ! 🎨</h1>
                </div>

                <button
                    className="outline small"
                    onClick={() => deconnecter()}
                >
                    Quitter
                </button>
            </div>

            <section className="card">
                {ticket ? (
                    <div className="current">
                        <h2>Enfant à maquiller</h2>

                        <span>
                            Ticket #{String(ticket.numero).padStart(3, "0")}
                        </span>

                        <h1>{ticket.prenom}</h1>

                        <p>🎨 C'est son tour !</p>

                        <button
                            className="primary"
                            onClick={() => effectuerAction("terminer")}
                            disabled={chargement}
                        >
                            ✅ Terminé
                        </button>
                        <button
                            className="outline"
                            style={{ marginTop: "12px" }}
                            onClick={() => {
                                if (
                                    window.confirm(
                                        `Confirmer l'absence de ${ticket.prenom} ?`
                                    )
                                ) {
                                    effectuerAction("absent");
                                }
                            }}
                            disabled={chargement}
                        >
                            🚶 Enfant absent
                        </button>
                    </div>
                ) : (
                    <div className="current">
                        <h2>Prête pour un maquillage ?</h2>

                        <p>Aucun enfant ne vous est actuellement attribué.</p>

                        <button
                            className="primary"
                            onClick={() => effectuerAction("appeler")}
                            disabled={chargement}
                        >
                            🎨 Appeler le prochain enfant
                        </button>
                    </div>
                )}

                {chargement && <p>Un instant...</p>}

                {erreur && <p className="error">{erreur}</p>}
            </section>

            <p className="muted center">
                Pas de chronomètre, pas d'objectif.
                Prenez le temps de faire plaisir aux enfants. ❤️
            </p>
        </>
    );
}
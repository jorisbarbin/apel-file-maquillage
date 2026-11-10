import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
const CLE_SESSION = "apel-session-responsable";
const LIBELLES = {
    ouvert: "🟢 Inscriptions ouvertes",
    suspendu: "🟠 Inscriptions suspendues",
    ferme: "🔴 Inscriptions fermées",
};
export default function EspaceResponsable() {
    const [pin, setPin] = useState("");
    const [session, setSession] = useState(null);
    const [statut, setStatut] = useState(null);
    const [prixEnfant, setPrixEnfant] = useState("");
    const [pagePaiementsOuverte, setPagePaiementsOuverte] = useState(false);
    const [pagePaiements, setPagePaiements] = useState(0);
    const [ticketsPaiements, setTicketsPaiements] = useState([]);
    const [totalTicketsPaiements, setTotalTicketsPaiements] = useState(0);
    const [chargementPaiements, setChargementPaiements] = useState(false);
    const [erreurPaiements, setErreurPaiements] = useState("");
    const [chargement, setChargement] = useState(false);
    const [erreur, setErreur] = useState("");
    const [message, setMessage] = useState("");
    const [fileAttente, setFileAttente] = useState([]);
    const [fileDeployee, setFileDeployee] = useState(false);
    const [corbeilleDeployee, setCorbeilleDeployee] = useState(false);
    const [ticketsAnnules, setTicketsAnnules] = useState([]);
    const [enfantsEnAttente, setEnfantsEnAttente] = useState(0);
    const [enfantsAppeles, setEnfantsAppeles] = useState(0);
    const [benevoles, setBenevoles] = useState([]);
    const [benevolesRetires, setBenevolesRetires] = useState([]);
    const [corbeilleBenevolesDeployee, setCorbeilleBenevolesDeployee] = useState(false);
    const [nouveauPrenom, setNouveauPrenom] = useState("");
    const demandeBenevoleId = useRef(null);
    const ajoutBenevoleEnCours = useRef(false);
    const appelerGestion = useCallback(async (token, action, nouveauStatut) => {
        const { data, error } = await supabase.functions.invoke(
            "gestion-stand",
            {
                body: {
                    session_token: token,
                    action,
                    ...(nouveauStatut ? { statut: nouveauStatut } : {}),
                },
            }
        );
        if (error || !data?.succes) {
            throw new Error(data?.erreur || "Opération impossible.");
        }
        return data.stand;
    }, []);
    const actualiserFile = useCallback(async (token) => {
        const { data, error } = await supabase.functions.invoke(
            "consulter-file-responsable",
            {
                body: {
                    session_token: token,
                },
            }
        );
        if (error || !data?.succes) {
            throw new Error("Impossible de consulter la file d'attente.");
        }
        setFileAttente(data.tickets || []);
        setEnfantsEnAttente(data.enfants_en_attente || 0);
        setEnfantsAppeles(data.enfants_appeles || 0);
    }, []);
    // Corbeille accessible uniquement avec une session responsable.
    const actualiserCorbeille = useCallback(async (token) => {
        const { data, error } = await supabase.functions.invoke(
            "consulter-corbeille-tickets-responsable",
            { body: { session_token: token } }
        );
        if (error || !data?.succes) {
            throw new Error(data?.erreur || "Impossible de consulter la corbeille.");
        }
        setTicketsAnnules(data.tickets || []);
    }, []);

    async function modifierTicket(ticket, action) {
        if (!session || chargement) return;
        const reference = `#${String(ticket.numero).padStart(3, "0")} · ${ticket.prenom}`;
        const question = action === "annuler-ticket"
            ? `Retirer ${reference} de la file d'attente ? Le ticket ira dans la corbeille.`
            : `Restaurer ${reference} à la fin de la file d'attente ?`;
        if (!window.confirm(question)) return;

        setChargement(true);
        setErreur("");
        setMessage("");
        try {
            const { data, error } = await supabase.functions.invoke(
                "gestion-stand",
                {
                    body: {
                        session_token: session.session_token,
                        action,
                        numero: ticket.numero,
                    },
                }
            );
            if (error || !data?.succes) {
                throw new Error(data?.erreur || "Modification du ticket impossible.");
            }
            await Promise.all([
                actualiserFile(session.session_token),
                actualiserCorbeille(session.session_token),
            ]);
            setMessage(action === "annuler-ticket"
                ? `✅ ${ticket.prenom} a été placé dans la corbeille.`
                : `✅ ${ticket.prenom} a été restauré à la fin de la file.`);
        } catch (err) {
            console.error("Modification ticket :", err);
            setErreur(err.message || "Impossible de modifier ce ticket.");
        } finally {
            setChargement(false);
        }
    }

    const actualiserBenevoles = useCallback(async (token) => {
        const { data, error } = await supabase.functions.invoke(
            "consulter-benevoles-responsable",
            {
                body: {
                    session_token: token,
                },
            }
        );
        if (error || !data?.succes) {
            throw new Error("Impossible de consulter les bénévoles.");
        }
        setBenevoles(data.benevoles || []);
    }, []);
    // Consultation de la corbeille des bénévoles, réservée au responsable.
    const actualiserCorbeilleBenevoles = useCallback(async (token) => {
        const { data, error } = await supabase.functions.invoke(
            "consulter-corbeille-benevoles-responsable",
            { body: { session_token: token } }
        );
        if (error || !data?.succes) {
            throw new Error(data?.erreur || "Impossible de consulter la corbeille des bénévoles.");
        }
        setBenevolesRetires(data.benevoles || []);
    }, []);

    // Retirer ou restaurer un bénévole sans supprimer son historique.
    async function modifierCorbeilleBenevole(benevole, action) {
        if (!session || chargement) return;
        if (action === "retirer-benevole" && benevole.occupe) return;

        const question = action === "retirer-benevole"
            ? `Retirer ${benevole.prenom} de l'équipe et le placer dans la corbeille ? Ses sessions seront révoquées.`
            : `Restaurer ${benevole.prenom} dans l'équipe ? Cette personne restera désactivée.`;
        if (!window.confirm(question)) return;

        setChargement(true);
        setErreur("");
        setMessage("");
        try {
            const { data, error } = await supabase.functions.invoke("gestion-stand", {
                body: {
                    session_token: session.session_token,
                    action,
                    benevole_id: benevole.id,
                },
            });
            if (error || !data?.succes) {
                throw new Error(data?.erreur || "Modification du bénévole impossible.");
            }
            await Promise.all([
                actualiserBenevoles(session.session_token),
                actualiserCorbeilleBenevoles(session.session_token),
            ]);
            setMessage(action === "retirer-benevole"
                ? `✅ ${benevole.prenom} a été placé dans la corbeille.`
                : `✅ ${benevole.prenom} a été restauré, mais reste désactivé.`);
        } catch (err) {
            console.error("Modification corbeille bénévole :", err);
            setErreur(err.message || "Impossible de modifier ce bénévole.");
        } finally {
            setChargement(false);
        }
    }

    // Retrouver une session après un rechargement.
    useEffect(() => {
        let actif = true;
        async function restaurerSession() {
            const valeur = sessionStorage.getItem(CLE_SESSION);
            if (!valeur) return;
            try {
                const ancienneSession = JSON.parse(valeur);
                if (
                    !ancienneSession?.session_token ||
                    !ancienneSession?.expires_at ||
                    Date.parse(ancienneSession.expires_at) <= Date.now()
                ) {
                    sessionStorage.removeItem(CLE_SESSION);
                    return;
                }
                const stand = await appelerGestion(
                    ancienneSession.session_token,
                    "etat"
                );
                if (actif) {
                    setSession(ancienneSession);
                    setStatut(stand.statut);
                    setPrixEnfant((Number(stand.prix_enfant_centimes || 0) / 100).toFixed(2));
                }
            } catch {
                sessionStorage.removeItem(CLE_SESSION);
            }
        }
        restaurerSession();
        return () => {
            actif = false;
        };
    }, [appelerGestion]);
    // Connexion du responsable.
    async function connecter() {
        if (!/^\d{4}$/.test(pin) || chargement) return;
        setChargement(true);
        setErreur("");
        setMessage("");
        try {
            const { data, error } = await supabase.functions.invoke(
                "connexion-responsable",
                {
                    body: { pin },
                }
            );
            if (error || !data?.succes) {
                throw new Error("Connexion refusée.");
            }
            const nouvelleSession = {
                session_token: data.session_token,
                expires_at: data.expires_at,
            };
            // Vérifier immédiatement les droits de consultation.
            const stand = await appelerGestion(
                nouvelleSession.session_token,
                "etat"
            );
            sessionStorage.setItem(
                CLE_SESSION,
                JSON.stringify(nouvelleSession)
            );
            setSession(nouvelleSession);
            setStatut(stand.statut);
                    setPrixEnfant((Number(stand.prix_enfant_centimes || 0) / 100).toFixed(2));
            setPin("");
        } catch (err) {
            console.error("Connexion responsable :", err);
            setErreur("Connexion impossible. Vérifiez le code responsable.");
        } finally {
            setChargement(false);
        }
    }
    // Remettre un enfant absent à la fin de la file.
    async function remettreEnAttente(ticket) {
        if (!session || chargement) return;
        const confirmation = window.confirm(
            `Remettre ${ticket.prenom} (ticket #${String(ticket.numero).padStart(3, "0")}) à la fin de la file ?`
        );
        if (!confirmation) return;
        setChargement(true);
        setErreur("");
        setMessage("");
        try {
            const { data, error } = await supabase.functions.invoke(
                "gestion-stand",
                {
                    body: {
                        session_token: session.session_token,
                        action: "remettre-en-attente",
                        numero: ticket.numero,
                    },
                }
            );
            if (error || !data?.succes) {
                throw new Error(
                    data?.erreur || "Impossible de remettre cet enfant en attente."
                );
            }
            await actualiserFile(session.session_token);
            setMessage(
                `✅ ${ticket.prenom} a été remis à la fin de la file.`
            );
        } catch (err) {
            console.error("Retour enfant absent :", err);
            setErreur("Impossible de remettre cet enfant en attente.");
        } finally {
            setChargement(false);
        }
    }
    // Actualisation automatique toutes les 10 secondes.
    useEffect(() => {
        if (!session) return;
        let actif = true;
        async function actualiser() {
            if (document.visibilityState !== "visible") return;
            try {
                const stand = await appelerGestion(session.session_token, "etat");
                if (actif) {
                    setStatut(stand.statut);
                    setPrixEnfant((Number(stand.prix_enfant_centimes || 0) / 100).toFixed(2));
                }
            } catch (err) {
                console.error("Actualisation responsable :", err);
                if (actif) {
                    setErreur("Impossible d'actualiser le statut du stand.");
                }
            }
        }
        const intervalle = setInterval(actualiser, 10000);
        return () => {
            actif = false;
            clearInterval(intervalle);
        };
    }, [session, appelerGestion]);
    useEffect(() => {
        if (!session) return;
        let actif = true;
        async function chargerFile() {
            if (document.visibilityState !== "visible") return;
            try {
                await actualiserFile(session.session_token);
                if (actif) {
                    setErreur("");
                }
            } catch (err) {
                console.error("Actualisation file :", err);
                if (actif) {
                    setErreur("Impossible d'actualiser la file d'attente.");
                }
            }
        }
        chargerFile();
        const intervalle = setInterval(chargerFile, 10000);
        return () => {
            actif = false;
            clearInterval(intervalle);
        };
    }, [session, actualiserFile]);
    // Actualisation de la corbeille toutes les 10 secondes.
    useEffect(() => {
        if (!session) return;
        async function chargerCorbeille() {
            if (document.visibilityState !== "visible") return;
            try {
                await actualiserCorbeille(session.session_token);
            } catch (err) {
                console.error("Actualisation corbeille :", err);
            }
        }
        chargerCorbeille();
        const intervalle = setInterval(chargerCorbeille, 10000);
        return () => clearInterval(intervalle);
    }, [session, actualiserCorbeille]);

    // Actualiser la situation des bénévoles toutes les 10 secondes.
    useEffect(() => {
        if (!session) return;
        let actif = true;
        async function chargerBenevoles() {
            if (document.visibilityState !== "visible") return;
            try {
                const { data, error } = await supabase.functions.invoke(
                    "consulter-benevoles-responsable",
                    {
                        body: {
                            session_token: session.session_token,
                        },
                    }
                );
                if (error || !data?.succes) {
                    throw new Error("Consultation impossible.");
                }
                if (actif) {
                    setBenevoles(data.benevoles || []);
                }
            } catch (err) {
                console.error("Actualisation bénévoles :", err);
                if (actif) {
                    setErreur("Impossible d'actualiser les bénévoles.");
                }
            }
        }
        chargerBenevoles();
        const intervalle = setInterval(chargerBenevoles, 10000);
        return () => {
            actif = false;
            clearInterval(intervalle);
        };
    }, [session]);
    // Actualiser régulièrement la corbeille des bénévoles.
    useEffect(() => {
        if (!session) return;
        async function chargerCorbeilleBenevoles() {
            if (document.visibilityState !== "visible") return;
            try {
                await actualiserCorbeilleBenevoles(session.session_token);
            } catch (err) {
                console.error("Actualisation corbeille bénévoles :", err);
            }
        }
        chargerCorbeilleBenevoles();
        const intervalle = setInterval(chargerCorbeilleBenevoles, 10000);
        return () => clearInterval(intervalle);
    }, [session, actualiserCorbeilleBenevoles]);

    // Ajouter un bénévole depuis l'espace responsable.
    async function ajouterBenevole() {
        const prenom = nouveauPrenom.trim();
        if (
            !session ||
            chargement ||
            ajoutBenevoleEnCours.current ||
            prenom.length < 2 ||
            prenom.length > 35
        ) {
            return;
        }
        ajoutBenevoleEnCours.current = true;
        // Un identifiant est créé pour chaque nouvelle demande.
        // En cas d'échec, on conserve le même pour permettre une relance.
        if (!demandeBenevoleId.current) {
            demandeBenevoleId.current = crypto.randomUUID();
        }
        setChargement(true);
        setErreur("");
        setMessage("");
        try {
            const { data, error } = await supabase.functions.invoke(
                "gestion-stand",
                {
                    body: {
                        session_token: session.session_token,
                        action: "ajouter-benevole",
                        prenom,
                        demande_id: demandeBenevoleId.current,
                    },
                }
            );
            if (error || !data?.succes) {
                throw new Error(data?.erreur || "Ajout impossible.");
            }
            // L'ajout est confirmé : la prochaine demande aura
            // un nouvel identifiant.
            demandeBenevoleId.current = null;
            setNouveauPrenom("");
            setMessage(`✅ ${prenom} a été ajouté à l'équipe.`);
            await actualiserBenevoles(session.session_token);
        } catch (err) {
            console.error("Ajout bénévole :", err);
            setErreur(
                "Impossible de confirmer l'ajout. Vous pouvez réessayer."
            );
        } finally {
            ajoutBenevoleEnCours.current = false;
            setChargement(false);
        }
    }
    async function modifierEtatBenevole(benevole) {
        if (!session || chargement || (benevole.actif && benevole.occupe)) return;
        const actif = !benevole.actif;
        const question = actif
            ? `Réactiver ${benevole.prenom} ?`
            : `Désactiver ${benevole.prenom} ? Ses sessions seront révoquées.`;
        if (!window.confirm(question)) return;
        setChargement(true);
        setErreur("");
        setMessage("");
        try {
            const { data, error } = await supabase.functions.invoke("gestion-stand", {
                body: {
                    session_token: session.session_token,
                    action: "modifier-etat-benevole",
                    benevole_id: benevole.id,
                    actif,
                },
            });
            if (error || !data?.succes) throw new Error(data?.erreur || "Modification impossible.");
            await actualiserBenevoles(session.session_token);
            setMessage(`✅ ${benevole.prenom} : ${actif ? "réactivé(e)" : "désactivé(e)"}.`);
        } catch (err) {
            console.error("Modification bénévole :", err);
            setErreur(err.message || "Impossible de modifier ce bénévole.");
        } finally {
            setChargement(false);
        }
    }
    // Modifier réellement le statut du stand.
    async function changerStatut(nouveauStatut) {
        if (!session || chargement || nouveauStatut === statut) return;
        const questions = {
            ouvert:
                "Confirmer l'ouverture des inscriptions ? Elles seront accessibles sur le site public.",
            suspendu:
                "Confirmer la suspension des nouvelles inscriptions ?",
            ferme:
                "Confirmer la fermeture des inscriptions ?",
        };
        if (!window.confirm(questions[nouveauStatut])) return;
        setChargement(true);
        setErreur("");
        setMessage("");
        try {
            const stand = await appelerGestion(
                session.session_token,
                "changer-statut",
                nouveauStatut
            );
            setStatut(stand.statut);
                    setPrixEnfant((Number(stand.prix_enfant_centimes || 0) / 100).toFixed(2));
            setMessage("✅ Statut du stand mis à jour.");
        } catch (err) {
            console.error("Modification du stand :", err);
            setErreur("Impossible de modifier le statut du stand.");
        } finally {
            setChargement(false);
        }
    }
    async function enregistrerPrix() {
        if (!session || chargement) return;
        const centimes = Math.round(Number(prixEnfant.replace(",", ".")) * 100);
        if (!Number.isSafeInteger(centimes) || centimes < 1 || centimes > 100000) {
            setErreur("Saisissez un prix compris entre 0,01 € et 1 000 €.");
            return;
        }
        setChargement(true);
        setErreur("");
        try {
            const { data, error } = await supabase.functions.invoke("gestion-stand", {
                body: { session_token: session.session_token, action: "changer-prix", prix_enfant_centimes: centimes }
            });
            if (error || !data?.succes) throw new Error(data?.erreur || "Enregistrement impossible.");
            setPrixEnfant((data.stand.prix_enfant_centimes / 100).toFixed(2));
            setMessage("✅ Tarif par enfant enregistré.");
        } catch (err) {
            setErreur(err.message || "Impossible d'enregistrer le tarif.");
        } finally {
            setChargement(false);
        }
    }
    async function consulterPaiements(token, pageDemandee = 0) {
        if (!token) return;
        setChargementPaiements(true);
        setErreurPaiements("");
        try {
            const { data, error } = await supabase.functions.invoke("gestion-stand", {
                body: { session_token: token, action: "liste-paiements", page: pageDemandee },
            });
            if (error || !data?.succes) {
                throw new Error(data?.erreur || "Impossible de charger le suivi des paiements.");
            }
            setTicketsPaiements(data.tickets || []);
            setTotalTicketsPaiements(Number(data.total) || 0);
            setPagePaiements(pageDemandee);
        } catch (err) {
            setErreurPaiements(err.message || "Consultation indisponible.");
        } finally {
            setChargementPaiements(false);
        }
    }
    function ouvrirPaiements() {
        setPagePaiementsOuverte(true);
        void consulterPaiements(session.session_token, 0);
    }
    function deconnecter() {
        setPagePaiementsOuverte(false);
        setTicketsPaiements([]);
        setTotalTicketsPaiements(0);
        sessionStorage.removeItem(CLE_SESSION);
        setSession(null);

        setTicketsAnnules([]);
        setBenevolesRetires([]);
        setCorbeilleBenevolesDeployee(false);

        setStatut(null);
        setPin("");
        setErreur("");
        setMessage("");
    }
    // Écran de connexion.
    if (!session) {
        return (
            <section className="card login">
                <h2>🔐 Accès responsable</h2>
                <p className="muted">
                    Saisissez votre code responsable pour gérer le stand.
                </p>
                <label>
                    Code responsable
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
                        onKeyDown={(e) => {
                            if (e.key === "Enter") connecter();
                        }}
                    />
                </label>
                <button
                    className="primary"
                    onClick={connecter}
                    disabled={chargement || pin.length !== 4}
                >
                    {chargement ? "Connexion..." : "Se connecter"}
                </button>
                {erreur && <p className="error">{erreur}</p>}
            </section>
        );
    }
    // Sous-page administrative accessible uniquement après authentification Responsable.
    if (pagePaiementsOuverte) {
        const dernierePage = Math.max(0, Math.ceil(totalTicketsPaiements / 50) - 1);
        return (
            <>
                <div className="sectionhead">
                    <div>
                        <div className="eyebrow">ESPACE RESPONSABLE</div>
                        <h1>💳 Suivi des paiements</h1>
                    </div>
                    <button type="button" className="outline small"
                        onClick={() => setPagePaiementsOuverte(false)}>
                        ← Retour
                    </button>
                </div>
                <section className="card">
                    <p className="muted">
                        Rapprochez le numéro du ticket avec le numéro de commande indiqué
                        dans le reçu HelloAsso. Les données sont consultables en lecture seule.
                    </p>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                        <strong>{totalTicketsPaiements} ticket{totalTicketsPaiements > 1 ? "s" : ""}</strong>
                        <button type="button" className="outline small"
                            disabled={chargementPaiements}
                            onClick={() => consulterPaiements(session.session_token, pagePaiements)}>
                            ↻ Actualiser
                        </button>
                    </div>
                    {erreurPaiements && <p className="error">{erreurPaiements}</p>}
                    {chargementPaiements && <p className="muted">Chargement des tickets…</p>}
                    {!chargementPaiements && !erreurPaiements && ticketsPaiements.length === 0 && (
                        <div className="empty">Aucun ticket enregistré.</div>
                    )}
                    {ticketsPaiements.length > 0 && (
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                                <thead>
                                    <tr style={{ borderBottom: "2px solid #e8dcc7" }}>
                                        <th scope="col" style={{ padding: "12px 8px" }}>N° ticket</th>
                                        <th scope="col" style={{ padding: "12px 8px" }}>Prénom de l'enfant</th>
                                        <th scope="col" style={{ padding: "12px 8px" }}>Commande HelloAsso</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ticketsPaiements.map((ticket) => (
                                        <tr key={ticket.numero} style={{ borderBottom: "1px solid #eee5d7" }}>
                                            <td style={{ padding: "12px 8px", whiteSpace: "nowrap", fontWeight: 700 }}>
                                                #{String(ticket.numero).padStart(3, "0")}
                                            </td>
                                            <td style={{ padding: "12px 8px" }}>{ticket.prenom}</td>
                                            <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                                                {ticket.helloasso_order_id == null ? "—" : String(ticket.helloasso_order_id)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {totalTicketsPaiements > 50 && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginTop: "20px" }}>
                            <button type="button" className="outline small"
                                disabled={chargementPaiements || pagePaiements === 0}
                                onClick={() => consulterPaiements(session.session_token, pagePaiements - 1)}>
                                ← Précédent
                            </button>
                            <span className="muted">Page {pagePaiements + 1} / {dernierePage + 1}</span>
                            <button type="button" className="outline small"
                                disabled={chargementPaiements || pagePaiements >= dernierePage}
                                onClick={() => consulterPaiements(session.session_token, pagePaiements + 1)}>
                                Suivant →
                            </button>
                        </div>
                    )}
                    <p className="muted" style={{ marginTop: "16px" }}>
                        Le symbole « — » indique qu'aucune référence HelloAsso n'est enregistrée pour ce ticket.
                    </p>
                </section>
            </>
        );
    }
    // Tableau de bord responsable.
    return (
        <>
            <div className="sectionhead">
                <div>
                    <div className="eyebrow">ESPACE RESPONSABLE</div>
                    <h1>Gestion du stand ⚙️</h1>
                </div>
                <button
                    className="outline small"
                    onClick={deconnecter}
                >
                    Quitter
                </button>
            </div>
            <section className="card">
                <h2>💳 Administration des paiements</h2>
                <p className="muted">Consultez les tickets et leurs références de commande HelloAsso.</p>
                <button className="outline" type="button" onClick={ouvrirPaiements}>
                    Voir le suivi des paiements →
                </button>
            </section>
            <section className="card">
                <h2>🎄 Inscriptions au maquillage</h2>
                <div style={{ marginBottom: 20 }}>
                    <label>Prix par enfant (€)
                        <input type="text" inputMode="decimal" value={prixEnfant}
                            onChange={(e) => setPrixEnfant(e.target.value)} placeholder="3,00" />
                    </label>
                    <button className="outline" disabled={chargement} onClick={enregistrerPrix}>
                        Enregistrer le tarif
                    </button>
                    <p className="muted">Le tarif est appliqué à chaque enfant du panier au moment de sa validation.</p>
                </div>
                <p className="muted">Statut actuel du stand :</p>
                <div
                    className={
                        "status " + (statut === "ouvert" ? "green" : "red")
                    }
                >
                    {LIBELLES[statut] || "Chargement..."}
                </div>
                <p className="muted">
                    Choisissez le statut des inscriptions :
                </p>
                <div
                    style={{
                        display: "grid",
                        gap: "12px",
                        marginTop: "20px",
                    }}
                >
                    <button
                        className="primary"
                        disabled={chargement || statut === "ouvert"}
                        onClick={() => changerStatut("ouvert")}
                    >
                        🟢 Ouvrir les inscriptions
                    </button>
                    <button
                        className="outline"
                        disabled={chargement || statut === "suspendu"}
                        onClick={() => changerStatut("suspendu")}
                    >
                        🟠 Suspendre les inscriptions
                    </button>
                    <button
                        className="outline"
                        disabled={chargement || statut === "ferme"}
                        onClick={() => changerStatut("ferme")}
                    >
                        🔴 Fermer les inscriptions
                    </button>
                </div>
                {chargement && <p>Un instant...</p>}
                {message && <p className="notice">{message}</p>}
                {erreur && <p className="error">{erreur}</p>}
            </section>
            <section className="card">
                <h2>🎨 File d'attente</h2>
                <div className="stats">
                    <div>
                        <b>{enfantsEnAttente}</b>
                        <span>En attente</span>
                    </div>
                    <div>
                        <b>{enfantsAppeles}</b>
                        <span>Appelés</span>
                    </div>
                </div>

                    <button
                        type="button"
                        className="outline"
                        onClick={() => setFileDeployee((precedent) => !precedent)}
                        style={{ marginTop: "16px", marginBottom: "12px" }}
                        aria-expanded={fileDeployee}
                    >
                        {fileDeployee
                            ? "▼ Masquer les enfants"
                            : "▶ Afficher les enfants"}
                    </button>

                {fileDeployee && (
                    fileAttente.every((ticket) => ticket.statut === "absent") ? (
                        <div className="empty">
                            ✨ Aucun enfant dans la file pour le moment.
                        </div>
                    ) : (
                        fileAttente
                            .filter((ticket) => ticket.statut !== "absent")
                            .map((ticket) => (
                                <div className="listitem" key={ticket.numero}>
                                    <div>
                                        <strong>
                                            #{String(ticket.numero).padStart(3, "0")} ·{" "}
                                            {ticket.prenom}
                                        </strong>
                                        <small>
                                            {ticket.statut === "attente"
                                                ? "⏳ En attente"
                                                : "🎨 Appelé"}
                                            {ticket.benevole
                                                ? ` · ${ticket.benevole}`
                                                : ""}
                                        </small>
                                    </div>
                                    {ticket.statut === "attente" && (
                                        <button
                                            type="button"
                                            className="outline small"
                                            disabled={chargement}
                                            onClick={() => modifierTicket(ticket, "annuler-ticket")}
                                            title="Retirer ce ticket de la file"
                                        >
                                            🗑️ Retirer
                                        </button>
                                    )}
                                </div>
                            ))
                    )
                    )}
            </section>
            <section className="card">
                <h2>🚶 Enfants absents</h2>
                <p className="muted">
                    Lorsqu'un enfant revient, vous pouvez le replacer
                    à la fin de la file d'attente.
                </p>
                {fileAttente.filter((ticket) => ticket.statut === "absent").length === 0 ? (
                    <div className="empty">
                        Aucun enfant absent pour le moment.
                    </div>
                ) : (
                    fileAttente
                        .filter((ticket) => ticket.statut === "absent")
                        .map((ticket) => (
                            <div className="listitem" key={ticket.numero}>
                                <div>
                                    <strong>
                                        #{String(ticket.numero).padStart(3, "0")} · {ticket.prenom}
                                    </strong>
                                    <small>🚶 Absent</small>
                                </div>
                                <button
                                    className="outline"
                                    onClick={() => remettreEnAttente(ticket)}
                                    disabled={chargement}
                                >
                                    ↩️ Remettre en attente
                                </button>
                            </div>
                        ))
                )}
            </section>
            <section className="card">
                <h2>🗑️ Corbeille des tickets ({ticketsAnnules.length})</h2>
                <p className="muted">Les tickets retirés peuvent être restaurés à la fin de la file.</p>
                <button
                    type="button"
                    className="outline"
                    aria-expanded={corbeilleDeployee}
                    onClick={() => setCorbeilleDeployee((ancien) => !ancien)}
                >
                    {corbeilleDeployee ? "▼ Masquer la corbeille" : "▶ Afficher la corbeille"}
                </button>
                {corbeilleDeployee && (
                    ticketsAnnules.length === 0 ? (
                        <div className="empty">La corbeille est vide.</div>
                    ) : (
                        ticketsAnnules.map((ticket) => (
                            <div className="listitem" key={ticket.numero}>
                                <div>
                                    <strong>#{String(ticket.numero).padStart(3, "0")} · {ticket.prenom}</strong>
                                    <small>🗑️ Ticket annulé</small>
                                </div>
                                <button
                                    type="button"
                                    className="outline small"
                                    disabled={chargement}
                                    onClick={() => modifierTicket(ticket, "restaurer-ticket")}
                                >
                                    ♻️ Restaurer
                                </button>
                            </div>
                        ))
                    )
                )}
            </section>

            <section className="card">
                <h2>👥 Bénévoles</h2>
                <p className="muted">
                    Situation des bénévoles du stand, actualisée automatiquement.
                </p>
                {benevoles.length === 0 ? (
                    <div className="empty">
                        Aucun bénévole enregistré.
                    </div>
                ) : (
                    benevoles.map((benevole) => (
                        <div className="listitem" key={benevole.id}>
                            <div>
                                <strong>{benevole.prenom}</strong>
                                <small>
                                    {!benevole.actif
                                        ? "🔴 Désactivé"
                                        : benevole.occupe
                                            ? "🎨 Occupé"
                                            : "🟢 Disponible"}
                                </small>
                                {benevole.occupe && benevole.enfant_prenom && (
                                    <small>
                                        Enfant : {benevole.enfant_prenom}
                                        {" · "}
                                        Ticket #{String(benevole.ticket_numero).padStart(3, "0")}
                                    </small>
                                )}
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                <button
                                    className="outline small"
                                    type="button"
                                    onClick={() => modifierEtatBenevole(benevole)}
                                    disabled={chargement || benevole.occupe}
                                    title={benevole.occupe ? "Terminer d'abord le maquillage en cours" : undefined}
                                >
                                    {benevole.actif ? "🔴 Désactiver" : "🟢 Réactiver"}
                                </button>
                                <button
                                    className="outline small"
                                    type="button"
                                    onClick={() => modifierCorbeilleBenevole(benevole, "retirer-benevole")}
                                    disabled={chargement || benevole.occupe}
                                    title={benevole.occupe ? "Terminer d'abord le maquillage en cours" : "Placer dans la corbeille"}
                                >
                                    🗑️ Retirer
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </section>
            <section className="card">
                <h2>🗑️ Corbeille des bénévoles ({benevolesRetires.length})</h2>
                <p className="muted">Les bénévoles restaurés restent désactivés jusqu'à leur réactivation.</p>
                <button
                    type="button"
                    className="outline"
                    aria-expanded={corbeilleBenevolesDeployee}
                    onClick={() => setCorbeilleBenevolesDeployee((ancien) => !ancien)}
                >
                    {corbeilleBenevolesDeployee ? "▼ Masquer la corbeille" : "▶ Afficher la corbeille"}
                </button>
                {corbeilleBenevolesDeployee && (
                    benevolesRetires.length === 0 ? (
                        <div className="empty">La corbeille est vide.</div>
                    ) : (
                        benevolesRetires.map((benevole) => (
                            <div className="listitem" key={benevole.id}>
                                <div>
                                    <strong>{benevole.prenom}</strong>
                                    <small>🗑️ Bénévole retiré</small>
                                </div>
                                <button
                                    type="button"
                                    className="outline small"
                                    disabled={chargement}
                                    onClick={() => modifierCorbeilleBenevole(benevole, "restaurer-benevole")}
                                >
                                    ♻️ Restaurer
                                </button>
                            </div>
                        ))
                    )
                )}
            </section>
            <div style={{ marginTop: "20px", marginBottom: "24px" }}>
                <label>
                    Prénom du nouveau bénévole
                    <input
                        type="text"
                        placeholder="Ex. : Julie"
                        maxLength={35}
                        value={nouveauPrenom}
                        onChange={(e) => setNouveauPrenom(e.target.value)}
                    />
                </label>
                <button
                    className="primary"
                    style={{ marginTop: "12px" }}
                    onClick={ajouterBenevole}
                    disabled={
                        chargement ||
                        nouveauPrenom.trim().length < 2
                    }
                >
                    {chargement ? "Enregistrement..." : "➕ Ajouter un bénévole"}
                </button>
            </div>
            <p className="muted center">
                Les modifications sont enregistrées dans Supabase et
                répercutées automatiquement sur l'espace parents.
            </p>
        </>
    );
}

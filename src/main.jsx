import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
    Users,
    Heart,
    Plus,
    Trash2,
    ArrowLeft,
    CheckCircle2,
    LockKeyhole,
    Settings,
    Paintbrush,
    Ticket,
    PauseCircle,
    PlayCircle,
    LogOut,
    Bell,
    Facebook,
} from "lucide-react";
import "./style.css";
import MesTicketsSupabase from "./MesTicketsSupabase";
import { supabase } from "./supabase";
import { Turnstile } from "@marsidev/react-turnstile";
import EspaceBenevole from "./EspaceBenevole";
import EspaceResponsable from "./EspaceResponsable";

// Calcule l'empreinte SHA-256 d'un secret de récupération.
async function calculerEmpreinteRecuperation(secret) {
    const donnees = new TextEncoder().encode(secret);
    const empreinte = await crypto.subtle.digest("SHA-256", donnees);

    return Array.from(new Uint8Array(empreinte))
        .map((octet) => octet.toString(16).padStart(2, "0"))
        .join("");
}

// Génère un secret aléatoire de 256 bits.
function genererSecretRecuperation() {
    const octets = crypto.getRandomValues(new Uint8Array(32));

    return Array.from(octets)
        .map((octet) => octet.toString(16).padStart(2, "0"))
        .join("");
}

const KEY = "apel-maquillage-v1";
const initial = { open: true, next: 42, pin: "2468", tickets: [], workers: [] };
const uid = () => crypto.randomUUID();
function load() {
    try {
        return { ...initial, ...JSON.parse(localStorage.getItem(KEY)) };
    } catch {
        return initial;
    }
}
function App() {
    const [statutStand, setStatutStand] = useState("chargement");
    const [enfantsEnAttente, setEnfantsEnAttente] = useState(0);
    const [prixEnfantCentimes, setPrixEnfantCentimes] = useState(null);
    const [erreurStatut, setErreurStatut] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState(null);
    const [inscriptionEnCours, setInscriptionEnCours] = useState(false);
    const [inscriptionAConfirmer, setInscriptionAConfirmer] = useState(false);
    const [repriseEnCours, setRepriseEnCours] = useState(false);
    const turnstileRef = useRef(null);
    // Mémoriser la demande d'inscription en cours.
    // Conserver la demande en attente, même après actualisation de la page.
    const demandeInscriptionRef = useRef(null);

    useEffect(() => {
        try {
            const sauvegarde = sessionStorage.getItem(
                "apel-inscription-en-attente"
            );

            if (sauvegarde) {
                const demande = JSON.parse(sauvegarde);

                if (
                    typeof demande.demande_id === "string" &&
                    Array.isArray(demande.prenoms)
                ) {
                    demandeInscriptionRef.current = demande.demande_id;
                    setNames(demande.prenoms);
                    setInscriptionAConfirmer(true);
                    setNotice(
                        "⚠️ Une inscription précédente n'a pas été confirmée. " +
                        "Ne recommencez pas une nouvelle inscription pour ces enfants."
                    );
                }
            }
        } catch (error) {
            console.error("Restauration inscription :", error);
        }
    }, []);
    const [db, setDb] = useState(load),
        [page, setPage] = useState("parent"),
        [names, setNames] = useState([""]),
        [pin, setPin] = useState(""),
        [auth, setAuth] = useState(false),
        [workerName, setWorkerName] = useState(""),
        [myIds, setMyIds] = useState(() =>
            JSON.parse(localStorage.getItem("apel-my-tickets") || "[]"),
        ),
        [notice, setNotice] = useState("");
    useEffect(() => {
        let actif = true;
        async function actualiserStatut() {
            const { data, error } = await supabase.rpc(
                "statut_stand_maquillage"
            );
            if (!actif) return;
            if (error || !data || data.length === 0) {
                console.error("Erreur récupération statut :", error);
                setErreurStatut(true);
                setStatutStand("indisponible");
                return;
            }
            setErreurStatut(false);
            const { data: tarif, error: erreurTarif } = await supabase.rpc("tarif_maquillage_public");
            if (actif) setPrixEnfantCentimes(erreurTarif ? null : Number(tarif));
            setStatutStand(data[0].statut);
            setEnfantsEnAttente(Number(data[0].enfants_en_attente));
        }
        // Première récupération immédiate
        actualiserStatut();
        // Actualisation toutes les 10 secondes
        const intervalle = setInterval(() => {
            if (document.visibilityState === "visible") {
                actualiserStatut();
            }
        }, 10000);
        return () => {
            actif = false;
            clearInterval(intervalle);
        };
    }, []);
    const save = (fn) =>
        setDb((old) => {
            let next = typeof fn === "function" ? fn(old) : fn;
            localStorage.setItem(KEY, JSON.stringify(next));
            return next;
        });
    useEffect(() => {
        const sync = () => setDb(load());
        window.addEventListener("storage", sync);
        return () => window.removeEventListener("storage", sync);
    }, []);
    useEffect(() => {
        localStorage.setItem("apel-my-tickets", JSON.stringify(myIds));
    }, [myIds]);
    const active = db.tickets
        .filter((t) => t.status === "waiting")
        .sort((a, b) => a.number - b.number);
    const working = db.tickets.filter((t) => t.status === "called");
    const done = db.tickets.filter((t) => t.status === "done");
    const my = db.tickets.filter((t) => myIds.includes(t.id));
    const enter = (role) => {
        setPage(role);
        setNotice("");
    };
    function memoriserTickets(tickets) {
        if (!tickets?.length || !tickets[0]?.jeton_prive) throw new Error("Tickets incomplets.");
        const jeton = tickets[0].jeton_prive;
        let anciens = [];
        try {
            anciens = JSON.parse(localStorage.getItem("apel-jetons-familles") || "[]");
            if (!Array.isArray(anciens)) anciens = [];
        } catch { anciens = []; }
        if (!anciens.includes(jeton)) anciens.push(jeton);
        localStorage.setItem("apel-jetons-familles", JSON.stringify(anciens));
        window.dispatchEvent(new Event("apel-tickets-changed"));
        sessionStorage.removeItem("apel-inscription-en-attente");
        demandeInscriptionRef.current = null;
        setInscriptionAConfirmer(false);
        setNames([""]);
        setNotice("🎉 Paiement confirmé ! Vos tickets sont disponibles.");
    }

    // Reprendre la commande existante, sans réutiliser Turnstile ni créer de second paiement.
    async function reprendrePaiement() {
        if (repriseEnCours || inscriptionEnCours) return;
        const sauvegarde = JSON.parse(sessionStorage.getItem("apel-inscription-en-attente") || "null");
        if (!sauvegarde?.demande_id || !sauvegarde?.secret_recuperation) {
            setInscriptionAConfirmer(false);
            setNotice("Aucune commande en cours n'a été retrouvée.");
            return;
        }
        setRepriseEnCours(true);
        setNotice("Vérification du paiement précédent...");
        try {
            const recuperationHash = await calculerEmpreinteRecuperation(sauvegarde.secret_recuperation);
            const { data, error } = await supabase.functions.invoke("paiement-helloasso", {
                body: { action: "reprendre", demande_id: sauvegarde.demande_id,
                    recuperation_hash: recuperationHash }
            });
            if (error || !data) throw new Error(data?.erreur || "Vérification indisponible.");
            if (data.etat === "payee") {
                memoriserTickets(data.tickets);
            } else if (data.redirect_url) {
                window.location.assign(data.redirect_url);
            } else if (data.etat === "abandonnee") {
                sessionStorage.removeItem("apel-inscription-en-attente");
                demandeInscriptionRef.current = null;
                setInscriptionAConfirmer(false);
                setNotice("Le précédent paiement n'a pas été confirmé. Vous pouvez recommencer.");
            } else if (data.etat === "lien_expire") {
                setNotice("Le lien de paiement a expiré. Pour éviter un double débit, une nouvelle inscription sera possible après vérification de l'ancien paiement (45 minutes après sa création).");
            } else {
                setNotice("Ce paiement est encore en cours ou en vérification. Réessayez dans quelques instants.");
            }
        } catch (error) {
            setNotice(error.message || "Impossible de retrouver ce paiement. Réessayez.");
        } finally {
            setRepriseEnCours(false);
        }
    }

    useEffect(() => {
        const current = new URL(window.location.href);
        const sauvegarde = JSON.parse(sessionStorage.getItem("apel-inscription-en-attente") || "null");
        const demandeId = current.searchParams.get("paiement") ||
            (current.searchParams.has("checkoutIntentId") ? sauvegarde?.demande_id : null);
        if (!demandeId) return;
        let canceled = false;
        let retries = 0;
        if (sauvegarde?.demande_id !== demandeId) {
            setNotice("Pour récupérer les tickets, revenez sur le navigateur utilisé pour commander.");
            return;
        }
        const verifier = async () => {
            try {
                const recuperationHash = await calculerEmpreinteRecuperation(sauvegarde.secret_recuperation);
                const { data, error } = await supabase.functions.invoke("paiement-helloasso", {
                    body: { action: "verifier", demande_id: demandeId, recuperation_hash: recuperationHash }
                });
                if (canceled) return;
                if (error || !data) throw new Error("Vérification indisponible.");
                if (data.etat === "payee") {
                    memoriserTickets(data.tickets);
                    current.searchParams.delete("paiement");
                    current.searchParams.delete("retour");
                    window.history.replaceState({}, "", current.pathname + current.search + current.hash);
                    return;
                }
                setNotice("Paiement en attente de confirmation. Ne recommencez pas un paiement.");
            } catch {
                if (!canceled) setNotice("Vérification en cours : vos tickets seront affichés dès confirmation.");
            }
            if (!canceled && ++retries < 12) setTimeout(verifier, 5000);
        };
        verifier();
        return () => { canceled = true; };
    }, []);

    async function reserve() {
        if (inscriptionEnCours || inscriptionAConfirmer) return;
        const clean = names.map((n) => n.trim()).filter(Boolean).slice(0, 10);
        if (!clean.length) return setNotice("Saisissez au moins un prénom.");
        if (!turnstileToken) return setNotice("Vérification de sécurité en cours.");
        setInscriptionEnCours(true);
        setNotice("");
        const demandeId = crypto.randomUUID();
        const secretRecuperation = genererSecretRecuperation();
        demandeInscriptionRef.current = demandeId;
        sessionStorage.setItem("apel-inscription-en-attente", JSON.stringify({
            demande_id: demandeId, prenoms: clean, secret_recuperation: secretRecuperation
        }));
        setInscriptionAConfirmer(true);
        try {
            const recuperationHash = await calculerEmpreinteRecuperation(secretRecuperation);
            const { data, error } = await supabase.functions.invoke("paiement-helloasso", {
                body: { action: "creer", prenoms: clean, demande_id: demandeId,
                    recuperation_hash: recuperationHash, turnstile_token: turnstileToken }
            });
            if (error || !data?.redirect_url) throw new Error(data?.erreur || "Paiement non initialisé.");
            // La redirection se produit seulement après sauvegarde de la demande.
            window.location.assign(data.redirect_url);
        } catch (error) {
            setNotice(error.message || "Paiement indisponible.");
            // Ne pas créer une deuxième commande sans réconcilier la première.
        } finally {
            setInscriptionEnCours(false);
            setTurnstileToken(null);
            turnstileRef.current?.reset();
        }
    }
    // Actions locales conservées uniquement pour le tableau de bord de démonstration.
    function updateTicket(ticketId, statut) {
        save((d) => ({
            ...d,
            tickets: d.tickets.map((t) =>
                t.id === ticketId ? { ...t, status: statut } : t
            ),
        }));
    }

    function authenticate() {
        if (pin === db.pin) {
            setAuth(true);
            setPin("");
            setNotice("");
        } else setNotice("Code incorrect");
    }
    const myCurrent = my.filter(
        (t) => t.status !== "done" && t.status !== "cancelled",
    );
    return (

        <div className="shell">
            <header>
                <div className="brand">
                    <img
                        src="/logo-apel.jpeg"
                        alt="Logo APEL Saint Martin Saint Joseph"
                    />
                    <div>
                        <strong>Le coin des petits lutins</strong>
                        <small>Marché de Noël · Saint-Martin Saint-Joseph</small>
                    </div>
                </div>

                <span className="tag">🎄 Maquillage</span>

            </header>
            <main>

                {page === "parent" ? (
                    <>
                        <MesTicketsSupabase />
                        <div className="hero">
                            <div className="eyebrow">✨ LA FILE D'ATTENTE SANS ATTENDRE</div>
                            <h1>
                                Un peu de magie,
                                <br />
                                <em>sans faire la queue.</em>
                            </h1>
                            <p>
                                Inscrivez vos enfants et profitez du marché. Vous suivez votre
                                place en direct, sans rendez-vous ni horaire imposé.
                            </p>
                            <div className={"status " + (statutStand === "ouvert" ? "green" : "red")}>
                                {statutStand === "ouvert"
                                    ? "● Inscriptions ouvertes"
                                    : statutStand === "suspendu"
                                        ? "● Inscriptions suspendues"
                                        : statutStand === "ferme"
                                            ? "● Inscriptions fermées"
                                            : "● Statut temporairement indisponible"}{" "}
                                <span>
                                    {enfantsEnAttente} enfant
                                    {enfantsEnAttente > 1 ? "s" : ""} en attente
                                </span>
                            </div>
                        </div>
                        {notice && <div className="notice">{notice}</div>}
                        {myCurrent.length > 0 && (
                            <section className="card">
                                <h2>
                                    <Ticket size={22} /> Mes tickets
                                </h2>
                                <div className="ticketgrid">
                                    {myCurrent.map((t) => {
                                        const ahead = active.filter(
                                            (a) => a.number < t.number,
                                        ).length;
                                        return (
                                            <div className="ticket" key={t.id}>
                                                <div className="ticket-top">
                                                    <span>
                                                        Ticket #{String(t.number).padStart(3, "0")}
                                                    </span>
                                                    <strong>{t.name}</strong>
                                                </div>
                                                {t.status === "called" ? (
                                                    <>
                                                        <div className="big">🎨</div>
                                                        <b>C'est votre tour !</b>
                                                        <p>Présentez-vous au stand.</p>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="big">{ahead}</div>
                                                        <b>
                                                            enfant{ahead > 1 ? "s" : ""} avant {t.name}
                                                        </b>
                                                        <p>
                                                            {ahead <= 5
                                                                ? "🔔 Rapprochez-vous du stand !"
                                                                : "Profitez du marché, la file avance."}
                                                        </p>
                                                    </>
                                                )}
                                                <button
                                                    className="link danger"
                                                    onClick={() => {
                                                        if (confirm(`Annuler le ticket de ${t.name} ?`))
                                                            updateTicket(t.id, "cancelled");
                                                    }}
                                                >
                                                    Annuler ce ticket
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}
                        {(statutStand === "ouvert" || import.meta.env.DEV) && (
                            <section className="card">
                                <h2>
                                    <Plus size={22} /> Inscrire un enfant
                                </h2>
                                <p className="muted">
                                    Un prénom par enfant, un ticket par inscription.
                                </p>
                                {names.map((n, i) => (
                                    <div className="inputrow" key={i}>
                                        <label>
                                            Enfant {i + 1}
                                            <input
                                                value={n}
                                                disabled={inscriptionEnCours || inscriptionAConfirmer}
                                                placeholder="Son prénom"
                                                maxLength="35"
                                                onChange={(e) =>
                                                    setNames((a) =>
                                                        a.map((x, j) => (i === j ? e.target.value : x)),
                                                    )
                                                }
                                            />
                                        </label>
                                        {names.length > 1 && (
                                            <button
                                                className="iconbutton"
                                                aria-label="Supprimer"
                                                disabled={inscriptionEnCours || inscriptionAConfirmer}
                                                onClick={() =>
                                                    setNames((a) => a.filter((_, j) => j !== i))
                                                }
                                            >
                                                <Trash2 size={19} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                <button
                                    className="outline"
                                    disabled={inscriptionEnCours || inscriptionAConfirmer}
                                    onClick={() =>
                                        setNames((a) => (a.length < 10 ? [...a, ""] : a))
                                    }
                                >
                                    <Plus size={18} /> Ajouter un autre enfant
                                </button>
                                {prixEnfantCentimes !== null && prixEnfantCentimes > 0 && (
                                    <p className="notice">
                                        Prix par enfant : {(prixEnfantCentimes / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                                        {" · "}Total du panier : {((prixEnfantCentimes * names.filter(n => n.trim()).length) / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                                    </p>
                                )}
                                <Turnstile
                                    ref={turnstileRef}
                                    siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                                    onSuccess={(token) => {
                                        setTurnstileToken(token);
                                        console.log("✅ Vérification Cloudflare réussie");
                                    }}
                                    onExpire={() => {
                                        setTurnstileToken(null);
                                    }}
                                    onError={(code) => {
                                        setTurnstileToken(null);
                                        console.error("Erreur Cloudflare Turnstile, code :", code);
                                        setNotice(
                                            `La vérification de sécurité a échoué (code ${code}).`
                                        );
                                    }}
                                />
                                {inscriptionAConfirmer && (
                                    <div className="notice">
                                        <p>Une commande existe déjà pour ce panier. Retrouvez son paiement ou vérifiez son état sans recréer d'inscription.</p>
                                        <button className="outline" type="button"
                                            disabled={repriseEnCours || inscriptionEnCours}
                                            onClick={reprendrePaiement}>
                                            {repriseEnCours ? "Vérification du paiement..." : "Reprendre ou vérifier mon paiement"}
                                        </button>
                                    </div>
                                )}
                                <button
                                    className="primary"
                                    onClick={reserve}
                                    disabled={
                                        inscriptionEnCours ||
                                        inscriptionAConfirmer ||
                                        !turnstileToken ||
                                        !prixEnfantCentimes ||

                                        !names.some((n) => n.trim())

                                    }
                                >
                                    <Ticket size={19} /> Valider et payer pour{" "}
                                    {names.filter((n) => n.trim()).length || ""} inscription
                                    {names.filter((n) => n.trim()).length > 1 ? "s" : ""}
                                </button>
                                <p className="tiny">
                                    Les tickets restent accessibles sur cet appareil. Aucun compte
                                    nécessaire.
                                </p>
                            </section>
                        )}
                        <div className="hint">
                            <Heart size={18} /> Les bénévoles maquillent à leur rythme. Les
                            positions évoluent automatiquement.
                        </div>
                    </>
                ) : false ? (
                    <section className="card login">
                        <button className="link" onClick={() => enter("parent")}>
                            <ArrowLeft size={16} /> Retour
                        </button>
                        <div className="lock">
                            <LockKeyhole />
                        </div>
                        <h2>Accès {page === "volunteer" ? "bénévole" : "responsable"}</h2>
                        <p className="muted">
                            Saisissez le code PIN communiqué par le responsable.
                        </p>
                        <input
                            className="pin"
                            inputMode="numeric"
                            type="password"
                            maxLength="4"
                            placeholder="••••"
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                            onKeyDown={(e) => e.key === "Enter" && authenticate()}
                        />
                        <button className="primary" onClick={authenticate}>
                            Accéder
                        </button>
                        {notice && <p className="error">{notice}</p>}
                    </section>
                ) : page === "volunteer" ? (
                    <EspaceBenevole />
                ) : page === "admin" ? (
                    <EspaceResponsable />
                ) : (
                    <>
                        <div className="sectionhead">
                            <div>
                                <div className="eyebrow">TABLEAU DE BORD</div>
                                <h1>Gestion du stand ⚙️</h1>
                            </div>
                            <button
                                className="outline small"
                                onClick={() => {
                                    setAuth(false);
                                    enter("parent");
                                }}
                            >
                                <LogOut size={16} /> Quitter
                            </button>
                        </div>
                        <div className="stats">
                            <div>
                                <b>{active.length}</b>
                                <span>En attente</span>
                            </div>
                            <div>
                                <b>{working.length}</b>
                                <span>Appelés</span>
                            </div>
                            <div>
                                <b>{done.length}</b>
                                <span>Terminés</span>
                            </div>
                        </div>
                        <section className="card">
                            <h2>
                                <Settings size={22} /> Inscriptions
                            </h2>
                            <div className={"status " + (db.open ? "green" : "red")}>
                                {db.open ? "● File ouverte" : "● File fermée"}
                            </div>
                            <button
                                className={db.open ? "outline" : "primary"}
                                onClick={() => save((d) => ({ ...d, open: !d.open }))}
                            >
                                {db.open ? (
                                    <>
                                        <PauseCircle /> Suspendre les inscriptions
                                    </>
                                ) : (
                                    <>
                                        <PlayCircle /> Ouvrir les inscriptions
                                    </>
                                )}
                            </button>
                            <p className="tiny">
                                Fermer les inscriptions ne supprime pas les tickets existants.
                            </p>
                        </section>
                        <section className="card">
                            <h2>
                                <Users size={22} /> File en cours
                            </h2>
                            {[...working, ...active].length ? (
                                [...working, ...active].map((t) => (
                                    <div className="listitem" key={t.id}>
                                        <div>
                                            <strong>
                                                #{String(t.number).padStart(3, "0")} · {t.name}
                                            </strong>
                                            <small>
                                                {t.status === "called" ? "Appelé" : "En attente"}
                                            </small>
                                        </div>
                                        <div className="actions">
                                            {t.status === "called" && (
                                                <button onClick={() => updateTicket(t.id, "done")}>
                                                    Terminé
                                                </button>
                                            )}
                                            <button onClick={() => updateTicket(t.id, "cancelled")}>
                                                Annuler
                                            </button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="empty">Aucun enfant dans la file.</div>
                            )}
                        </section>
                        <section className="card">
                            <h2>
                                <LockKeyhole size={22} /> Code bénévole
                            </h2>
                            <p className="muted">
                                Code de démonstration actuel : <strong>{db.pin}</strong>
                            </p>
                            <button
                                className="outline"
                                onClick={() => {
                                    const code = String(Math.floor(1000 + Math.random() * 9000));
                                    save((d) => ({ ...d, pin: code }));
                                    setNotice("Nouveau code : " + code);
                                }}
                            >
                                Générer un nouveau PIN
                            </button>
                        </section>
                    </>
                )}
            </main>
            <footer>
                <span>APEL Saint-Martin Saint-Joseph · Vertou</span>
                <nav>
                    <button
                        onClick={() => {
                            setAuth(false);
                            enter("parent");
                        }}
                    >
                        Parents
                    </button>
                    <button
                        onClick={() => {
                            setAuth(false);
                            enter("volunteer");
                        }}
                    >
                        Bénévoles
                    </button>
                    <button
                        onClick={() => {
                            setAuth(false);
                            enter("admin");
                        }}
                    >
                        Responsable
                    </button>
                </nav>
            </footer>
            <div className="demo">
                🔒 Vos données sont utilisées pour la gestion
                de la file d'attente du maquillage.
                {" "}·{" "}
                <a href="/confidentialite.html">
                    Protection des données
                </a>
            </div>
            <div className="footer-social">
                <a
                    href="https://www.facebook.com/groups/1035057636839740/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="facebook-link"
                >
                    <Facebook size={18} aria-hidden="true" />
                    Rejoignez-nous sur Facebook
                </a>
            </div>
        </div>
    );
}
createRoot(document.getElementById("root")).render(<App />);
import { testerConnexion } from "./supabase";
testerConnexion();


if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            const registration =
                await navigator.serviceWorker.register("/sw.js");

            console.log(
                "Service worker enregistré :",
                registration.scope
            );
        } catch (error) {
            console.error(
                "Erreur d'enregistrement du service worker :",
                error
            );
        }
    });
}
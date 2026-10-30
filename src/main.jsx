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
    const [erreurStatut, setErreurStatut] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState(null);
    const [inscriptionEnCours, setInscriptionEnCours] = useState(false);
    const [inscriptionAConfirmer, setInscriptionAConfirmer] = useState(false);
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
    async function reserve() {
        if (inscriptionEnCours) return;
        const clean = names
            .map((n) => n.trim())
            .filter(Boolean)
            .slice(0, 10);
        if (!clean.length) {
            setNotice("Veuillez saisir au moins un prénom.");
            return;
        }
        if (!turnstileToken) {
            setNotice("La vérification de sécurité est en cours. Réessayez.");
            return;
        }
        setInscriptionEnCours(true);
        setNotice("");
        // Réutiliser le même identifiant si la demande est répétée.
        if (!demandeInscriptionRef.current) {
            demandeInscriptionRef.current = crypto.randomUUID();
        }

        const demandeId = demandeInscriptionRef.current;

        // Vérifier qu'une nouvelle tentative concerne
        // exactement les mêmes enfants.
        const sauvegardeExistante = sessionStorage.getItem(
            "apel-inscription-en-attente"
        );

        if (sauvegardeExistante) {
            let demandePrecedente;

            try {
                demandePrecedente = JSON.parse(sauvegardeExistante);
            } catch {
                setNotice(
                    "⚠️ Impossible de relire l'inscription précédente."
                );
                setInscriptionEnCours(false);
                return;
            }

            if (
                demandePrecedente.demande_id !== demandeId ||
                JSON.stringify(demandePrecedente.prenoms) !== JSON.stringify(clean)
            ) {
                setNotice(
                    "⚠️ Une inscription précédente est en attente de confirmation. " +
                    "Conservez les mêmes prénoms pour éviter une double inscription."
                );
                setInscriptionEnCours(false);
                return;
            }
        }

        // Sauvegarder la demande avant de contacter Supabase.
        // Récupérer la demande déjà sauvegardée, si elle existe.
        const demandeSauvegardee = JSON.parse(
            sessionStorage.getItem("apel-inscription-en-attente") || "null"
        );

        // Réutiliser le secret précédent ou en créer un nouveau.
        const secretRecuperation =
            demandeSauvegardee?.secret_recuperation ||
            genererSecretRecuperation();

        // Une fois la demande préparée, ses prénoms ne doivent plus changer.
        setInscriptionAConfirmer(true);

        // Conserver la preuve privée avant tout appel réseau.
        sessionStorage.setItem(
            "apel-inscription-en-attente",
            JSON.stringify({
                demande_id: demandeId,
                prenoms: clean,
                secret_recuperation: secretRecuperation,
            })
        );

        try {
            // Seule l'empreinte sera envoyée à Supabase.
            const recuperationHash =
                await calculerEmpreinteRecuperation(secretRecuperation);

            const { data, error } = await supabase.functions.invoke(
                "inscrire-enfants",
                {
                    body: {
                        prenoms: clean,
                        demande_id: demandeId,
                        recuperation_hash: recuperationHash,
                        turnstile_token: turnstileToken,
                    },
                },
            );
            if (error || !data?.succes) {
                let message = data?.erreur;

                if (!message && error?.context) {
                    try {
                        const details = await error.context.json();
                        message = details?.erreur;
                    } catch {
                        // La réponse n'est pas forcément au format JSON.
                    }
                }

                throw new Error(
                    message || "L'inscription n'a pas pu être confirmée."
                );
            }
            const tickets = data.tickets || [];
            if (!tickets.length || !tickets[0]?.jeton_prive) {
                throw new Error("Réponse d'inscription incomplète.");
            }
            // Conserver le jeton privé sur cet appareil
            const jetonPrive = tickets[0].jeton_prive;
            // Récupérer les jetons des inscriptions précédentes
            let jetonsEnregistres = [];
            try {
                jetonsEnregistres = JSON.parse(
                    localStorage.getItem("apel-jetons-familles") || "[]"
                );
                if (!Array.isArray(jetonsEnregistres)) {
                    jetonsEnregistres = [];
                }
            } catch {
                jetonsEnregistres = [];
            }
            // Ajouter le nouveau jeton sans supprimer les précédents
            if (!jetonsEnregistres.includes(jetonPrive)) {
                jetonsEnregistres.push(jetonPrive);
            }
            // Enregistrer tous les jetons sur cet appareil
            localStorage.setItem(
                "apel-jetons-familles",
                JSON.stringify(jetonsEnregistres)
            );
            // Prévenir l'interface que les tickets ont changé
            window.dispatchEvent(new Event("apel-tickets-changed"));
            // L'inscription est confirmée : la prochaine demande
            // pourra recevoir un nouvel identifiant.
            demandeInscriptionRef.current = null;
            sessionStorage.removeItem("apel-inscription-en-attente");

            setInscriptionAConfirmer(false);
            setNames([""]);
            setNotice(
                `🎉 ${tickets.length} inscription${tickets.length > 1 ? "s" : ""} confirmée${tickets.length > 1 ? "s" : ""} !`,
            );
            console.log(
                "Inscription confirmée :",
                tickets.map((t) => ({
                    numero: t.numero,
                    prenom: t.prenom,
                })),
            );
        } catch (error) {
            console.error("Erreur inscription :", error);
            setNotice(
                error.message ||
                "Impossible de confirmer l'inscription. Veuillez réessayer.",
            );
        } finally {
            setInscriptionEnCours(false);
            setTurnstileToken(null);
            // Un jeton Turnstile ne peut servir qu'une seule fois
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
                                <button
                                    className="primary"
                                    onClick={reserve}
                                    disabled={
                                        inscriptionEnCours ||
                                        !turnstileToken ||

                                        !names.some((n) => n.trim())

                                    }
                                >
                                    <Ticket size={19} /> Confirmer{" "}
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
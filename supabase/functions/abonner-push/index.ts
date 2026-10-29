
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reponse(body: unknown, status = 200) {
    return Response.json(body, {
        status,
        headers: {
            ...corsHeaders,
            "Cache-Control": "no-store",
        },
    });
}

const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (req.method !== "POST") {
        return reponse(
            { erreur: "Méthode non autorisée." },
            405
        );
    }

    try {
        const body = await req.json();

        const jeton = body?.jeton_prive;
        const abonnement = body?.abonnement;

        if (
            typeof jeton !== "string" ||
            !uuidRegex.test(jeton)
        ) {
            return reponse(
                { erreur: "Jeton privé invalide." },
                400
            );
        }

        const endpoint = abonnement?.endpoint;
        const p256dh = abonnement?.keys?.p256dh;
        const auth = abonnement?.keys?.auth;

        if (
            typeof endpoint !== "string" ||
            endpoint.length > 2048 ||
            typeof p256dh !== "string" ||
            p256dh.length < 40 ||
            p256dh.length > 200 ||
            typeof auth !== "string" ||
            auth.length < 15 ||
            auth.length > 100
        ) {
            return reponse(
                { erreur: "Abonnement Push invalide." },
                400
            );
        }

        // Ne jamais accepter une URL arbitraire non sécurisée.
        let url: URL;

        try {
            url = new URL(endpoint);
        } catch {
            return reponse(
                { erreur: "Adresse Push invalide." },
                400
            );
        }

        const fournisseursPushAutorises = new Set([
            "fcm.googleapis.com",
            "updates.push.services.mozilla.com",
            "web.push.apple.com",
        ]);

        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.port ||
            !fournisseursPushAutorises.has(url.hostname) ||
            endpoint.length > 2048
        ) {
            return reponse(
                { erreur: "Adresse Push non autorisée." },
                400
            );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey =
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error("Configuration serveur manquante");
        }

        const supabase = createClient(
            supabaseUrl,
            serviceRoleKey,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                },
            }
        );

        // Identifier la famille grâce à son jeton privé.
        const { data: famille, error: erreurFamille } =
            await supabase
                .from("familles")
                .select("id")
                .eq("jeton_prive", jeton)
                .maybeSingle();

        if (erreurFamille) {
            console.error(
                "Recherche famille :",
                erreurFamille.message
            );
            return reponse(
                { erreur: "Vérification impossible." },
                503
            );
        }

        if (!famille) {
            return reponse(
                { erreur: "Accès famille refusé." },
                403
            );
        }

        // Un appareil peut être associé à plusieurs familles.
        // Pour une même famille, un endpoint ne doit exister qu'une fois.
        const { error: erreurEnregistrement } = await supabase
            .from("abonnements_push")
            .upsert(
                {
                    famille_id: famille.id,
                    endpoint,
                    cle_p256dh: p256dh,
                    cle_auth: auth,
                    actif: true,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: "famille_id,endpoint",
                }
            );

        if (erreurEnregistrement) {
            console.error(
                "Enregistrement Push :",
                erreurEnregistrement.message
            );

            return reponse(
                { erreur: "Enregistrement impossible." },
                500
            );
        }

        return reponse({
            succes: true,
            message: "Abonnement enregistré.",
        });

    } catch (error) {
        console.error("Erreur abonner-push :", error);

        return reponse(
            { erreur: "Une erreur est survenue." },
            500
        );
    }
});
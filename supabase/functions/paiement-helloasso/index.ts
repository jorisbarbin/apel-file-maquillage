import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return respond({ erreur: "Méthode non autorisée." }, 405);
  try {
    const body = await req.json();
    if (!uuid.test(body.demande_id || "") || !/^[0-9a-f]{64}$/.test(body.recuperation_hash || "")) {
      return respond({ erreur: "Demande invalide." }, 400);
    }
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const clientId = Deno.env.get("HELLOASSO_CLIENT_ID");
    const clientSecret = Deno.env.get("HELLOASSO_CLIENT_SECRET");
    const slug = Deno.env.get("HELLOASSO_ORGANIZATION_SLUG");
    const base = Deno.env.get("HELLOASSO_SANDBOX") === "true"
      ? "https://api.helloasso-sandbox.com"
      : "https://api.helloasso.com";
    if (!url || !serviceKey || !clientId || !clientSecret || !slug) {
      return respond({ erreur: "Paiement indisponible : configuration manquante." }, 503);
    }
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    async function token() {
      const { data: cached, error: readError } = await supabase
        .from("helloasso_auth_cache").select("*").eq("id", 1).maybeSingle();
      if (readError) throw new Error("Lecture OAuth impossible");
      if (cached && new Date(cached.expires_at).getTime() > Date.now() + 120_000) {
        return cached.access_token as string;
      }
      const params = cached
        ? new URLSearchParams({ grant_type: "refresh_token", refresh_token: cached.refresh_token })
        : new URLSearchParams({ grant_type: "client_credentials", client_id: clientId!, client_secret: clientSecret! });
      const response = await fetch(base + "/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params, signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("Authentification HelloAsso indisponible");
      const oauth = await response.json();
      if (!oauth.access_token || !oauth.refresh_token) throw new Error("Réponse OAuth incomplète");
      const { error } = await supabase.from("helloasso_auth_cache").upsert({
        id: 1, access_token: oauth.access_token, refresh_token: oauth.refresh_token,
        expires_at: new Date(Date.now() + Number(oauth.expires_in || 1800) * 1000).toISOString()
      });
      if (error) throw new Error("Sauvegarde OAuth impossible");
      return oauth.access_token as string;
    }

    const { data: commande, error: erreurCommande } = await supabase.from("commandes_maquillage")
      .select("*").eq("demande_id", body.demande_id).maybeSingle();
    if (erreurCommande) throw new Error("Lecture commande impossible");

    if (body.action === "verifier") {
      if (!commande || commande.recuperation_hash !== body.recuperation_hash) {
        return respond({ erreur: "Commande introuvable." }, 404);
      }
      if (!commande.checkout_intent_id) return respond({ etat: "preparation" });
      if (commande.statut === "payee") {
        const { data: tickets, error } = await supabase.rpc("finaliser_commande_maquillage", {
          p_demande_id: commande.demande_id, p_checkout_intent_id: commande.checkout_intent_id,
          p_montant_centimes: commande.montant_centimes
        });
        if (error) throw error;
        return respond({ etat: "payee", tickets });
      }
      const accessToken = await token();
      const response = await fetch(base + "/v5/organizations/" + encodeURIComponent(slug) +
        "/checkout-intents/" + commande.checkout_intent_id, {
        headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("Vérification HelloAsso indisponible");
      const intent = await response.json();
      // Ne jamais se fier au code de retour du navigateur.
      const payments = intent.order?.payments;
      const paid = intent.id === commande.checkout_intent_id
        && intent.order?.organizationSlug === slug
        && intent.order?.checkoutIntentId === commande.checkout_intent_id
        && Array.isArray(payments)
        && payments.some((p: { state: string; amount: number; paymentMeans: string }) =>
          p.state === "Authorized" && p.amount === commande.montant_centimes && p.paymentMeans === "Card");
      if (!paid) return respond({ etat: "en_attente" });
      const { data: tickets, error } = await supabase.rpc("finaliser_commande_maquillage", {
        p_demande_id: commande.demande_id, p_checkout_intent_id: commande.checkout_intent_id,
        p_montant_centimes: commande.montant_centimes
      });
      if (error) throw error;
      return respond({ etat: "payee", tickets });
    }

    if (body.action !== "creer") return respond({ erreur: "Action inconnue." }, 400);
    if (commande) {
      if (commande.recuperation_hash !== body.recuperation_hash ||
          JSON.stringify(commande.prenoms) !== JSON.stringify(body.prenoms)) {
        return respond({ erreur: "Commande incompatible avec la demande initiale." }, 409);
      }
      return respond({
        etat: commande.statut,
        checkout_intent_id: commande.checkout_intent_id,
        erreur: commande.checkout_intent_id ? "Paiement déjà préparé. Vérifiez son état." :
          "Commande déjà en préparation. Réessayez la vérification."
      });
    }
    const prenoms = body.prenoms;
    if (!Array.isArray(prenoms) || prenoms.length < 1 || prenoms.length > 10 ||
        !prenoms.every((p: unknown) => typeof p === "string" && p.trim().length > 0 && p.trim().length <= 35)) {
      return respond({ erreur: "Prénoms invalides." }, 400);
    }
    if (typeof body.turnstile_token !== "string") return respond({ erreur: "Vérification manquante." }, 403);
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret) throw new Error("Turnstile non configuré");
    const cf = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({ secret: turnstileSecret, response: body.turnstile_token }),
      signal: AbortSignal.timeout(8000)
    });
    const result = await cf.json();
    if (!result.success || !["localhost", "apel-file-maquillage.vercel.app"].includes(result.hostname)) {
      return respond({ erreur: "Contrôle de sécurité refusé." }, 403);
    }
    const { data: stand, error: erreurStand } = await supabase.from("stands")
      .select("id, statut, prix_enfant_centimes")
      .eq("nom", "Maquillage - Marché de Noël").single();
    if (erreurStand || !stand || stand.statut !== "ouvert" || stand.prix_enfant_centimes <= 0) {
      return respond({ erreur: "Inscriptions ou paiement non disponibles." }, 409);
    }
    const amount = stand.prix_enfant_centimes * prenoms.length;
    const { error: insertError } = await supabase.from("commandes_maquillage").insert({
      demande_id: body.demande_id, stand_id: stand.id, prenoms: prenoms.map((s: string) => s.trim()),
      recuperation_hash: body.recuperation_hash, prix_unitaire_centimes: stand.prix_enfant_centimes,
      montant_centimes: amount
    });
    if (insertError) return respond({ erreur: "Commande existante ou inaccessible." }, 409);

    const accessToken = await token();
    const origin = Deno.env.get("HELLOASSO_RETURN_ORIGIN");
    if (!origin || !/^https:\/\//.test(origin)) throw new Error("URL retour non configurée");
    const paymentUrl = origin.replace(/\/$/, "") + "/?paiement=" + encodeURIComponent(body.demande_id);
    const response = await fetch(base + "/v5/organizations/" + encodeURIComponent(slug) + "/checkout-intents", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        totalAmount: amount, initialAmount: amount, containsDonation: false,
        itemName: "Maquillage - " + prenoms.length + " enfant(s)",
        backUrl: paymentUrl + "&retour=annule",
        errorUrl: paymentUrl + "&retour=erreur",
        returnUrl: paymentUrl + "&retour=confirmation",
        metadata: JSON.stringify({ demande_id: body.demande_id })
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("Impossible d'initialiser le paiement HelloAsso");
    const checkout = await response.json();
    if (!Number.isSafeInteger(checkout.id) || !/^https:\/\//.test(checkout.redirectUrl || "")) {
      throw new Error("Réponse HelloAsso invalide");
    }
    const { error: updateError } = await supabase.from("commandes_maquillage")
      .update({ checkout_intent_id: checkout.id, statut: "en_attente", updated_at: new Date().toISOString() })
      .eq("demande_id", body.demande_id).eq("statut", "preparation");
    if (updateError) throw new Error("Sauvegarde du paiement impossible");
    return respond({ etat: "en_attente", montant_centimes: amount, redirect_url: checkout.redirectUrl });
  } catch (error) {
    console.error("HelloAsso Checkout", error);
    return respond({ erreur: "Le service de paiement est momentanément indisponible." }, 503);
  }
});

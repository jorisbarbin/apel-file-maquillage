-- Rapprochement exact entre chaque ticket et la commande présente sur le reçu HelloAsso.
-- Aucun e-mail, nom du payeur ou autre information personnelle n'est enregistré.
ALTER TABLE public.commandes_maquillage
  ADD COLUMN IF NOT EXISTS helloasso_order_id bigint;
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS helloasso_order_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS commandes_maquillage_helloasso_order_id_unique
  ON public.commandes_maquillage(helloasso_order_id)
  WHERE helloasso_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_helloasso_order_id_idx
  ON public.tickets(helloasso_order_id)
  WHERE helloasso_order_id IS NOT NULL;

-- À utiliser uniquement après vérification du paiement par l'API HelloAsso,
-- via la clé service_role de l'Edge Function (jamais depuis le navigateur).
CREATE OR REPLACE FUNCTION public.enregistrer_reference_commande_helloasso(
  p_demande_id uuid,
  p_checkout_intent_id bigint,
  p_order_id bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  c public.commandes_maquillage%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'Numéro de commande HelloAsso invalide';
  END IF;
  SELECT * INTO c FROM public.commandes_maquillage
  WHERE demande_id = p_demande_id FOR UPDATE;
  IF NOT FOUND OR c.checkout_intent_id IS DISTINCT FROM p_checkout_intent_id THEN
    RAISE EXCEPTION 'Commande ou intention HelloAsso incompatible';
  END IF;
  IF c.helloasso_order_id IS NOT NULL AND c.helloasso_order_id <> p_order_id THEN
    RAISE EXCEPTION 'Numéro HelloAsso déjà lié à une autre commande';
  END IF;
  UPDATE public.commandes_maquillage
    SET helloasso_order_id = p_order_id, updated_at = now()
    WHERE id = c.id;
  -- Réconciliation des tickets existants, notamment après déploiement d'une migration.
  UPDATE public.tickets AS t SET helloasso_order_id = p_order_id
    FROM public.familles AS f
    WHERE t.famille_id = f.id AND f.demande_id = p_demande_id
      AND (t.helloasso_order_id IS NULL OR t.helloasso_order_id = p_order_id);
  IF EXISTS (
    SELECT 1 FROM public.tickets AS t
    JOIN public.familles AS f ON f.id = t.famille_id
    WHERE f.demande_id = p_demande_id AND t.helloasso_order_id IS DISTINCT FROM p_order_id
  ) THEN
    RAISE EXCEPTION 'Référence HelloAsso incohérente pour les tickets';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.enregistrer_reference_commande_helloasso(uuid, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enregistrer_reference_commande_helloasso(uuid, bigint, bigint)
  TO service_role;

-- Les nouvelles lignes de tickets portent directement le numéro visible dans l'e-mail.
CREATE OR REPLACE FUNCTION public.finaliser_commande_maquillage(
  p_demande_id uuid,
  p_checkout_intent_id bigint,
  p_montant_centimes integer
) RETURNS TABLE(numero bigint, prenom text, ticket_id uuid, jeton_prive uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  c public.commandes_maquillage%ROWTYPE;
  v_famille_id uuid;
  v_jeton uuid;
  v_prenom text;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.commandes_maquillage
  WHERE demande_id = p_demande_id FOR UPDATE;
  IF NOT FOUND OR c.checkout_intent_id IS DISTINCT FROM p_checkout_intent_id
     OR c.montant_centimes IS DISTINCT FROM p_montant_centimes THEN
    RAISE EXCEPTION 'Commande ou montant non conforme';
  END IF;

  IF c.statut = 'payee' THEN
    RETURN QUERY SELECT t.numero, t.prenom, t.id, f.jeton_prive
    FROM public.familles f JOIN public.tickets t ON t.famille_id = f.id
    WHERE f.demande_id = p_demande_id ORDER BY t.numero;
    RETURN;
  END IF;

  IF c.statut <> 'en_attente' THEN RAISE EXCEPTION 'Commande non prête'; END IF;
  IF c.helloasso_order_id IS NULL THEN RAISE EXCEPTION 'Numéro de commande HelloAsso manquant'; END IF;
  -- Un encaissement confirmé reste à honorer, même si le stand ferme entretemps.
  SELECT f.id, f.jeton_prive INTO v_famille_id, v_jeton
  FROM public.familles f WHERE f.demande_id = p_demande_id;
  IF v_famille_id IS NOT NULL THEN RAISE EXCEPTION 'Demande déjà attribuée'; END IF;

  INSERT INTO public.familles(demande_id, recuperation_hash)
  VALUES (p_demande_id, c.recuperation_hash)
  RETURNING id, familles.jeton_prive INTO v_famille_id, v_jeton;

  FOREACH v_prenom IN ARRAY c.prenoms LOOP
    INSERT INTO public.tickets(famille_id, stand_id, prenom, statut, helloasso_order_id)
    VALUES (v_famille_id, c.stand_id, v_prenom, 'attente', c.helloasso_order_id)
    RETURNING * INTO v_ticket;
    numero := v_ticket.numero;
    prenom := v_ticket.prenom;
    ticket_id := v_ticket.id;
    jeton_prive := v_jeton;
    RETURN NEXT;
  END LOOP;
  UPDATE public.commandes_maquillage SET statut = 'payee', updated_at = now()
  WHERE demande_id = p_demande_id;
END;
$$;
REVOKE ALL ON FUNCTION public.finaliser_commande_maquillage(uuid, bigint, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finaliser_commande_maquillage(uuid, bigint, integer) TO service_role;


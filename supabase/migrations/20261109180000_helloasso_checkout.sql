-- Paiement HelloAsso : ne jamais attribuer de ticket avant la vérification API.
ALTER TABLE public.stands ADD COLUMN IF NOT EXISTS prix_enfant_centimes integer NOT NULL DEFAULT 0;
ALTER TABLE public.stands DROP CONSTRAINT IF EXISTS stands_prix_enfant_centimes_check;
ALTER TABLE public.stands ADD CONSTRAINT stands_prix_enfant_centimes_check
  CHECK (prix_enfant_centimes BETWEEN 0 AND 100000);

CREATE TABLE public.commandes_maquillage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id uuid NOT NULL UNIQUE,
  stand_id uuid NOT NULL REFERENCES public.stands(id),
  prenoms text[] NOT NULL CHECK (cardinality(prenoms) BETWEEN 1 AND 10),
  recuperation_hash text NOT NULL CHECK (recuperation_hash ~ '^[0-9a-f]{64}$'),
  prix_unitaire_centimes integer NOT NULL CHECK (prix_unitaire_centimes > 0),
  montant_centimes integer NOT NULL CHECK (montant_centimes > 0),
  checkout_intent_id bigint UNIQUE,
  statut text NOT NULL DEFAULT 'preparation'
    CHECK (statut IN ('preparation', 'en_attente', 'payee')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commandes_maquillage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commandes_maquillage FROM PUBLIC, anon, authenticated;
CREATE INDEX commandes_maquillage_en_attente ON public.commandes_maquillage(created_at)
 WHERE statut <> 'payee';

-- Une même commande et un même checkout ne peuvent émettre des tickets qu'une fois.
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
  -- Un encaissement confirmé reste à honorer, même si le stand ferme entretemps.
  SELECT f.id, f.jeton_prive INTO v_famille_id, v_jeton
  FROM public.familles f WHERE f.demande_id = p_demande_id;
  IF v_famille_id IS NOT NULL THEN RAISE EXCEPTION 'Demande déjà attribuée'; END IF;

  INSERT INTO public.familles(demande_id, recuperation_hash)
  VALUES (p_demande_id, c.recuperation_hash)
  RETURNING id, familles.jeton_prive INTO v_famille_id, v_jeton;

  FOREACH v_prenom IN ARRAY c.prenoms LOOP
    INSERT INTO public.tickets(famille_id, stand_id, prenom, statut)
    VALUES (v_famille_id, c.stand_id, v_prenom, 'attente')
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

-- Corriger les prénoms d'un panier avant le règlement sans changer quantité ou montant.
CREATE OR REPLACE FUNCTION public.modifier_prenoms_commande_maquillage(
  p_demande_id uuid, p_recuperation_hash text, p_prenoms text[]
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_commande public.commandes_maquillage%ROWTYPE;
  v_prenom text;
BEGIN
  SELECT * INTO v_commande FROM public.commandes_maquillage
  WHERE demande_id = p_demande_id FOR UPDATE;

  IF NOT FOUND OR v_commande.recuperation_hash IS DISTINCT FROM p_recuperation_hash
     OR v_commande.statut NOT IN ('en_attente', 'preparation') THEN
    RAISE EXCEPTION 'Commande non modifiable';
  END IF;
  IF p_prenoms IS NULL OR cardinality(p_prenoms) <> cardinality(v_commande.prenoms) THEN
    RAISE EXCEPTION 'Le nombre d enfants ne peut pas changer';
  END IF;
  FOREACH v_prenom IN ARRAY p_prenoms LOOP
    IF v_prenom IS NULL OR length(btrim(v_prenom)) NOT BETWEEN 1 AND 35 THEN
      RAISE EXCEPTION 'Prénom invalide';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.familles f
    WHERE f.demande_id = p_demande_id
  ) THEN
    RAISE EXCEPTION 'Tickets déjà émis';
  END IF;
  UPDATE public.commandes_maquillage
  SET prenoms = ARRAY(SELECT btrim(p) FROM unnest(p_prenoms) AS p),
      updated_at = now()
  WHERE id = v_commande.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.modifier_prenoms_commande_maquillage(uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.modifier_prenoms_commande_maquillage(uuid, text, text[]) TO service_role;

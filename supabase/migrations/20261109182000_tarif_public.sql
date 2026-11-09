CREATE OR REPLACE FUNCTION public.tarif_maquillage_public()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT CASE WHEN s.statut = 'ouvert' THEN s.prix_enfant_centimes ELSE 0 END
  FROM public.stands s WHERE s.nom = 'Maquillage - Marché de Noël' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.tarif_maquillage_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tarif_maquillage_public() TO anon, authenticated, service_role;

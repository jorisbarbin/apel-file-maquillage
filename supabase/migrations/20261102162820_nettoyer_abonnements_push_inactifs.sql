-- Désactiver les abonnements Push lorsqu'une famille
-- ne possède plus aucun ticket actif.
CREATE OR REPLACE FUNCTION public.nettoyer_abonnements_push_inactifs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.statut IN ('termine', 'annule', 'absent')
       AND OLD.statut IS DISTINCT FROM NEW.statut
       AND NOT EXISTS (
           SELECT 1
           FROM public.tickets t
           WHERE t.famille_id = NEW.famille_id
             AND t.statut IN ('attente', 'appele', 'en_cours')
       )
    THEN
        UPDATE public.abonnements_push
        SET actif = false
        WHERE famille_id = NEW.famille_id
          AND actif = true;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nettoyer_abonnements_push_inactifs()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_nettoyer_abonnements_push
ON public.tickets;

CREATE TRIGGER trg_nettoyer_abonnements_push
AFTER UPDATE OF statut ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.nettoyer_abonnements_push_inactifs();

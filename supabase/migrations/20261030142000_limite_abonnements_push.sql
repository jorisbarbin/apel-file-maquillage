CREATE OR REPLACE FUNCTION public.limiter_abonnements_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    nombre_actifs integer;
BEGIN
    -- Aucun contrôle nécessaire pour un abonnement désactivé.
    IF NEW.actif IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    -- Une famille ne peut pas enregistrer deux nouveaux appareils
    -- simultanément sans que leurs contrôles soient sérialisés.
    PERFORM 1
    FROM public.familles
    WHERE id = NEW.famille_id
    FOR UPDATE;

    -- Un abonnement déjà actif peut être mis à jour librement.
    IF TG_OP = 'UPDATE'
       AND OLD.actif = TRUE
       AND OLD.famille_id = NEW.famille_id
    THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(*)
    INTO nombre_actifs
    FROM public.abonnements_push
    WHERE famille_id = NEW.famille_id
      AND actif = TRUE;

    IF nombre_actifs >= 5 THEN
        RAISE EXCEPTION 'Limite de 5 abonnements actifs atteinte.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_limiter_abonnements_push
ON public.abonnements_push;

CREATE TRIGGER trg_limiter_abonnements_push
BEFORE INSERT OR UPDATE OF actif, famille_id
ON public.abonnements_push
FOR EACH ROW
EXECUTE FUNCTION public.limiter_abonnements_push();

REVOKE ALL ON FUNCTION public.limiter_abonnements_push()
FROM PUBLIC, anon, authenticated;

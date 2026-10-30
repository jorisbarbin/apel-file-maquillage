-- Réévaluer les notifications à la réouverture d'un stand.
-- Aucun envoi HTTP n'est effectué ici.

CREATE OR REPLACE FUNCTION public.detecter_notifications_reouverture_stand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    -- Ne rien faire si le stand n'est pas en cours de réouverture.
    IF NEW.statut <> 'ouvert'
       OR OLD.statut = 'ouvert'
    THEN
        RETURN NEW;
    END IF;

    -- Préparer les alertes des enfants proches de leur tour.
    INSERT INTO public.notifications_push (
        ticket_id,
        type_notification
    )
    SELECT
        t.id,
        'approche'
    FROM public.tickets AS t
    WHERE t.stand_id = NEW.id
      AND t.statut = 'attente'
      AND (
          SELECT count(*)
          FROM public.tickets AS autres
          WHERE autres.stand_id = NEW.id
            AND autres.statut IN (
                'attente',
                'appele',
                'en_cours'
            )
            AND (
                autres.ordre_passage < t.ordre_passage
                OR (
                    autres.ordre_passage = t.ordre_passage
                    AND autres.numero < t.numero
                )
            )
      ) <= 5

    ON CONFLICT (ticket_id, type_notification)
    DO NOTHING;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.detecter_notifications_reouverture_stand()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_reouverture_stand
ON public.stands;

CREATE TRIGGER trg_notifications_reouverture_stand
AFTER UPDATE OF statut
ON public.stands
FOR EACH ROW
WHEN (
    OLD.statut IS DISTINCT FROM NEW.statut
    AND NEW.statut = 'ouvert'
)
EXECUTE FUNCTION public.detecter_notifications_reouverture_stand();

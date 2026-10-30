-- Détecter les notifications uniquement pour le stand concerné.
CREATE OR REPLACE FUNCTION public.detecter_notifications_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN

    -- 1. Lorsqu'un enfant est appelé par un bénévole.
    IF NEW.statut = 'appele'
       AND (
           TG_OP = 'INSERT'
           OR OLD.statut IS DISTINCT FROM 'appele'
       )
    THEN
        INSERT INTO public.notifications_push (
            ticket_id,
            type_notification
        )
        VALUES (
            NEW.id,
            'appele'
        )
        ON CONFLICT (ticket_id, type_notification)
        DO NOTHING;
    END IF;

    -- 2. Rechercher les enfants qui ont 5 enfants
    -- ou moins devant eux.
    -- Reprendre le calcul de consulter_mes_tickets.

    INSERT INTO public.notifications_push (
        ticket_id,
        type_notification
    )
    SELECT
        t.id,
        'approche'
    FROM public.tickets AS t
    JOIN public.stands AS s
        ON s.id = t.stand_id
    WHERE t.statut = 'attente'
      AND t.stand_id = NEW.stand_id
      AND s.statut = 'ouvert'
      AND (
          SELECT COUNT(*)
          FROM public.tickets AS autres
          WHERE autres.stand_id = t.stand_id

            AND (
                autres.ordre_passage < t.ordre_passage

                OR (
                    autres.ordre_passage = t.ordre_passage
                    AND autres.numero < t.numero
                )
            )

            AND autres.statut IN (
                'attente',
                'appele',
                'en_cours'
            )
      ) <= 5

    -- Une seule notification "approche" par ticket.
    ON CONFLICT (ticket_id, type_notification)
    DO NOTHING;

    RETURN NEW;
END;
$function$;

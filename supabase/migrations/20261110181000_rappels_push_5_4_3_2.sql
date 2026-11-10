-- Rappels distincts à 5, 4, 3 et 2 enfants devant, puis à l'appel.
-- Préserve les verrous de test et de production du worker Push.
BEGIN;
ALTER TABLE public.notifications_push DROP CONSTRAINT IF EXISTS notifications_push_type_notification_check;
ALTER TABLE public.notifications_push
 ADD CONSTRAINT notifications_push_type_notification_check
 CHECK (type_notification IN ('approche', 'approche_5', 'approche_4', 'approche_3', 'approche_2', 'appele'));

-- Les anciens événements « approche » restent en historique mais ne sont plus envoyés.
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
        'approche_' || (SELECT COUNT(*)::text FROM public.tickets AS autres
          WHERE autres.stand_id = t.stand_id
            AND autres.statut IN ('attente', 'appele', 'en_cours')
            AND (autres.ordre_passage < t.ordre_passage OR
              (autres.ordre_passage = t.ordre_passage AND autres.numero < t.numero)))
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
      ) BETWEEN 2 AND 5

    -- Une seule notification "approche" par ticket.
    ON CONFLICT (ticket_id, type_notification)
    DO NOTHING;

    RETURN NEW;
END;
$function$;

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
        'approche_' || (SELECT COUNT(*)::text FROM public.tickets AS autres
          WHERE autres.stand_id = t.stand_id
            AND autres.statut IN ('attente', 'appele', 'en_cours')
            AND (autres.ordre_passage < t.ordre_passage OR
              (autres.ordre_passage = t.ordre_passage AND autres.numero < t.numero)))
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
      ) BETWEEN 2 AND 5

    ON CONFLICT (ticket_id, type_notification)
    DO NOTHING;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preparer_destinataires_push()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_nombre integer := 0;
BEGIN

    INSERT INTO public.envois_push (
        notification_id,
        abonnement_id
    )
    SELECT
        n.id,
        a.id
    FROM public.notifications_push AS n

    JOIN public.tickets AS t
        ON t.id = n.ticket_id

    JOIN public.abonnements_push AS a
        ON a.famille_id = t.famille_id

    WHERE a.actif = TRUE

      -- Ne préparer que les événements encore pertinents.
      AND (
          (
              n.type_notification IN ('approche_5', 'approche_4', 'approche_3', 'approche_2')
              AND t.statut = 'attente'
          )
          OR
          (
              n.type_notification = 'appele'
              AND t.statut IN ('appele', 'en_cours')
          )
      )

      -- Ne pas préparer de nouveaux destinataires
      -- pour une notification déjà traitée.
      AND n.statut = 'en_attente'

    ON CONFLICT (notification_id, abonnement_id)
    DO NOTHING;

    GET DIAGNOSTICS v_nombre = ROW_COUNT;

    RETURN v_nombre;
END;
$$;
REVOKE ALL ON FUNCTION public.preparer_destinataires_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preparer_destinataires_push() TO service_role;

CREATE OR REPLACE FUNCTION public.reserver_envois_push(p_limite integer DEFAULT 20, p_endpoint_test text DEFAULT NULL::text, p_ticket_test uuid DEFAULT NULL::uuid)
 RETURNS TABLE(envoi_id uuid, reservation_id uuid, endpoint text, cle_p256dh text, cle_auth text, type_notification text, prenom text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN

    IF p_limite IS NULL
       OR p_limite < 1
       OR p_limite > 50
    THEN
        RAISE EXCEPTION 'Limite invalide';
    END IF;

    RETURN QUERY
    WITH candidats AS (
        SELECT e.id
        FROM public.envois_push AS e

        JOIN public.notifications_push AS n
            ON n.id = e.notification_id

        JOIN public.tickets AS t
            ON t.id = n.ticket_id

        JOIN public.abonnements_push AS a
            ON a.id = e.abonnement_id
        JOIN public.stands AS s
            ON s.id = t.stand_id

        WHERE a.actif = TRUE
          AND n.statut = 'en_attente'
          AND (p_ticket_test IS NULL OR t.id = p_ticket_test)
          AND s.statut = 'ouvert'
          AND e.tentatives < 5

          -- Si un endpoint de test est fourni,
          -- réserver exclusivement cet abonnement.
          AND (
              p_endpoint_test IS NULL
              OR a.endpoint = p_endpoint_test
          )

          AND (
              (
                  e.statut IN ('en_attente', 'echec')
                  AND e.prochaine_tentative_at <= now()
              )
              OR
              (
                  e.statut = 'en_cours'
                  AND e.updated_at < now() - interval '2 minutes'
              )
          )

          AND (
              (
                  n.type_notification IN ('approche_5', 'approche_4', 'approche_3', 'approche_2')
                  AND t.statut = 'attente'
                  AND (
                      SELECT count(*)
                      FROM public.tickets AS autres
                      WHERE autres.stand_id = t.stand_id
                        AND autres.statut IN (
                            'attente', 'appele', 'en_cours'
                        )
                        AND (
                            autres.ordre_passage < t.ordre_passage
                            OR (
                                autres.ordre_passage = t.ordre_passage
                                AND autres.numero < t.numero
                            )
                        )
                  ) = CASE n.type_notification
                    WHEN 'approche_5' THEN 5 WHEN 'approche_4' THEN 4
                    WHEN 'approche_3' THEN 3 WHEN 'approche_2' THEN 2
                    ELSE -1 END
              )
              OR
              (
                  n.type_notification = 'appele'
                  AND t.statut IN ('appele', 'en_cours')
              )
          )

        ORDER BY
            e.prochaine_tentative_at,
            e.created_at

        LIMIT p_limite
        FOR UPDATE OF e SKIP LOCKED
    ),

    reservations AS (
        UPDATE public.envois_push AS e
        SET
            statut = 'en_cours',
            tentatives = e.tentatives + 1,
            reservation_id = gen_random_uuid(),
            updated_at = now()
        FROM candidats AS c
        WHERE e.id = c.id
        RETURNING
            e.id,
            e.reservation_id,
            e.notification_id,
            e.abonnement_id
    )

    SELECT
        r.id,
        r.reservation_id,
        a.endpoint,
        a.cle_p256dh,
        a.cle_auth,
        n.type_notification,
        t.prenom
    FROM reservations AS r

    JOIN public.notifications_push AS n
        ON n.id = r.notification_id

    JOIN public.tickets AS t
        ON t.id = n.ticket_id

    JOIN public.abonnements_push AS a
        ON a.id = r.abonnement_id;

END;
$function$;
REVOKE ALL ON FUNCTION public.reserver_envois_push(integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserver_envois_push(integer, text, uuid) TO service_role;
COMMIT;

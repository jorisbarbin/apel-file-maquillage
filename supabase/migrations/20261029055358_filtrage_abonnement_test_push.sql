
-- Remplacer l'ancienne signature par la version filtrable.
DROP FUNCTION IF EXISTS public.reserver_envois_push(integer);

CREATE OR REPLACE FUNCTION public.reserver_envois_push(
    p_limite integer DEFAULT 20,
    p_endpoint_test text DEFAULT NULL
)
RETURNS TABLE(
    envoi_id uuid,
    reservation_id uuid,
    endpoint text,
    cle_p256dh text,
    cle_auth text,
    type_notification text,
    prenom text
)
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

        WHERE a.actif = TRUE
          AND e.tentatives < 5

          -- Filtrer avant toute reservation.
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
                  n.type_notification = 'approche'
                  AND t.statut = 'attente'
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

-- Acces reserve au serveur Supabase.
REVOKE ALL ON FUNCTION public.reserver_envois_push(integer, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserver_envois_push(integer, text)
TO service_role;

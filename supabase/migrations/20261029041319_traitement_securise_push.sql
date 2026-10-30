
-- Réserver les envois Push pour un traitement serveur.
-- Aucun message n'est envoyé par cette fonction.

CREATE OR REPLACE FUNCTION public.reserver_envois_push(
    p_limite integer DEFAULT 20
)
RETURNS TABLE (
    envoi_id uuid,
    endpoint text,
    cle_p256dh text,
    cle_auth text,
    type_notification text,
    prenom text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

          -- Ne réserver que les alertes encore pertinentes.
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

        -- Éviter que deux traitements prennent
        -- simultanément les mêmes envois.
        FOR UPDATE OF e SKIP LOCKED
    ),

    reservations AS (
        UPDATE public.envois_push AS e
        SET
            statut = 'en_cours',
            tentatives = e.tentatives + 1,
            updated_at = now()
        FROM candidats AS c
        WHERE e.id = c.id
        RETURNING
            e.id,
            e.notification_id,
            e.abonnement_id
    )

    SELECT
        r.id,
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
$$;

-- Interdire l'appel depuis les comptes publics.
REVOKE ALL ON FUNCTION public.reserver_envois_push(integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserver_envois_push(integer)
TO service_role;

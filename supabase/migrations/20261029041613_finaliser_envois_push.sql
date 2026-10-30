
-- Sécuriser les confirmations d'envoi Web Push.
-- Aucune notification réelle n'est envoyée par cette migration.

-- Chaque réservation possède un identifiant unique.
ALTER TABLE public.envois_push
ADD COLUMN IF NOT EXISTS reservation_id uuid;

-- Remplacer la fonction précédente pour retourner
-- également l'identifiant de la réservation.
-- PostgreSQL impose de supprimer la fonction
-- avant de modifier son type de résultat.
DROP FUNCTION public.reserver_envois_push(integer);

CREATE FUNCTION public.reserver_envois_push(
    p_limite integer DEFAULT 20
)
RETURNS TABLE (
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
$$;

REVOKE ALL ON FUNCTION public.reserver_envois_push(integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserver_envois_push(integer)
TO service_role;


-- Confirmer le résultat d'une tentative d'envoi.
CREATE FUNCTION public.finaliser_envoi_push(
    p_envoi_id uuid,
    p_reservation_id uuid,
    p_resultat text,
    p_erreur text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_envoi public.envois_push;
BEGIN

    IF p_resultat IS NULL
       OR p_resultat NOT IN ('envoye', 'echec', 'expire')
    THEN
        RAISE EXCEPTION 'Résultat invalide';
    END IF;

    -- Verrouiller l'envoi et vérifier son propriétaire.
    SELECT *
    INTO v_envoi
    FROM public.envois_push
    WHERE id = p_envoi_id
      AND reservation_id = p_reservation_id
      AND statut = 'en_cours'
    FOR UPDATE;

    -- Réservation absente ou devenue obsolète.
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF p_resultat = 'envoye' THEN

        UPDATE public.envois_push
        SET
            statut = 'envoye',
            sent_at = now(),
            erreur = NULL,
            reservation_id = NULL,
            updated_at = now()
        WHERE id = p_envoi_id;

    ELSIF p_resultat = 'expire' THEN

        UPDATE public.envois_push
        SET
            statut = 'expire',
            erreur = left(
                coalesce(p_erreur, 'Abonnement expiré'),
                500
            ),
            reservation_id = NULL,
            updated_at = now()
        WHERE id = p_envoi_id;

        -- Désactiver cet abonnement devenu invalide.
        UPDATE public.abonnements_push
        SET
            actif = FALSE,
            updated_at = now()
        WHERE id = v_envoi.abonnement_id;

    ELSE

        -- Reporter les erreurs temporaires.
        -- Maximum cinq tentatives au total.
        UPDATE public.envois_push
        SET
            statut = 'echec',
            erreur = left(
                coalesce(p_erreur, 'Erreur d’envoi'),
                500
            ),
            prochaine_tentative_at =
                now() +
                make_interval(
                    mins => LEAST(
                        60,
                        2 ^ LEAST(v_envoi.tentatives, 5)
                    )::integer
                ),
            reservation_id = NULL,
            updated_at = now()
        WHERE id = p_envoi_id;

    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.finaliser_envoi_push(
    uuid, uuid, text, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finaliser_envoi_push(
    uuid, uuid, text, text
)
TO service_role;

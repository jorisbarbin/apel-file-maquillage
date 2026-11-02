CREATE OR REPLACE FUNCTION public.finaliser_envoi_push(
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

    -- Sérialiser le calcul global après la finalisation
    -- de l'envoi individuel.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            v_envoi.notification_id::text, 0
        )
    );

    -- Ne pas terminer la notification si un abonnement actif
    -- de la famille n'a pas encore d'envoi préparé.
    IF NOT EXISTS (
        SELECT 1
        FROM public.notifications_push n
        JOIN public.tickets t
            ON t.id = n.ticket_id
        JOIN public.abonnements_push a
            ON a.famille_id = t.famille_id
           AND a.actif = TRUE
        WHERE n.id = v_envoi.notification_id
          AND NOT EXISTS (
              SELECT 1
              FROM public.envois_push e
              WHERE e.notification_id = n.id
                AND e.abonnement_id = a.id
          )
    )
    -- Tous les envois préparés doivent être finalisés.
    AND NOT EXISTS (
        SELECT 1
        FROM public.envois_push e
        JOIN public.abonnements_push a
            ON a.id = e.abonnement_id
        WHERE e.notification_id = v_envoi.notification_id
          AND a.actif = TRUE
          AND e.statut IN ('en_attente', 'en_cours')
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.envois_push e
        JOIN public.abonnements_push a
            ON a.id = e.abonnement_id
        WHERE e.notification_id = v_envoi.notification_id
          AND a.actif = TRUE
          AND e.statut = 'echec'
          AND e.tentatives < 5
    )
    THEN
        UPDATE public.notifications_push n
        SET statut = CASE
            WHEN EXISTS (
                SELECT 1
                FROM public.envois_push e
                JOIN public.abonnements_push a
                    ON a.id = e.abonnement_id
                WHERE e.notification_id = n.id
                  AND a.actif = TRUE
                  AND e.statut = 'envoye'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM public.envois_push e
                JOIN public.abonnements_push a
                    ON a.id = e.abonnement_id
                WHERE e.notification_id = n.id
                  AND a.actif = TRUE
                  AND e.statut <> 'envoye'
            ) THEN 'envoyee'
            ELSE 'echec'
        END
        WHERE n.id = v_envoi.notification_id
          AND n.statut = 'en_attente';
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

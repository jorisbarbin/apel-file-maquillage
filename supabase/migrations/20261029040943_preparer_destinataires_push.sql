
-- Préparer les envois individuels des notifications Push.
-- Aucun message n'est envoyé par cette fonction.

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
              n.type_notification = 'approche'
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

-- Seul le rôle serveur peut préparer les envois.
REVOKE ALL ON FUNCTION public.preparer_destinataires_push()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preparer_destinataires_push()
TO service_role;

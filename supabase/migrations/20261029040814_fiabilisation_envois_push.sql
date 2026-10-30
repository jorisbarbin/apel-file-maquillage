
-- Suivi individuel des envois Push par appareil.
-- Une notification peut être destinée à plusieurs abonnements.

CREATE TABLE public.envois_push (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    notification_id uuid NOT NULL
        REFERENCES public.notifications_push(id)
        ON DELETE CASCADE,

    abonnement_id uuid NOT NULL
        REFERENCES public.abonnements_push(id)
        ON DELETE CASCADE,

    statut text NOT NULL DEFAULT 'en_attente'
        CHECK (
            statut IN (
                'en_attente',
                'en_cours',
                'envoye',
                'echec',
                'expire'
            )
        ),

    tentatives integer NOT NULL DEFAULT 0
        CHECK (tentatives >= 0),

    prochaine_tentative_at timestamptz NOT NULL DEFAULT now(),

    erreur text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,

    CONSTRAINT envois_push_notification_abonnement_unique
        UNIQUE (notification_id, abonnement_id)
);

-- Accélérer la récupération des envois en attente.
CREATE INDEX idx_envois_push_a_traiter
    ON public.envois_push (
        prochaine_tentative_at,
        created_at
    )
    WHERE statut IN ('en_attente', 'echec');

-- Retrouver rapidement les envois d'une notification.
CREATE INDEX idx_envois_push_notification
    ON public.envois_push (notification_id);

-- Protéger les données des abonnements.
ALTER TABLE public.envois_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envois_push FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.envois_push
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.envois_push
    TO service_role;

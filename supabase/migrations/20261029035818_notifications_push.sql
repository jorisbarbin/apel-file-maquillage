
-- File d'envoi des notifications Push de l'APEL.
-- Une notification de chaque type au maximum par ticket.

CREATE TABLE public.notifications_push (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    ticket_id uuid NOT NULL
        REFERENCES public.tickets(id) ON DELETE CASCADE,

    type_notification text NOT NULL
        CHECK (type_notification IN ('approche', 'appele')),

    statut text NOT NULL DEFAULT 'en_attente'
        CHECK (
            statut IN (
                'en_attente',
                'en_cours',
                'envoyee',
                'echec'
            )
        ),

    tentatives integer NOT NULL DEFAULT 0
        CHECK (tentatives >= 0),

    prochaine_tentative_at timestamptz NOT NULL DEFAULT now(),

    erreur text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,

    CONSTRAINT notifications_push_ticket_type_unique
        UNIQUE (ticket_id, type_notification)
);

-- Accélérer la recherche des notifications à traiter.
CREATE INDEX idx_notifications_push_a_traiter
    ON public.notifications_push (
        prochaine_tentative_at,
        created_at
    )
    WHERE statut IN ('en_attente', 'echec');

-- Empêcher l'accès direct depuis le navigateur.
ALTER TABLE public.notifications_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_push FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notifications_push
    FROM PUBLIC, anon, authenticated;

-- Seules les fonctions serveur pourront gérer les envois.
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.notifications_push
    TO service_role;

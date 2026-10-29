
-- Abonnements aux notifications Push des familles.
CREATE TABLE IF NOT EXISTS public.abonnements_push (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    famille_id uuid NOT NULL
        REFERENCES public.familles(id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    cle_p256dh text NOT NULL,
    cle_auth text NOT NULL,
    actif boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT abonnements_push_famille_endpoint_key
        UNIQUE (famille_id, endpoint)
);

-- Recherche rapide des abonnements d'une famille.
CREATE INDEX IF NOT EXISTS idx_abonnements_push_famille
    ON public.abonnements_push (famille_id);

-- Aucune lecture ou écriture directe depuis le navigateur.
ALTER TABLE public.abonnements_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abonnements_push FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.abonnements_push
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.abonnements_push TO service_role;

-- Autoriser les fonctions serveur à identifier les familles.
-- Aucun droit supplémentaire pour les visiteurs anonymes.
GRANT SELECT ON TABLE public.familles TO service_role;
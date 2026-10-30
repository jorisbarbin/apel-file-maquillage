-- Compteur indépendant pour les demandes d'abonnement Web Push.
CREATE TABLE public.limites_abonnements_push (
    cle_hash text PRIMARY KEY,
    debut_periode timestamptz NOT NULL DEFAULT now(),
    tentatives integer NOT NULL DEFAULT 0,
    CONSTRAINT limites_abonnements_push_hash_valide
        CHECK (cle_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.limites_abonnements_push
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.limites_abonnements_push
    FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.limites_abonnements_push
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.limites_abonnements_push
    TO service_role;

-- Dix demandes au maximum par période de quinze minutes.
CREATE OR REPLACE FUNCTION public.autoriser_tentative_abonnement_push(
    p_cle_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_tentatives integer;
BEGIN
    IF p_cle_hash IS NULL
       OR p_cle_hash !~ '^[0-9a-f]{64}$'
    THEN
        RAISE EXCEPTION 'Clé de limitation invalide';
    END IF;

    INSERT INTO public.limites_abonnements_push (
        cle_hash, debut_periode, tentatives
    )
    VALUES (p_cle_hash, now(), 1)
    ON CONFLICT (cle_hash)
    DO UPDATE SET
        tentatives = CASE
            WHEN limites_abonnements_push.debut_periode
                 <= now() - interval '15 minutes'
            THEN 1
            ELSE limites_abonnements_push.tentatives + 1
        END,
        debut_periode = CASE
            WHEN limites_abonnements_push.debut_periode
                 <= now() - interval '15 minutes'
            THEN now()
            ELSE limites_abonnements_push.debut_periode
        END
    RETURNING tentatives INTO v_tentatives;

    RETURN v_tentatives <= 10;
END;
$function$;

REVOKE ALL ON FUNCTION public.autoriser_tentative_abonnement_push(text)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.autoriser_tentative_abonnement_push(text)
    TO service_role;

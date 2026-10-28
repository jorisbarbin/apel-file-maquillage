SET local check_function_bodies = off;

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "service_role";

CREATE SEQUENCE "public"."ordre_passage_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

REVOKE ALL ON SEQUENCE "public"."ordre_passage_seq" FROM "anon", "authenticated";

CREATE TABLE "public"."benevoles" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "prenom"     text                     NOT NULL,
  "actif"      boolean                  DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "demande_id" uuid,
  "retire"     boolean                  NOT NULL DEFAULT false,
  CONSTRAINT "benevoles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."benevoles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."familles" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"        timestamp with time zone DEFAULT now(),
  "jeton_prive"       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "demande_id"        uuid,
  "recuperation_hash" text,
  CONSTRAINT "familles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."familles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."limites_inscriptions" (
  "cle_hash"      text                     NOT NULL,
  "debut_periode" timestamp with time zone NOT NULL DEFAULT now(),
  "tentatives"    integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "limites_inscriptions_pkey" PRIMARY KEY (cle_hash)
);

ALTER TABLE "public"."limites_inscriptions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."limites_inscriptions" FROM "anon", "authenticated";

CREATE TABLE "public"."sessions" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "benevole_id" uuid,
  "role"        text                     NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now(),
  "token_hash"  text,
  "expires_at"  timestamp with time zone,
  "revoked_at"  timestamp with time zone,
  CONSTRAINT "sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "sessions_role_benevole_coherence" CHECK ((((role = 'benevole'::text) AND (benevole_id IS NOT NULL)) OR ((role = 'responsable'::text) AND (benevole_id IS NULL)))),
  CONSTRAINT "sessions_role_check" CHECK ((role = ANY (ARRAY['benevole'::text, 'responsable'::text])))
);

ALTER TABLE "public"."sessions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."sessions" FROM "anon", "authenticated";

CREATE TABLE "public"."stands" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "nom"        text                     NOT NULL DEFAULT 'Stand maquillage'::text,
  "statut"     text                     NOT NULL DEFAULT 'ferme'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "stands_pkey" PRIMARY KEY (id),
  CONSTRAINT "stands_statut_check" CHECK ((statut = ANY (ARRAY['ouvert'::text, 'suspendu'::text, 'ferme'::text])))
);

ALTER TABLE "public"."stands"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tickets" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "numero"        bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "famille_id"    uuid,
  "stand_id"      uuid,
  "prenom"        text                     NOT NULL,
  "statut"        text                     NOT NULL DEFAULT 'attente'::text,
  "created_at"    timestamp with time zone DEFAULT now(),
  "updated_at"    timestamp with time zone DEFAULT now(),
  "benevole_id"   uuid,
  "ordre_passage" bigint                   DEFAULT nextval('public.ordre_passage_seq'::regclass),
  CONSTRAINT "tickets_numero_key" UNIQUE (numero),
  CONSTRAINT "tickets_pkey" PRIMARY KEY (id),
  CONSTRAINT "tickets_statut_check" CHECK ((statut = ANY (ARRAY['attente'::text, 'appele'::text, 'en_cours'::text, 'termine'::text, 'absent'::text, 'annule'::text])))
);

ALTER TABLE "public"."tickets"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SEQUENCE "public"."tickets_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."tickets_numero_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."tickets_numero_seq" FROM "service_role";

CREATE OR REPLACE FUNCTION public.ajouter_benevole (
  p_prenom     text,
  p_demande_id uuid
)
  RETURNS public.benevoles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$

DECLARE
    v_prenom TEXT;
    v_benevole public.benevoles;

BEGIN

    v_prenom := pg_catalog.btrim(p_prenom);

    IF v_prenom IS NULL
       OR pg_catalog.char_length(v_prenom) < 2
       OR pg_catalog.char_length(v_prenom) > 35 THEN
        RAISE EXCEPTION 'Prénom invalide';
    END IF;

    IF p_demande_id IS NULL THEN
        RAISE EXCEPTION 'Identifiant de demande obligatoire';
    END IF;

    -- Créer le bénévole uniquement si cette demande
    -- n'a pas déjà été enregistrée.
    INSERT INTO public.benevoles (
        prenom,
        actif,
        demande_id
    )
    VALUES (
        v_prenom,
        TRUE,
        p_demande_id
    )
    ON CONFLICT (demande_id) DO NOTHING
    RETURNING * INTO v_benevole;

    -- Si la demande existe déjà, retrouver le bénévole.
    IF v_benevole.id IS NULL THEN

        SELECT *
        INTO v_benevole
        FROM public.benevoles
        WHERE demande_id = p_demande_id;

        -- Empêcher de réutiliser une demande
        -- pour créer un autre prénom.
        IF v_benevole.prenom IS DISTINCT FROM v_prenom THEN
            RAISE EXCEPTION
                'Identifiant de demande déjà utilisé';
        END IF;

    END IF;

    RETURN v_benevole;

END;

$function$;

REVOKE ALL ON FUNCTION "public"."ajouter_benevole"(text, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.annuler_ticket_responsable (
  p_ticket_numero bigint
)
  RETURNS public.tickets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_ticket public.tickets;
BEGIN
    IF p_ticket_numero IS NULL OR p_ticket_numero <= 0 THEN
        RAISE EXCEPTION 'Numéro de ticket invalide';
    END IF;

    -- Verrouiller le ticket pour éviter une modification simultanée.
    SELECT *
    INTO v_ticket
    FROM public.tickets
    WHERE numero = p_ticket_numero
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket introuvable';
    END IF;

    -- Seul un ticket en attente peut être annulé.
    IF v_ticket.statut <> 'attente' THEN
        RAISE EXCEPTION
            'Seul un ticket en attente peut être annulé';
    END IF;

    UPDATE public.tickets
    SET
        statut = 'annule',
        benevole_id = NULL,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    RETURN v_ticket;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."annuler_ticket_responsable"(bigint) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.appeler_suivant (
  p_benevole_id uuid
)
  RETURNS public.tickets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$

DECLARE
    v_ticket public.tickets;

BEGIN

    -- Vérifier que le bénévole existe et qu'il est actif.

    IF NOT EXISTS (
        SELECT 1
        FROM public.benevoles
        WHERE id = p_benevole_id
          AND actif = TRUE
    ) THEN
        RAISE EXCEPTION 'Bénévole non disponible';
    END IF;

    -- Empêcher deux appels simultanés
    -- pour le même bénévole.

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_benevole_id::text, 0)
    );

    -- Un bénévole ne peut pas avoir
    -- deux enfants en cours.

    IF EXISTS (
        SELECT 1
        FROM public.tickets
        WHERE benevole_id = p_benevole_id
          AND statut IN ('appele', 'en_cours')
    ) THEN
        RAISE EXCEPTION
            'Ce bénévole a déjà un enfant en cours';
    END IF;

    -- Sélectionner le premier enfant disponible
    -- selon son ordre réel de passage.

    SELECT *
    INTO v_ticket
    FROM public.tickets
    WHERE statut = 'attente'
    ORDER BY
        ordre_passage ASC NULLS LAST,
        numero ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Attribuer l'enfant au bénévole.

    UPDATE public.tickets
    SET
        statut = 'appele',
        benevole_id = p_benevole_id,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    RETURN v_ticket;

END;

$function$;

REVOKE ALL ON FUNCTION "public"."appeler_suivant"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.autoriser_tentative_inscription (
  p_cle_hash text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_tentatives INTEGER;
BEGIN

    -- La clé doit être une empreinte SHA-256,
    -- calculée par notre Edge Function.
    IF p_cle_hash IS NULL
       OR p_cle_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Clé de limitation invalide';
    END IF;

    -- Incrémentation atomique :
    -- évite le contournement par requêtes simultanées.
    INSERT INTO public.limites_inscriptions (
        cle_hash,
        debut_periode,
        tentatives
    )
    VALUES (
        p_cle_hash,
        NOW(),
        1
    )

    ON CONFLICT (cle_hash)
    DO UPDATE SET

        tentatives = CASE
            WHEN limites_inscriptions.debut_periode
                 <= NOW() - INTERVAL '15 minutes'
            THEN 1
            ELSE limites_inscriptions.tentatives + 1
        END,

        debut_periode = CASE
            WHEN limites_inscriptions.debut_periode
                 <= NOW() - INTERVAL '15 minutes'
            THEN NOW()
            ELSE limites_inscriptions.debut_periode
        END

    RETURNING tentatives INTO v_tentatives;

    -- Maximum 5 tentatives par période
    RETURN v_tentatives <= 5;

END;
$function$;

REVOKE ALL ON FUNCTION "public"."autoriser_tentative_inscription"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.consulter_mes_tickets (
  p_jeton uuid
)
  RETURNS TABLE (
    numero         bigint,
    prenom         text,
    statut         text,
    enfants_devant bigint
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$

    SELECT
        t.numero,
        t.prenom,
        t.statut,

        CASE
            WHEN t.statut = 'attente' THEN (
                SELECT COUNT(*)
                FROM public.tickets AS autres
                WHERE autres.stand_id = t.stand_id

                  -- Compter les enfants placés avant celui-ci.
                  AND (
                      autres.ordre_passage < t.ordre_passage

                      OR (
                          autres.ordre_passage = t.ordre_passage
                          AND autres.numero < t.numero
                      )
                  )

                  -- Ne compter que les enfants encore dans la file.
                  AND autres.statut IN (
                      'attente',
                      'appele',
                      'en_cours'
                  )
            )
            ELSE 0
        END AS enfants_devant

    FROM public.tickets AS t

    JOIN public.familles AS f
        ON f.id = t.famille_id

    WHERE f.jeton_prive = p_jeton

    ORDER BY t.numero;

$function$;

REVOKE ALL ON FUNCTION "public"."consulter_mes_tickets"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.corbeille_benevoles_responsable()
  RETURNS TABLE (
    id     uuid,
    prenom text,
    actif  boolean
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT
        b.id,
        b.prenom,
        b.actif
    FROM public.benevoles AS b
    WHERE b.retire = TRUE
    ORDER BY b.prenom;
$function$;

REVOKE ALL ON FUNCTION "public"."corbeille_benevoles_responsable"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.corbeille_tickets_responsable()
  RETURNS TABLE (
    numero          bigint,
    prenom          text,
    date_annulation timestamp with time zone
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT
        t.numero,
        t.prenom,
        t.updated_at AS date_annulation
    FROM public.tickets AS t
    JOIN public.stands AS s
      ON s.id = t.stand_id
    WHERE s.nom = 'Maquillage - Marché de Noël'
      AND t.statut = 'annule'
    ORDER BY t.updated_at DESC, t.numero DESC;
$function$;

REVOKE ALL ON FUNCTION "public"."corbeille_tickets_responsable"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.file_attente_responsable()
  RETURNS TABLE (
    numero     bigint,
    prenom     text,
    statut     text,
    benevole   text,
    created_at timestamp with time zone
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT
        t.numero,
        t.prenom,
        t.statut,
        b.prenom AS benevole,
        t.created_at
    FROM public.tickets AS t
    LEFT JOIN public.benevoles AS b
        ON b.id = t.benevole_id
    INNER JOIN public.stands AS s
        ON s.id = t.stand_id
    WHERE s.nom = 'Maquillage - Marché de Noël'
      AND t.statut IN (
          'attente',
          'appele',
          'en_cours',
          'absent'
      )
    ORDER BY
        CASE WHEN t.statut = 'absent' THEN 1 ELSE 0 END,
        t.ordre_passage ASC NULLS LAST,
        t.numero ASC;
$function$;

REVOKE ALL ON FUNCTION "public"."file_attente_responsable"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.inscrire_enfants (
  p_prenoms    text[],
  p_demande_id uuid
)
  RETURNS TABLE (
    numero      bigint,
    prenom      text,
    ticket_id   uuid,
    jeton_prive uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_stand_id UUID;
  v_famille_id UUID;
  v_jeton UUID;
  v_prenom TEXT;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF p_demande_id IS NULL THEN
    RAISE EXCEPTION 'Identifiant de demande obligatoire';
  END IF;

  IF p_prenoms IS NULL
     OR cardinality(p_prenoms) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Entre 1 et 10 enfants requis';
  END IF;

  -- Empêche deux inscriptions simultanées
  -- avec le même identifiant.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_demande_id::TEXT, 0)
  );

  -- Si la demande existe déjà, ne jamais
  -- renvoyer les informations privées.
  IF EXISTS (
    SELECT 1
    FROM public.familles f
    WHERE f.demande_id = p_demande_id
  ) THEN
    RAISE EXCEPTION 'Cette demande a déjà été enregistrée';
  END IF;

  -- Vérifie que les inscriptions sont ouvertes.
  SELECT s.id
  INTO v_stand_id
  FROM public.stands s
  WHERE s.statut = 'ouvert'
  ORDER BY s.created_at
  LIMIT 1
  FOR SHARE;

  IF v_stand_id IS NULL THEN
    RAISE EXCEPTION 'Inscriptions fermées';
  END IF;

  -- Vérifie les prénoms.
  FOREACH v_prenom IN ARRAY p_prenoms LOOP
    IF v_prenom IS NULL
       OR pg_catalog.length(pg_catalog.btrim(v_prenom))
          NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'Prénom invalide';
    END IF;
  END LOOP;

  -- Crée la famille et son jeton privé.
  INSERT INTO public.familles (demande_id)
  VALUES (p_demande_id)
  RETURNING id, familles.jeton_prive
  INTO v_famille_id, v_jeton;

  -- Crée un ticket par enfant.
  FOREACH v_prenom IN ARRAY p_prenoms LOOP

    INSERT INTO public.tickets (
      famille_id,
      stand_id,
      prenom,
      statut
    )
    VALUES (
      v_famille_id,
      v_stand_id,
      pg_catalog.btrim(v_prenom),
      'attente'
    )
    RETURNING *
    INTO v_ticket;

    numero := v_ticket.numero;
    prenom := v_ticket.prenom;
    ticket_id := v_ticket.id;
    jeton_prive := v_jeton;

    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."inscrire_enfants"(text[], uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.inscrire_enfants_securise (
  p_prenoms           text[],
  p_demande_id        uuid,
  p_recuperation_hash text
)
  RETURNS TABLE (
    numero      bigint,
    prenom      text,
    ticket_id   uuid,
    jeton_prive uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_stand_id UUID;
    v_famille_id UUID;
    v_jeton UUID;
    v_hash_existant TEXT;
    v_prenom TEXT;
    v_ticket public.tickets%ROWTYPE;
    v_prenoms_existants TEXT[];
BEGIN
    -- Validation des paramètres.
    IF p_demande_id IS NULL THEN
        RAISE EXCEPTION 'Identifiant de demande obligatoire';
    END IF;

    IF p_recuperation_hash IS NULL
       OR p_recuperation_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Empreinte de récupération invalide';
    END IF;

    IF p_prenoms IS NULL
       OR pg_catalog.cardinality(p_prenoms) NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'Entre 1 et 10 enfants requis';
    END IF;

    FOREACH v_prenom IN ARRAY p_prenoms LOOP
        IF v_prenom IS NULL
           OR pg_catalog.length(pg_catalog.btrim(v_prenom))
              NOT BETWEEN 1 AND 50 THEN
            RAISE EXCEPTION 'Prénom invalide';
        END IF;
    END LOOP;

    -- Empêcher le traitement simultané de la même demande.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_demande_id::TEXT, 0)
    );

    -- Rechercher une éventuelle inscription existante.
    SELECT f.id, f.jeton_prive, f.recuperation_hash
    INTO v_famille_id, v_jeton, v_hash_existant
    FROM public.familles f
    WHERE f.demande_id = p_demande_id;

    IF v_famille_id IS NOT NULL THEN

        -- Refuser la récupération sans la bonne preuve.
        IF v_hash_existant IS NULL
           OR v_hash_existant IS DISTINCT FROM p_recuperation_hash THEN
            RAISE EXCEPTION 'Récupération non autorisée';
        END IF;

        -- Vérifier que la demande concerne les mêmes enfants.
        SELECT pg_catalog.array_agg(t.prenom ORDER BY t.numero)
        INTO v_prenoms_existants
        FROM public.tickets t
        WHERE t.famille_id = v_famille_id;

        IF v_prenoms_existants IS DISTINCT FROM (
            SELECT pg_catalog.array_agg(pg_catalog.btrim(p) ORDER BY ord)
            FROM pg_catalog.unnest(p_prenoms)
                 WITH ORDINALITY AS x(p, ord)
        ) THEN
            RAISE EXCEPTION 'Prénoms différents de la demande initiale';
        END IF;

        -- Restituer les tickets existants sans en créer.
        RETURN QUERY
        SELECT
            t.numero,
            t.prenom,
            t.id,
            v_jeton
        FROM public.tickets t
        WHERE t.famille_id = v_famille_id
        ORDER BY t.numero;

        RETURN;
    END IF;

    -- Première inscription : vérifier l'ouverture du stand.
    SELECT s.id
    INTO v_stand_id
    FROM public.stands s
    WHERE s.statut = 'ouvert'
    ORDER BY s.created_at
    LIMIT 1
    FOR SHARE;

    IF v_stand_id IS NULL THEN
        RAISE EXCEPTION 'Inscriptions fermées';
    END IF;

    -- Créer la famille avec son empreinte de récupération.
    INSERT INTO public.familles (
        demande_id,
        recuperation_hash
    )
    VALUES (
        p_demande_id,
        p_recuperation_hash
    )
    RETURNING familles.id, familles.jeton_prive
    INTO v_famille_id, v_jeton;

    -- Créer un ticket par enfant.
    FOREACH v_prenom IN ARRAY p_prenoms LOOP

        INSERT INTO public.tickets (
            famille_id,
            stand_id,
            prenom,
            statut
        )
        VALUES (
            v_famille_id,
            v_stand_id,
            pg_catalog.btrim(v_prenom),
            'attente'
        )
        RETURNING * INTO v_ticket;

        numero := v_ticket.numero;
        prenom := v_ticket.prenom;
        ticket_id := v_ticket.id;
        jeton_prive := v_jeton;

        RETURN NEXT;
    END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."inscrire_enfants_securise"(text[], uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.liste_benevoles_maquillage()
  RETURNS TABLE (
    id     uuid,
    prenom text
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT b.id, b.prenom
    FROM public.benevoles b
    WHERE b.actif = true
    ORDER BY b.prenom;
$function$;

REVOKE ALL ON FUNCTION "public"."liste_benevoles_maquillage"() FROM PUBLIC, "service_role";

CREATE OR REPLACE FUNCTION public.modifier_etat_benevole (
  p_benevole_id uuid,
  p_actif       boolean
)
  RETURNS public.benevoles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_benevole public.benevoles;
BEGIN
    -- Vérifier les paramètres.
    IF p_benevole_id IS NULL OR p_actif IS NULL THEN
        RAISE EXCEPTION 'Paramètres invalides';
    END IF;

    -- Verrouiller le bénévole.
    SELECT *
    INTO v_benevole
    FROM public.benevoles
    WHERE id = p_benevole_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bénévole introuvable';
    END IF;

    -- NOUVELLE PROTECTION : interdire toute modification
    -- d'un bénévole placé dans la corbeille.
    IF v_benevole.retire THEN
        RAISE EXCEPTION
            'Impossible de modifier un bénévole placé dans la corbeille';
    END IF;

    -- Refuser la désactivation d'un bénévole occupé.
    IF p_actif = FALSE AND EXISTS (
        SELECT 1
        FROM public.tickets
        WHERE benevole_id = p_benevole_id
          AND statut IN ('appele', 'en_cours')
    ) THEN
        RAISE EXCEPTION
            'Impossible de désactiver un bénévole occupé';
    END IF;

    -- Modifier son état.
    UPDATE public.benevoles
    SET actif = p_actif
    WHERE id = p_benevole_id
    RETURNING * INTO v_benevole;

    -- Révoquer les sessions existantes lors d'une désactivation.
    IF p_actif = FALSE THEN
        UPDATE public.sessions
        SET revoked_at = NOW()
        WHERE benevole_id = p_benevole_id
          AND revoked_at IS NULL;
    END IF;

    RETURN v_benevole;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."modifier_etat_benevole"(uuid, boolean) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.remettre_absent_en_attente (
  p_ticket_numero bigint
)
  RETURNS public.tickets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$

DECLARE
    v_ticket public.tickets;

BEGIN

    -- Verrouiller le ticket pour éviter deux modifications simultanées.
    SELECT *
    INTO v_ticket
    FROM public.tickets
    WHERE numero = p_ticket_numero
      AND statut = 'absent'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket absent introuvable';
    END IF;

    -- Lui attribuer une nouvelle position en fin de file.
    UPDATE public.tickets
    SET
        ordre_passage = nextval('public.ordre_passage_seq'::regclass),
        statut = 'attente',
        benevole_id = NULL,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    RETURN v_ticket;

END;

$function$;

REVOKE ALL ON FUNCTION "public"."remettre_absent_en_attente"(bigint) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.restaurer_benevole_responsable (
  p_benevole_id uuid
)
  RETURNS public.benevoles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_benevole public.benevoles;
BEGIN
    IF p_benevole_id IS NULL THEN
        RAISE EXCEPTION 'Identifiant bénévole invalide';
    END IF;

    -- Verrouiller le bénévole pour éviter
    -- deux restaurations simultanées.
    SELECT *
    INTO v_benevole
    FROM public.benevoles
    WHERE id = p_benevole_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bénévole introuvable';
    END IF;

    IF NOT v_benevole.retire THEN
        RAISE EXCEPTION 'Ce bénévole n''est pas dans la corbeille';
    END IF;

    -- Restaurer sans réactiver.
    UPDATE public.benevoles
    SET
        retire = FALSE,
        actif = FALSE
    WHERE id = p_benevole_id
    RETURNING * INTO v_benevole;

    RETURN v_benevole;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."restaurer_benevole_responsable"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.restaurer_ticket_responsable (
  p_ticket_numero bigint
)
  RETURNS public.tickets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_ticket public.tickets;
BEGIN
    IF p_ticket_numero IS NULL OR p_ticket_numero <= 0 THEN
        RAISE EXCEPTION 'Numéro de ticket invalide';
    END IF;

    -- Verrouiller le ticket pour éviter
    -- deux restaurations simultanées.
    SELECT *
    INTO v_ticket
    FROM public.tickets
    WHERE numero = p_ticket_numero
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket introuvable';
    END IF;

    -- Seul un ticket annulé peut être restauré.
    IF v_ticket.statut <> 'annule' THEN
        RAISE EXCEPTION 'Ce ticket n''est pas annulé';
    END IF;

    -- Replacer le ticket à la fin de la file.
    UPDATE public.tickets
    SET
        statut = 'attente',
        benevole_id = NULL,
        ordre_passage = nextval(
            'public.ordre_passage_seq'::regclass
        ),
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    RETURN v_ticket;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."restaurer_ticket_responsable"(bigint) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.retirer_benevole_responsable (
  p_benevole_id uuid
)
  RETURNS public.benevoles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_benevole public.benevoles;
BEGIN
    IF p_benevole_id IS NULL THEN
        RAISE EXCEPTION 'Identifiant bénévole invalide';
    END IF;

    -- Verrouiller le bénévole pendant l'opération.
    SELECT *
    INTO v_benevole
    FROM public.benevoles
    WHERE id = p_benevole_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bénévole introuvable';
    END IF;

    IF v_benevole.retire THEN
        RAISE EXCEPTION 'Ce bénévole est déjà retiré';
    END IF;

    -- Interdire le retrait pendant une prise en charge.
    IF EXISTS (
        SELECT 1
        FROM public.tickets
        WHERE benevole_id = p_benevole_id
          AND statut IN ('appele', 'en_cours')
    ) THEN
        RAISE EXCEPTION
            'Impossible de retirer un bénévole qui prend en charge un enfant';
    END IF;

    -- Désactiver et placer dans la corbeille.
    UPDATE public.benevoles
    SET
        actif = FALSE,
        retire = TRUE
    WHERE id = p_benevole_id
    RETURNING * INTO v_benevole;

    -- Révoquer ses sessions bénévoles existantes.
    UPDATE public.sessions
    SET revoked_at = NOW()
    WHERE benevole_id = p_benevole_id
      AND role = 'benevole'
      AND revoked_at IS NULL;

    RETURN v_benevole;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."retirer_benevole_responsable"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "anon", "authenticated", "service_role";

CREATE OR REPLACE FUNCTION public.signaler_enfant_absent (
  p_benevole_id uuid
)
  RETURNS public.tickets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$

DECLARE
    v_ticket public.tickets;

BEGIN

    -- Empêcher les actions simultanées
    -- concernant la même bénévole.

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_benevole_id::text, 0)
    );

    -- Rechercher uniquement l'enfant
    -- actuellement attribué à cette bénévole.

    UPDATE public.tickets
    SET
        statut = 'absent',
        benevole_id = NULL,
        updated_at = NOW()
    WHERE benevole_id = p_benevole_id
      AND statut IN ('appele', 'en_cours')
    RETURNING * INTO v_ticket;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Aucun enfant actuellement attribué';
    END IF;

    RETURN v_ticket;

END;

$function$;

REVOKE ALL ON FUNCTION "public"."signaler_enfant_absent"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.situation_benevoles()
  RETURNS TABLE (
    id            uuid,
    prenom        text,
    actif         boolean,
    occupe        boolean,
    ticket_numero bigint,
    enfant_prenom text
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT
        b.id,
        b.prenom,
        b.actif,

        (t.id IS NOT NULL) AS occupe,

        t.numero AS ticket_numero,
        t.prenom AS enfant_prenom

    FROM public.benevoles AS b

    LEFT JOIN LATERAL (
        SELECT
            ti.id,
            ti.numero,
            ti.prenom
        FROM public.tickets AS ti
        WHERE ti.benevole_id = b.id
          AND ti.statut IN ('appele', 'en_cours')
        ORDER BY ti.numero
        LIMIT 1
    ) AS t ON TRUE

    WHERE b.retire = FALSE

    ORDER BY b.prenom;
$function$;

REVOKE ALL ON FUNCTION "public"."situation_benevoles"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.statut_stand_maquillage()
  RETURNS TABLE (
    statut             text,
    enfants_en_attente bigint
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT
        s.statut,
        (
            SELECT COUNT(*)
            FROM public.tickets t
            WHERE t.stand_id = s.id
              AND t.statut = 'attente'
        ) AS enfants_en_attente
    FROM public.stands s
    WHERE s.nom = 'Maquillage - Marché de Noël'
    LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION "public"."statut_stand_maquillage"() FROM PUBLIC, "service_role";

CREATE OR REPLACE FUNCTION public.terminer_maquillage (
  p_benevole_id uuid
)
  RETURNS public.tickets
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_ticket public.tickets;
BEGIN

    UPDATE public.tickets
    SET
        statut = 'termine',
        updated_at = NOW()
    WHERE benevole_id = p_benevole_id
    AND statut IN ('appele', 'en_cours')
    RETURNING * INTO v_ticket;

    IF NOT FOUND THEN
        RAISE EXCEPTION
        'Aucun maquillage en cours';
    END IF;

    RETURN v_ticket;

END;
$function$;

REVOKE ALL ON FUNCTION "public"."terminer_maquillage"(uuid) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."sessions"
  ADD CONSTRAINT "sessions_benevole_id_fkey" FOREIGN KEY (benevole_id) REFERENCES public.benevoles(id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_benevole_id_fkey" FOREIGN KEY (benevole_id) REFERENCES public.benevoles(id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_famille_id_fkey" FOREIGN KEY (famille_id) REFERENCES public.familles(id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_stand_id_fkey" FOREIGN KEY (stand_id) REFERENCES public.stands(id);

CREATE UNIQUE INDEX benevoles_demande_id_unique ON public.benevoles USING btree (demande_id);

CREATE UNIQUE INDEX familles_recuperation_hash_unique ON public.familles USING btree (recuperation_hash);

CREATE UNIQUE INDEX idx_benevole_ticket_actif ON public.tickets USING btree (benevole_id)
  WHERE ((statut = ANY (ARRAY['appele'::text, 'en_cours'::text])) AND (benevole_id IS NOT NULL));

CREATE UNIQUE INDEX idx_familles_demande ON public.familles USING btree (demande_id);

CREATE UNIQUE INDEX idx_familles_jeton ON public.familles USING btree (jeton_prive);

CREATE INDEX idx_sessions_benevole ON public.sessions USING btree (benevole_id);

CREATE UNIQUE INDEX idx_sessions_token_hash ON public.sessions USING btree (token_hash)
  WHERE (token_hash IS NOT NULL);

CREATE INDEX idx_tickets_attente ON public.tickets USING btree (numero)
  WHERE (statut = 'attente'::text);

CREATE INDEX idx_tickets_famille ON public.tickets USING btree (famille_id);

CREATE INDEX idx_tickets_ordre_passage ON public.tickets USING btree (stand_id, ordre_passage)
  WHERE (statut = 'attente'::text);

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

REVOKE ALL ON FUNCTION "public"."ajouter_benevole"(text, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ajouter_benevole"(text, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ajouter_benevole"(text, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."annuler_ticket_responsable"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."annuler_ticket_responsable"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."annuler_ticket_responsable"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."appeler_suivant"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."appeler_suivant"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."appeler_suivant"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."autoriser_tentative_inscription"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."autoriser_tentative_inscription"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."autoriser_tentative_inscription"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."consulter_mes_tickets"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."consulter_mes_tickets"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."consulter_mes_tickets"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."corbeille_benevoles_responsable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."corbeille_benevoles_responsable"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."corbeille_benevoles_responsable"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."corbeille_tickets_responsable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."corbeille_tickets_responsable"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."corbeille_tickets_responsable"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."file_attente_responsable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."file_attente_responsable"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."file_attente_responsable"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."inscrire_enfants"(text[], uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."inscrire_enfants"(text[], uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."inscrire_enfants"(text[], uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."inscrire_enfants_securise"(text[], uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."inscrire_enfants_securise"(text[], uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."inscrire_enfants_securise"(text[], uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."liste_benevoles_maquillage"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."liste_benevoles_maquillage"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."liste_benevoles_maquillage"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."modifier_etat_benevole"(uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."modifier_etat_benevole"(uuid, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."modifier_etat_benevole"(uuid, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."remettre_absent_en_attente"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."remettre_absent_en_attente"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."remettre_absent_en_attente"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."restaurer_benevole_responsable"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."restaurer_benevole_responsable"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."restaurer_benevole_responsable"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."restaurer_ticket_responsable"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."restaurer_ticket_responsable"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."restaurer_ticket_responsable"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."retirer_benevole_responsable"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."retirer_benevole_responsable"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."retirer_benevole_responsable"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO PUBLIC;

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."signaler_enfant_absent"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."signaler_enfant_absent"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."signaler_enfant_absent"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."situation_benevoles"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."situation_benevoles"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."situation_benevoles"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."statut_stand_maquillage"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."statut_stand_maquillage"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."statut_stand_maquillage"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."terminer_maquillage"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."terminer_maquillage"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."terminer_maquillage"(uuid) TO "service_role";

REVOKE ALL ON SEQUENCE "public"."ordre_passage_seq" FROM "service_role";

GRANT USAGE ON SEQUENCE "public"."ordre_passage_seq" TO "service_role";

REVOKE ALL ON TABLE "public"."benevoles" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."benevoles" TO "anon";

REVOKE ALL ON TABLE "public"."benevoles" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."benevoles" TO "authenticated";

REVOKE ALL ON TABLE "public"."benevoles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."benevoles" TO "postgres";

REVOKE ALL ON TABLE "public"."benevoles" FROM "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."benevoles" TO "service_role";

REVOKE ALL ON TABLE "public"."familles" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."familles" TO "anon";

REVOKE ALL ON TABLE "public"."familles" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."familles" TO "authenticated";

REVOKE ALL ON TABLE "public"."familles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."familles" TO "postgres";

REVOKE ALL ON TABLE "public"."familles" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."familles" TO "service_role";

REVOKE ALL ON TABLE "public"."limites_inscriptions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."limites_inscriptions" TO "postgres";

REVOKE ALL ON TABLE "public"."limites_inscriptions" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."limites_inscriptions" TO "service_role";

REVOKE ALL ON TABLE "public"."sessions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sessions" TO "postgres";

REVOKE ALL ON TABLE "public"."sessions" FROM "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."sessions" TO "service_role";

REVOKE ALL ON TABLE "public"."stands" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."stands" TO "anon";

REVOKE ALL ON TABLE "public"."stands" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."stands" TO "authenticated";

REVOKE ALL ON TABLE "public"."stands" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stands" TO "postgres";

REVOKE ALL ON TABLE "public"."stands" FROM "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stands" TO "service_role";

REVOKE ALL ON TABLE "public"."tickets" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."tickets" TO "anon";

REVOKE ALL ON TABLE "public"."tickets" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."tickets" TO "authenticated";

REVOKE ALL ON TABLE "public"."tickets" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tickets" TO "postgres";

REVOKE ALL ON TABLE "public"."tickets" FROM "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tickets" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "service_role";


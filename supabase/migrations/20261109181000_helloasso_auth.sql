-- Jetons OAuth conservés exclusivement côté serveur, protégés par la clé service_role.
CREATE TABLE public.helloasso_auth_cache (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.helloasso_auth_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.helloasso_auth_cache FROM PUBLIC, anon, authenticated;

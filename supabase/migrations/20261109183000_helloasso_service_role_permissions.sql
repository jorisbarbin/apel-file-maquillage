-- Les Edge Functions utilisent service_role pour les commandes et les jetons OAuth.
-- Le contournement RLS de service_role ne remplace pas les privilèges SQL.
-- Ne jamais donner ces droits à anon ou authenticated.
GRANT SELECT, INSERT, UPDATE ON TABLE public.commandes_maquillage TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.helloasso_auth_cache TO service_role;

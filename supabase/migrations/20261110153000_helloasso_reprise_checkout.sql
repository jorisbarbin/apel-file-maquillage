-- Lien HelloAsso stocké côté serveur pour retrouver le même checkout après retour.
-- Le lien n'est pas exposé dans les lectures publiques de Supabase.
ALTER TABLE public.commandes_maquillage
  ADD COLUMN IF NOT EXISTS checkout_redirect_url text;

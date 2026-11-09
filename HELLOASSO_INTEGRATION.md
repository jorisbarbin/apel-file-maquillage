# Préparation HelloAsso Checkout (branche de développement)

**Ne pas fusionner / déployer en production sans les tests ci-dessous.** Les paiements réels ne sont pas activés dans le dépôt principal.

## Parcours prévu
- Le responsable fixe le prix unitaire en centimes (1 à 100000).
- Le parent voit le total calculé et valide son panier de 1 à 10 prénoms.
- Une Edge Function crée une commande idempotente et une intention HelloAsso Checkout.
- Au retour, l'Edge Function vérifie directement le checkout HelloAsso et le paiement CB autorisé pour le montant attendu, puis appelle une RPC PostgreSQL atomique pour créer les tickets.
- Les tickets restent disponibles sur l'appareil par le jeton privé, non imprimé.
- Le PDF ne contient que prénom et numéro de ticket, aucun QR code ni état de la file.

## Secrets Supabase Edge Functions
- `HELLOASSO_CLIENT_ID`, `HELLOASSO_CLIENT_SECRET`
- `HELLOASSO_ORGANIZATION_SLUG` (slug exact de l'association)
- `HELLOASSO_SANDBOX=true` pour les tests ; avec des identifiants SANDBOX distincts
- `HELLOASSO_RETURN_ORIGIN=https://apel-file-maquillage.vercel.app`
- Secrets existants : `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Ne jamais renseigner les secrets dans Vite, le navigateur ou GitHub.

## Mise en service (après validation)
1. Vérifier la bonne organisation HelloAsso, ses autorisations Checkout et son identité vérifiée.
2. Appliquer les 3 migrations SQL dans l'ordre.
3. Déployer la fonction `paiement-helloasso` et la nouvelle `gestion-stand`.
4. Déployer l'ancienne `inscrire-enfants` verrouillée avant d'activer un prix payant.
5. Déployer l'interface, puis enregistrer un prix dans l'espace Responsable.
6. Tester tout le parcours sur un domaine compatible Cloudflare Turnstile, avec **un compte HelloAsso sandbox**.
7. Contrôler en base : 0 ticket avant paiement, N tickets pour N enfants après paiement, idempotence après rechargement.
8. Tester paiement refusé, abandon, fermeture du stand, double retour, prix modifié, perte de réseau.
9. Tester le téléchargement et la lecture du PDF sur iPhone/Safari et Android.

## Points restant à traiter avant production
- Webhook ou tâche de réconciliation serveur pour confirmer un paiement même si le parent ne revient jamais.
- Reprise d'un checkout en préparation si l'API échoue, sans permettre un deuxième débit.
- Gestion sûre des rotations OAuth parallèles en cas de fortes inscriptions simultanées.
- Groupement opérationnel des enfants lors de l'appel par les bénévoles (l'attribution des numéros est déjà consécutive).
- Rapprochement des remboursements/contestation, et politique de conservation après événement.
- Ajouter des tests automatisés et vérifier le build Vite, les migrations et les fonctions Deno.
- Vérifier les montants retournés en sandbox dans la structure réelle `order.payments`.
- Prévoir un dispositif de secours et remboursement si encaissement confirmé alors que le stand est fermé.

## Documentation API
- https://dev.helloasso.com/docs/api-overview
- https://dev.helloasso.com/docs/validation-de-vos-paiements
- https://dev.helloasso.com/docs/secure-webhook

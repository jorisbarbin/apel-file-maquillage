# APEL SMSJ — File d’attente virtuelle du stand maquillage

Prototype React / Vite reprenant les couleurs jaune et blanc du logo fourni.

## Lancer

```bash
npm install
npm run dev
```

Ouvrir l’adresse locale indiquée par Vite.

## Ce qui fonctionne dans cette démonstration

- Inscription d’un ou plusieurs enfants, avec numéros de tickets successifs.
- Vue parent : nombre de tickets encore en attente devant chaque enfant et signal visuel à 5 enfants.
- Vue bénévole : accès PIN de démonstration `2468`, appel d’un enfant, bouton « Terminé », retour en attente.
- Vue responsable : suspension/reprise des inscriptions, liste des tickets, annulations, renouvellement du PIN.
- Persistance locale et synchronisation entre onglets **du même navigateur**.

## IMPORTANT : limites du prototype

**Ce n’est pas une version utilisable en production.** Les données sont dans `localStorage`, et ne sont donc **pas partagées entre les téléphones**. Le PIN est stocké en clair et la même authentification est utilisée pour le responsable : **ne pas utiliser ces accès pour un vrai événement**. Il n’y a pas encore de notifications push, de verrouillage de tickets en base, de protection contre les doublons, ni de véritable moteur de répartition entre bénévoles. La vue bénévole actuelle est une file commune de démonstration.

## Étape suivante pour le déploiement réel

Connecter une base PostgreSQL/Supabase, utiliser des opérations transactionnelles côté serveur pour l’attribution des tickets et des enfants aux bénévoles, mettre en place des rôles et sessions sécurisés (responsable distinct du PIN bénévole), le temps réel inter-appareils, les notifications compatibles, une politique de conservation minimale des prénoms et les règles de fermeture. Tester plusieurs appareils simultanément avant publication du QR code.

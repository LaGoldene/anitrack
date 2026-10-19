# AniTrack — prototype v1

## Tester en local
Ouvre `index.html` dans un navigateur moderne. La recherche du catalogue nécessite Internet. Si les requêtes sont bloquées depuis un fichier local, lance un serveur depuis ce dossier :
```bash
python -m http.server 8000
```
Puis visite http://localhost:8000.

## Publier sur GitHub Pages
Un workflow est inclus dans `.github/workflows/deploy.yml`.
1. Ouvre **Settings → Pages** dans le dépôt GitHub.
2. Dans **Build and deployment**, choisis **GitHub Actions** comme source.
3. Va dans l’onglet **Actions** et vérifie l’exécution de **Deploy AniTrack to GitHub Pages** après un push sur `main`.
4. Lorsque le déploiement est terminé, GitHub affiche l’URL du site dans **Settings → Pages** et dans l’exécution du workflow.

## Fonctionnalités incluses
- Bibliothèque personnelle avec ajout, modification et suivi de progression.
- Statuts : à commencer, en cours, en pause, terminé, abandonné.
- Filtres par statut et format.
- Recherche anime/manga via l’API publique Jikan, qui expose des données MyAnimeList.
- Préférences d’interface : couleurs, mode sombre/clair, cartes compactes, grille/liste.
- Statistiques de base et mise en page adaptée au mobile.
- Sauvegarde locale pour le mode invité, et synchronisation cloud pour les comptes connectés.
- Comptes Supabase : inscription par e-mail, connexion, déconnexion et récupération/changement du mot de passe.
- Bibliothèque synchronisée entre appareils, avec politiques RLS pour isoler les données de chaque utilisateur.

## Configuration Supabase requise
Le frontend utilise l’URL du projet et une clé **publishable** (prévue pour être exposée dans le navigateur). Ne jamais ajouter une clé `service_role` ou une clé secrète au site public.

Dans le tableau de bord Supabase, ouvre **Authentication → URL Configuration** et configure :
- **Site URL** : `https://lagoldene.github.io/anitrack/`
- **Redirect URLs** : `https://lagoldene.github.io/anitrack/**`

Les e-mails de confirmation et de récupération du mot de passe dépendent de cette configuration. Pour une vraie mise en production, configure également un service SMTP fiable et vérifie les quotas de l’offre Supabase.

## Limites actuelles
L’espace amis et les fonctions sociales ne sont pas encore implémentés. Jikan ne garantit pas une couverture complète des manhwa/webtoons.

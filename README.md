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
- Sauvegarde locale via le navigateur.

## Limites importantes
Cette version est un prototype : les données restent sur l’appareil et dans le navigateur utilisés. Il n’y a pas encore de comptes, de synchronisation cloud, ni d’espace amis fonctionnel. Jikan ne garantit pas une couverture complète des manhwa/webtoons. Ne mets pas d’informations sensibles dans cette version.

## Étape suivante
Ajouter l’authentification et une base de données distante, puis connecter l’espace partagé. Supabase peut proposer une offre gratuite, mais ses quotas et conditions doivent être vérifiés au moment du déploiement. Les clés secrètes ne doivent jamais être placées dans le code public du navigateur.

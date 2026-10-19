# AniTrack — prototype v1

## Tester
Ouvre `index.html` dans un navigateur moderne. La recherche du catalogue nécessite Internet. Si les requêtes sont bloquées depuis un fichier local, lance un serveur depuis le dossier :
```bash
python -m http.server 8000
```
Puis visite http://localhost:8000.

## Déjà inclus
- Bibliothèque personnelle avec ajout, modification et suivi de progression.
- Statuts : à commencer, en cours, en pause, terminé, abandonné.
- Filtres par statut et format.
- Recherche anime/manga via l’API publique Jikan, qui expose des données MyAnimeList.
- Préférences d’interface : couleurs, mode sombre/clair, cartes compactes, grille/liste.
- Statistiques de base et mise en page adaptée au mobile.
- Sauvegarde locale via le navigateur.

## Important
Cette version est un prototype : les données restent sur l’appareil et dans le navigateur utilisés. Il n’y a pas encore de comptes, de synchronisation cloud, ni d’espace amis fonctionnel. Jikan ne garantit pas une couverture complète des manhwa/webtoons. Ne mets pas d’informations sensibles dans cette version.

## Étape suivante
Ajouter l’authentification et une base de données distante, puis publier le site. Supabase et Cloudflare Pages peuvent proposer des offres gratuites, mais leurs quotas et conditions doivent être vérifiés au moment du déploiement.

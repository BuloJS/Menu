# Menu

Carte du monde des restaurants, bars et boîtes où je suis allé.

- **Recherche** : on tape un nom, [Photon](https://photon.komoot.io) (basé sur
  OpenStreetMap) propose des lieux. La catégorie vient du tag OSM `amenity`
  (`restaurant`, `cafe`… → restaurant ; `bar`, `pub` → bar ; `nightclub` → boîte)
  et se corrige à la main dans la fiche.
- **Carte** : [Leaflet](https://leafletjs.com) avec les tuiles OpenStreetMap.
- **Fiche** : catégorie, date de visite, note sur 5, commentaire.
- **Accès** : protégé par la session ouverte sur Home (`assets/guard.js`).
- **Données** : table `user_data` de Home, ligne `app = "menu"`, isolée par
  utilisateur par la RLS. Aucune nouvelle table. Une copie locale sert de secours.

`assets/auth.js`, `guard.js` et `config.js` sont copiés tels quels de Home.

## Mise en ligne

GitHub → Settings → Pages → Deploy from a branch → branche par défaut, dossier `/ (root)`.
Le site sera servi sur https://bulojs.github.io/Menu/, même origine que Home,
donc la même session.

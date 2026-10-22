# Menu

Carte du monde des restaurants, bars et boîtes où je suis allé.

- **Recherche** : on tape un nom, [Photon](https://photon.komoot.io) (basé sur
  OpenStreetMap) propose des lieux. La catégorie vient du tag OSM `amenity`
  (`restaurant`, `cafe`… → restaurant ; `bar`, `pub` → bar ; `nightclub` → boîte)
  et se corrige à la main dans la fiche.
- **Carte** : [MapLibre GL](https://maplibre.org) en globe 3D (bouton pour passer à la carte plate), fond vectoriel sombre CARTO, données OpenStreetMap.
- **Pays visités** : teinte sur les pays où il y a au moins un lieu (bouton « Pays »). Le pays est retrouvé à partir des coordonnées, avec les frontières Natural Earth (world-atlas).
- **Nations du Royaume-Uni** : Angleterre, Écosse, Pays de Galles et Irlande du Nord sont des pays séparés (`assets/uk-nations.json`, Natural Earth subunits 50 m, domaine public).
- **Territoires éloignés** : un pays est coloré sans ses DOM-TOM, Canaries, Açores, Hawaï, Alaska… (groupes de terres à plus de 100 km). Ils ne se colorent que si un lieu y est enregistré.
- **Départements** : les 96 départements de la France métropolitaine (`assets/departements.json`, gregoiredavid/france-geojson, version simplifiée). Un département se colore tout seul quand un lieu y est enregistré, ou se coche à la main (liste, ou clic sur la carte avec « Cocher sur la carte »). Les cases à cocher sont enregistrées dans `user_data` (champ `depts`).
- **Fiche** : catégorie, date de visite, note sur 5, commentaire.
- **Accès** : protégé par la session ouverte sur Home (`assets/guard.js`).
- **Données** : table `user_data` de Home, ligne `app = "menu"`, isolée par
  utilisateur par la RLS. Aucune nouvelle table. Une copie locale sert de secours.

`assets/auth.js`, `guard.js` et `config.js` sont copiés tels quels de Home.

## Mise en ligne

GitHub → Settings → Pages → Deploy from a branch → branche par défaut, dossier `/ (root)`.
Le site sera servi sur https://bulojs.github.io/Menu/, même origine que Home,
donc la même session.

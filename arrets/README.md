# Module Arrêts et itinéraires

Le module Arrêts et itinéraires donne les lignes qui desservent un arrêt de Suisse et le trajet entre deux lieux, correspondances comprises. Cette fiche s'adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `arrets`).

## Ce que fait le module

- Il répond à « quels bus passent à Bel-Air ? » et affiche une carte « Arrêts » : le nombre de lignes, puis une entrée par ligne et par direction avec son prochain départ, son retard éventuel et son quai.
- Il répond à « comment je vais à Ouchy ? » et affiche une carte « Itinéraire » : la durée en grand, puis chaque tronçon avec sa ligne, ses deux arrêts et ses heures. Les changements sont nommés à l'oral, avec le temps d'attente à chacun. Les tronçons à pied figurent sur la carte tant que la place le permet.
- La ville est facultative : vide, la recherche porte sur toute la Suisse. C'est ce qui permet une source « Lausanne » et une source « Suisse » sur le même module.
- Quand il n'y a aucun départ, la carte le dit au lieu d'inventer une valeur.
- Les données restent en cache 45 secondes, le temps que les questions rapprochées ne redemandent pas le flux.

## Réglages d'une source

Dans **Modules → Arrêts et itinéraires → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Ville | Préfixe la recherche et écarte les homonymes ; vide, la recherche porte sur toute la Suisse | `Lausanne` |
| Arrêt habituel | L'arrêt lu par « mon bus » et le départ de « ici > Ouchy » | `Lausanne, Chailly-Village` |
| Lignes affichées | Nombre de lignes et directions sur la carte | `6` |

## Limites

- L'API ne sait pas énumérer les arrêts d'une ville : on peut demander n'importe quel arrêt par son nom, pas obtenir la liste complète. Cela demanderait le GTFS du réseau.
- Sans ville, un nom ambigu peut désigner un autre lieu : « Chailly » seul a donné Chailly-Montreux. La carte affiche toujours l'arrêt réellement lu.
- L'itinéraire part de maintenant : ni date ni heure ne sont transmises à l'API.
- En cas de panne du fournisseur, le module dit laquelle : quota, service indisponible, réponse illisible.

## Outil vocal et affichage permanent

L'outil s'appelle `arrets__read` pour l'arrêt habituel, `arrets__ask` pour un arrêt nommé, et `arrets__trajet` pour un itinéraire. Ce dernier attend deux bouts séparés par `>` : « Chailly > Ouchy », ou « ici > Ouchy » pour partir de l'arrêt habituel.

Ce module ne propose pas d'affichage permanent.

## Auteur

[Malvu](https://github.com/Malvu)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

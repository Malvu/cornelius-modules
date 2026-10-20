# Module Prix des carburants

Le module Prix des carburants donne les prix affichés dans une station-service, d’après le flux officiel du ministère de l’Économie. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `carburants`).

## Ce que fait le module

- Il répond à « combien coûte le gazole ? » ou « le prix de l’essence à la station » : « À Pacé, boulevard Giraudais : gazole à 2 euros 34, sans-plomb E10 à 2 euros 14, E85 à 92 centimes. »
- La carte « Carburants · Pacé » donne le carburant principal en grand, puis chaque prix avec sa date de relevé (« aujourd’hui », « hier », « le 20 octobre »).
- Un prix plus ancien que la veille est signalé sous la carte : la station ne l’a pas mis à jour.
- « Et le SP98 ? » : il annonce ce carburant d’abord, sans changer la source, ou répond « Pas de sans-plomb 98 à cette station. ».
- Une station qui ne publie aucun prix s’affiche « Aucun prix ».
- À l’écran, les prix ont trois décimales, comme à la pompe ; à l’oral, ils sont arrondis au centime.

## Source

Le [flux instantané des prix des carburants](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) (data.economie.gouv.fr, licence Ouverte), sans jeton. Les stations y publient elles-mêmes leurs prix.

## Réglages d’une source

Dans **Modules → Prix des carburants → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Station | Recherche par **code postal** (exact) ou par **commune** (approchée : « Pacé » propose aussi « Pacy-sur-Eure ») | une station de Pacé, à remplacer |
| Carburant principal | Dans une liste : Gazole, SP95-E10, SP95, SP98, E85 ou GPL, annoncé en premier. « Tous » : tous, dans l’ordre habituel | Gazole |

La recherche montre l’adresse, le code postal et les premiers prix de chaque station. Le flux ne donne pas l’enseigne (Leclerc, Total…) : c’est l’adresse qui distingue les stations. Une source par station : « Station du travail », « Station de la maison »…

## Limites

- Seuls les prix publiés par la station sont connus ; un carburant en rupture n’apparaît pas.
- Les heures du flux sont mal étiquetées (notées en UTC, alors qu’elles sont à l’heure de Paris) : le module n’en garde que la date.
- Si le service ne répond pas, Cornelius annonce les derniers prix connus, à vérifier.

## Outil vocal et affichage permanent

L’outil s’appelle `carburants__read`. Il accepte un carburant (`carburant` : `gazole`, `e10`, `sp95`, `sp98`, `e85` ou `gplc`), annoncé en premier pour cette réponse seulement. Avec « Afficher en permanence sur le miroir », le miroir montre le carburant principal et son prix en grand, la commune, puis deux autres prix.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

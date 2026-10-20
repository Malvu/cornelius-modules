# Module Éphéméride

Le module Éphéméride raconte ce qui s’est passé un jour comme aujourd’hui, d’après la sélection de Wikipédia en français. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `ephemeride`).

## Ce que fait le module

- Il répond à « qu’est-ce qui s’est passé un 20 octobre ? » ou « l’éphéméride du jour » : « Un jour comme aujourd’hui, il y a 15 ans, en 2011 : l’ETA annonce la « fin définitive de son action armée ». »
- Il dit d’abord l’anniversaire le plus rond (100 ans, puis 50, 25, 10, 5), puis le plus récent.
- La carte « Éphéméride · 20 octobre » donne cet événement, puis les suivants, avec leur année.
- Le jour est celui du foyer (`CORNELIUS_TIMEZONE`, Europe/Paris par défaut). La sélection est relue à minuit ; si Wikipédia ne répond pas, celle de la veille est annoncée à sa date (« Un 20 octobre… »), jamais comme celle du jour.

## Source

La sélection « Éphéméride » de [Wikipédia en français](https://fr.wikipedia.org/), par son API publique (`api/rest_v1/feed/onthisday/selected`), sans jeton. Les textes sont sous licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr) : la carte cite Wikipédia comme source.

## Réglages d’une source

Dans **Modules → Éphéméride Wikipédia → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Événements sur la carte | De 1 à 5 : le premier est dit à voix haute, les autres s’affichent dessous | 3 |

## Limites

- La sélection est celle des contributeurs de Wikipédia : elle compte beaucoup de batailles et d’élections, et peu d’événements légers. Le module ne la filtre pas.
- Certains jours n’ont pas de sélection : la source répond alors qu’elle n’a rien pour le moment.

## Outil vocal et affichage permanent

L’outil s’appelle `ephemeride__read`. Avec « Afficher en permanence sur le miroir », le miroir montre trois événements du jour, chacun avec son année.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

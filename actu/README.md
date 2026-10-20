# Module Titres de l’actualité

Le module Titres de l’actualité lit les premiers titres d’un journal, d’après son flux RSS ou Atom. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `actu`).

## Ce que fait le module

- Il répond à « quelles sont les nouvelles ? » ou « les titres du jour » : « Les titres de franceinfo : … » suivi des titres, dans l’ordre du journal.
- La carte « Actu · franceinfo » donne le premier titre, son résumé et son ancienneté, puis les suivants.
- Seuls les titres sont lus. Pour en savoir plus sur un sujet, Cornelius passe par sa recherche web.
- Le flux est relu au plus tous les quarts d’heure.

## Réglages d’une source

Dans **Modules → Titres de l’actualité → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse du flux RSS | L’adresse du flux, `http` ou `https` | `https://www.franceinfo.fr/titres.rss` |
| Titres annoncés | De 1 à 5, dans l’ordre du journal | 3 |

Quelques flux essayés :

| Journal | Adresse |
| --- | --- |
| franceinfo, les titres | `https://www.franceinfo.fr/titres.rss` |
| Le Monde, à la une | `https://www.lemonde.fr/rss/une.xml` |
| Ouest-France, à la une | `https://www.ouest-france.fr/rss/une` |
| 20 Minutes, à la une | `https://www.20minutes.fr/feeds/rss-une.xml` |

Une source par journal ou par rubrique : « Les titres », « Le sport », « L’actu locale »…

## Limites

- Une ancienne adresse qui renvoie vers la nouvelle (`francetvinfo.fr` vers `franceinfo.fr`) est suivie, trois fois au plus, et jamais vers une adresse non chiffrée (`http://`). Au-delà, Cornelius demande l’adresse finale : l’ouvrir dans un navigateur montre où elle mène.
- Un flux de plus de 512 Ko est coupé : seuls ses premiers titres sont lus, ce qui suffit.
- Si le journal ne répond pas, Cornelius annonce les derniers titres connus comme tels.

## Outil vocal et affichage permanent

L’outil s’appelle `actu__read`. Avec « Afficher en permanence sur le miroir », le miroir montre les trois premiers titres, sous le nom du journal.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json), lecture du flux : [_lib/flux.ts](../_lib/flux.ts)

# Module Poubelles

Le module Poubelles dit quel bac sortir, et quand, d’après le calendrier de ramassage de la commune, écrit en toutes lettres. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `poubelles`).

## Ce que fait le module

- Il répond à « quelle poubelle je sors ce soir ? », « c’est quand le verre ? » ou « on sort les poubelles demain ? ».
- La veille au soir, à partir de 17 h, il annonce « Ce soir, on sort les emballages : ramassage demain matin. »
- Le jour du ramassage, il dit « Aujourd’hui » jusqu’à midi, puis passe au ramassage suivant. Sur le miroir, l’affichage change de lui-même à 17 h, à midi et à minuit.
- La carte « Poubelles » donne le prochain ramassage, puis la prochaine date de chaque bac.
- Il fonctionne sans réseau : rien ne quitte l’ordinateur.

## Réglages d’une source

Dans **Modules → Poubelles → Ajouter une source**, une liste de bacs : une ligne par bac, avec ses jours recopiés du calendrier de la commune. **Ajouter** ajoute une ligne, la corbeille la retire.

| Réglage | Exemple | Par défaut |
| --- | --- | --- |
| Bacs ramassés | Verre : `1er vendredi du mois` | Ordures ménagères : `lundi et jeudi` ; Emballages et papiers : `mercredi semaines paires` |
| Sortir la veille au soir | le rappel dès 17 h la veille | activé |

Les bacs se choisissent dans une liste : ordures ménagères, emballages et papiers, verre, biodéchets, déchets verts, encombrants. Huit lignes au plus. Une source réglée avant la version 1.1.0, avec un champ par bac, est reprise telle quelle : chaque champ rempli devient une ligne.

Ce que le module comprend :

| On écrit | Ramassage |
| --- | --- |
| `lundi et jeudi`, `lundis, jeudis` | chaque lundi et chaque jeudi |
| `tous les samedis matin` | chaque samedi |
| `mercredi semaines paires` | le mercredi des semaines paires (numéro de semaine ISO, celui des calendriers) |
| `mardi semaines impaires` | le mardi des semaines impaires |
| `1er et 3e mercredi du mois` | le premier et le troisième mercredi de chaque mois |
| `dernier vendredi du mois` | le dernier vendredi de chaque mois |

Un mot inconnu n’est jamais deviné : **Tester** affiche par exemple « Verre : « mardo » n’est pas compris. »

## Limites

- Les décalages des jours fériés ne sont pas connus : si la commune décale un ramassage, le module ne le sait pas.
- Les calendriers « toutes les deux semaines à partir du … » s’écrivent avec « semaines paires » ou « impaires » : vérifier la parité d’une date connue sur le calendrier de la commune.
- Les heures sont celles du foyer (`CORNELIUS_TIMEZONE`, Europe/Paris par défaut).

## Outil vocal et affichage permanent

L’outil s’appelle `poubelles__read`. Avec « Afficher en permanence sur le miroir », le miroir montre « Ce soir », « Demain » ou le jour du prochain ramassage, les bacs concernés, puis les deux suivants. Il passe à « Ce soir » à 17 h, et au ramassage suivant à midi et à minuit. La date du relevé n’y figure pas : rien n’est relevé, tout est calculé.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

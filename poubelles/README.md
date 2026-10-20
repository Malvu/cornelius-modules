# Module Poubelles

Le module Poubelles dit quel bac sortir, et quand, d’après le calendrier de ramassage de la commune, écrit en toutes lettres. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `poubelles`).

## Ce que fait le module

- Il répond à « quelle poubelle je sors ce soir ? », « c’est quand le verre ? » ou « on sort les poubelles demain ? ».
- La veille au soir, à partir de 17 h, il annonce « Ce soir, on sort les emballages : ramassage demain matin. »
- Le jour du ramassage, il dit « Aujourd’hui » jusqu’à midi, puis passe au ramassage suivant.
- La carte « Poubelles » donne le prochain ramassage, puis la prochaine date de chaque bac.
- Il fonctionne sans réseau : rien ne quitte l’ordinateur.

## Réglages d’une source

Dans **Modules → Ramassage des poubelles → Ajouter une source**, un champ par bac. On y recopie le calendrier de la commune ; un champ vide veut dire « pas de ramassage ».

| Réglage | Exemple | Par défaut |
| --- | --- | --- |
| Ordures ménagères | `lundi et jeudi` | `lundi et jeudi` |
| Emballages et papiers | `mercredi semaines paires` | `mercredi semaines paires` |
| Verre | `1er vendredi du mois` | vide |
| Biodéchets | `mardi` | vide |
| Déchets verts | `dernier lundi du mois` | vide |
| Sortir la veille au soir | le rappel dès 17 h la veille | activé |

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
- Les heures sont celles de Paris.

## Outil vocal et affichage permanent

L’outil s’appelle `poubelles__read`. Avec « Afficher en permanence sur le miroir », le miroir montre « Ce soir », « Demain » ou le jour du prochain ramassage, les bacs concernés, puis les deux suivants. La date du relevé n’y figure pas : rien n’est relevé, tout est calculé.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

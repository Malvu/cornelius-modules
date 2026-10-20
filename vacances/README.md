# Module Vacances et jours fériés

Le module Vacances et jours fériés dit si les enfants sont en vacances, quand commencent les prochaines et quel est le prochain jour férié. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `vacances`).

## Ce que fait le module

- Il répond à « c’est quand les prochaines vacances ? », « on est en vacances ? », « la rentrée c’est quand ? » ou « le prochain jour férié ? ».
- Il affiche une carte « Vacances scolaires · zone C » :
  - pendant les vacances, « En vacances » et le jour de la rentrée (« Vacances de la Toussaint, rentrée lundi 2 novembre ») ;
  - sinon, le compte à rebours (« Dans 44 jours ») et les dates (« Vacances de Noël, du samedi 19 décembre au dimanche 3 janvier ») ;
  - dessous, les périodes suivantes (« Hiver : 6 févr. → 21 févr. ») et le prochain jour férié (« Toussaint, dimanche 1er novembre (dans 12 jours) »).
- Les dates vont du premier au dernier jour sans classe. Le jour de la rentrée n’est plus un jour de vacances.
- Le calendrier est relu au plus une fois par heure. Le compte à rebours, lui, est recalculé à chaque demande : il change bien à minuit.

## Sources

Aucun jeton n’est nécessaire.

- [Calendrier scolaire](https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/) de l’Éducation nationale (data.education.gouv.fr, licence Ouverte).
- [Jours fériés](https://calendrier.api.gouv.fr/jours-feries/) de calendrier.api.gouv.fr (Etalab, licence Ouverte).

## Réglages d’une source

Dans **Modules → Vacances scolaires et jours fériés → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Zone scolaire | `A`, `B`, `C` ou `Corse`. Paris, Créteil, Versailles, Montpellier et Toulouse sont en zone C. | `C` |
| Jours fériés | `metropole`, ou `alsace-moselle` pour ajouter le Vendredi saint et le 26 décembre | `metropole` |

Une famille dont les enfants sont dans deux zones crée deux sources, par exemple « Vacances de Léa » et « Vacances de Tom ».

## Limites

- France métropolitaine et Corse seulement : les académies d’outre-mer ont leurs propres périodes, non prises en charge.
- Les ponts (« Pont de l’Ascension ») ne sont pas annoncés : leurs dates ne suivent pas la même convention d’une académie à l’autre dans les données publiées.
- Le module ne connaît que les années déjà publiées par le ministère, en général les deux suivantes. Au-delà, il répond qu’aucune période n’est publiée.
- Si une source ne répond pas, Cornelius annonce « le dernier calendrier connu, à vérifier ».

## Outil vocal et affichage permanent

L’outil s’appelle `vacances__read`. Avec « Afficher en permanence sur le miroir », le miroir montre « En vacances » et le jour de la rentrée, ou le compte à rebours et le nom des prochaines vacances, avec le prochain jour férié dessous. La date du relevé n’y figure pas : un calendrier ne vieillit pas d’une heure à l’autre.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](../docs/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

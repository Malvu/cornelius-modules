# Module Trajets en voiture (trafic)

Le module Trajets en voiture donne la durée et la distance d'un trajet routier, trafic du moment compris. Cette fiche s'adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `voiture_google`).

## Ce que fait le module

- Il répond à « combien de temps en voiture pour Genève ? » et affiche une carte « En voiture » : la durée en grand, la distance, et les minutes ajoutées par le trafic quand Google les donne.
- Il répond à « domicile > bureau » et accepte les deux bouts dans la question. Le mot « domicile » renvoie au réglage d'origine, le mot « bureau » au réglage de destination.
- La durée affichée est celle du trafic réel, pas une durée théorique : si Google annonce 48 minutes dont 8 de bouchons, la carte montre 48.
- Quand Google ne trouve pas de trajet, le module le dit avec le motif au lieu d'inventer.

## Réglages d'une source

Dans **Modules → Trajets en voiture → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Point de départ (facultatif) | L'adresse d'où partent les trajets quand la question ne le dit pas ; le mot « domicile » y renvoie. Vide, la question doit nommer les deux bouts | vide |
| Destination par défaut (facultatif) | L'adresse que désigne le mot « bureau » | vide |

N'importe quel trajet de Suisse est accepté : « Chailly, Lausanne > Genève », « de Genève à Zurich », « Lausanne vers Sion ». Le réglage de départ n'est qu'un raccourci.

## La clé Google

Le module utilise **Routes API** de Google Maps Platform, la remplaçante de Directions API, seule proposée aux nouveaux projets. Il faut :

1. un projet Google Cloud avec la **facturation activée** ;
2. l'API **Routes** activée dans ce projet ;
3. une clé d'API restreinte à cette seule API.

La clé se déclare dans le fichier `.env` de Cornelius :

```
CORNELIUS_GOOGLE_MAPS_KEY=la-cle
```

Sans elle, le module refuse de calculer et le dit. Google offre un volume mensuel gratuit ; au-delà, chaque trajet est facturé quelques millièmes de franc.

## Limites

- **Pas d'heure d'arrivée.** Le module répond « maintenant » : l'API sait aussi calculer pour une heure future, mais la prévision de trafic n'est alors plus fournie, et le module ne l'expose pas encore.
- **Les adresses partent chez Google.** C'est le seul module du dépôt qui envoie vos trajets à un tiers. La clé peut être restreinte, mais pas l'usage.
- Le trafic n'est pas garanti : Google l'estime à partir de ses propres données, et une fermeture de route récente peut ne pas y figurer.
- En cas de refus de Google (quota, clé invalide, trajet introuvable), le module dit lequel.

## Outil vocal

L'outil s'appelle `voiture__trajet` et attend une destination seule (« Genève ») ou les deux bouts séparés par `>` (« domicile > Genève »).

Ce module ne propose pas d'affichage permanent.

## Auteur

[Malvu](https://github.com/Malvu)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

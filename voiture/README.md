# Module Trajets en voiture (gratuit)

Le module Trajets en voiture donne la durée et la distance d'un trajet routier, **sans clé, sans compte et sans rien payer**. Cette fiche s'adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `voiture`).

## Ce que fait le module

- Il répond à « combien de temps en voiture pour Genève ? » et affiche une carte « En voiture » : la durée en grand et la distance.
- Il accepte n'importe quel trajet : « de Genève à Zurich », « Chailly, Lausanne > Sion », « Lausanne vers Sion ». Le mot « domicile » renvoie au départ réglé, « bureau » à la destination réglée.
- L'adresse est retrouvée par **swisstopo**, la donnée officielle des adresses suisses, et la route est calculée par **OSRM**, le calculateur d'itinéraires d'OpenStreetMap. Aucun des deux ne demande de clé.
- Il ne connaît que les adresses suisses : c'est ce qui lui évite de confondre un quartier de Lausanne avec un hameau homonyme.
- Quand un lieu est introuvable, le module le dit au lieu d'inventer une durée.

## Ce qu'il ne fait pas

- **Pas de trafic.** La durée est celle d'une route libre. Pour le trafic en temps réel, voir le module **Trajets en voiture (trafic)**, qui demande une clé Google.
- **Pas d'heure d'arrivée.** Le module répond « maintenant ».

## Réglages d'une source

Dans **Modules → Trajets en voiture (gratuit) → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Point de départ (facultatif) | L'adresse d'où partent les trajets quand la question ne le dit pas ; le mot « domicile » y renvoie | vide |
| Destination par défaut (facultatif) | L'adresse que désigne le mot « bureau » | vide |

Les deux sont facultatifs : sans eux, il suffit de nommer les deux bouts dans la question.

## Limites

- **Un serveur de démonstration pour les routes.** La recherche d'adresses s'appuie sur swisstopo, un service public de la Confédération, mais le calcul d'itinéraire passe par `router.project-osrm.org`, le serveur d'essai d'OpenStreetMap. Il peut être lent, limité en débit, voire arrêté sans préavis. Pour un usage sérieux, installez OSRM chez vous et remplacez l'adresse dans le code : c'est une constante, `routeUrl`.
- **Adresses suisses uniquement.** Une adresse étrangère n'est pas trouvée, et le module le dit au lieu de chercher ailleurs.
- **Durées hors trafic.** OSRM estime une route libre : à 8 h du matin, la réalité sera plus longue.

## Outil vocal

L'outil s'appelle `voiture__trajet` et attend une destination seule (« Genève ») ou les deux bouts (« de Genève à Zurich »).

Ce module ne propose pas d'affichage permanent.

## Auteur

[Malvu](https://github.com/Malvu)

## Voir aussi

- [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md)
- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)

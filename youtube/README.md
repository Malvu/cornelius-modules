# Module YouTube

Le module YouTube annonce la dernière vidéo d’une chaîne, par défaut celle des [Frères Poulain](https://www.youtube.com/@LesFreresPoulain). Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `youtube`).

## Ce que fait le module

- Il répond à « il y a une nouvelle vidéo ? » ou « c’est quoi leur dernière vidéo ? » : « Dernière vidéo de la chaîne Les Freres Poulain, publiée il y a 3 semaines : « Cette fois, impossible de perdre la clé de 13 ! ». »
- La carte « YouTube · Les Freres Poulain » donne le titre, la date, le nombre de vues, puis les trois vidéos précédentes.
- Les mots-clés de fin de titre (« #diy #impression3d ») sont retirés ; à l’oral, les émojis et les mentions « @chaîne » aussi.
- La liste est relue au plus toutes les 30 minutes.

## Source

Le flux public de la chaîne (`youtube.com/feeds/videos.xml`), sans jeton ni compte. Il contient les 15 dernières publications, Shorts compris.

## Réglages d’une source

Dans **Modules → YouTube → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Identifiant de la chaîne | Commence par `UC`, 24 caractères. Sur la page de la chaîne : **Plus**, puis **Partager la chaîne**, puis **Copier l’ID de la chaîne**. | `UCjED9uS41ioeFuPfbR-OBlw` (Les Frères Poulain) |
| Compter les Shorts | Désactivé, seules les vidéos longues sont annoncées | désactivé |

Une source par chaîne : « Les Frères Poulain », « La chaîne de Léa »… Le nom `@pseudo` d’une chaîne ne suffit pas : il faut son identifiant.

## Limites

- Les vidéos programmées, en direct ou réservées aux membres n’apparaissent pas toujours dans le flux public.
- Le nom de la chaîne est celui du flux, parfois sans accents (« Les Freres Poulain »).
- Si YouTube ne répond pas, Cornelius annonce « la dernière liste connue, à vérifier ».

## Outil vocal et affichage permanent

L’outil s’appelle `youtube__read`. Avec « Afficher en permanence sur le miroir », le miroir montre le titre de la dernière vidéo, le nom de la chaîne et son ancienneté.

## Voir aussi

- [Créer un module](../docs/creer-un-module.md)
- [Référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json), lecture du flux : [_lib/flux.ts](../_lib/flux.ts)

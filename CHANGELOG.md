# Historique des changements

Cette page retrace les modules ajoutés et modifiés, du plus récent au plus ancien. Chaque module suit sa propre `version`, indiquée entre parenthèses.

## Non publié

### 2026-10-20

**Ajouté**

- Module **Titres de l’actualité** (`actu`, 1.0.0) : les premiers titres d’un flux RSS ou Atom choisi, dans l’ordre du journal, sans jeton.
- Module **Éphéméride** (`ephemeride`, 1.0.0) : ce qui s’est passé un jour comme aujourd’hui, d’après la sélection de Wikipédia en français, l’anniversaire le plus rond d’abord.
- Module **YouTube** (`youtube`, 1.0.0) : la dernière vidéo d’une chaîne par son flux public, Shorts compris ou non, sans jeton.
- `_lib/flux.ts` : lecture des flux RSS et Atom, partagée par les modules du dépôt.
- Module **Poubelles** (`poubelles`, 1.0.0) : quel bac sortir et quand, d’après le calendrier de ramassage écrit en toutes lettres (« mercredi semaines paires », « dernier vendredi du mois »), rappel la veille au soir, sans réseau.
- Module **Vacances et jours fériés** (`vacances`, 1.0.0) : vacances scolaires des zones A, B, C et de la Corse, prochain jour férié de métropole ou d’Alsace-Moselle, sans jeton.
- Le dépôt : gabarit `_template`, tutoriel [Créer un module](docs/creer-un-module.md), commandes `test`, `check` et `format` qui utilisent les outils du Cornelius voisin.

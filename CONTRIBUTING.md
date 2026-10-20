# Contribuer à cornelius-modules

Merci de vouloir enrichir Cornelius. Cette page explique comment proposer un module, ou en améliorer un, et ce qu’il faut vérifier avant de l’envoyer. Le pas à pas d’écriture est dans [Créer un module](docs/creer-un-module.md).

## Proposer un module

1. Ouvrez d’abord un ticket qui décrit le besoin, la source des données (adresse de l’API, licence, jeton éventuel) et ce que Cornelius dirait.
2. Créez une branche à partir de `main`, avec un module par branche.
3. Copiez le gabarit (`cp -r _template <id>`), puis suivez le tutoriel.
4. Ouvrez une demande de fusion qui explique ce que fait le module et comment vous l’avez vérifié : tests automatiques, et essai réel dans l’administration et à la voix.

Ne joignez jamais un jeton, une clé, un fichier `.env` ou une réponse de fournisseur qui contient des données personnelles.

## Avant d’envoyer

Avec Cornelius cloné à côté de ce dépôt (et `npm ci` lancé dedans) :

```sh
npm run format:check
npm run check
npm test
```

`npm run format` corrige la mise en forme. Les mêmes vérifications tournent à chaque envoi (`.github/workflows/check.yml`), contre la branche `main` de Cornelius.

Cornelius étant privé, la vérification automatique a besoin du secret `CORNELIUS_READ_TOKEN` : un jeton GitHub à granularité fine, en lecture seule sur le contenu de `lfpoulain/Cornelius`, ajouté dans **Settings → Secrets and variables → Actions**. Sans lui, elle s’arrête sur un avertissement.

## Ce qu’un module doit avoir

- Un dossier `<id>/` à la racine, identique au champ `id`, sans tiret, différent des modules livrés avec Cornelius (`clock`, `weather`, `transit`, `ragator`).
- Le contrat importé par `#cornelius/addons`, `#cornelius/validation` et, dans les tests, `#cornelius/testing`. Aucun chemin vers `../cornelius/`.
- Des tests sur des réponses enregistrées du vrai fournisseur (`fixtures/`), sans réseau.
- Une fiche `<id>/README.md` remplie à partir de [la fiche du gabarit](_template/README.md), avec la licence des données.
- Une ligne dans le tableau des modules du [README](README.md#-les-modules) et dans le [CHANGELOG](CHANGELOG.md).
- `minCoreVersion` si le module s’appuie sur un ajout récent de Cornelius.

## Conventions

- TypeScript strict ; aucun avertissement de `npm run check`.
- Textes en français (cartes, réponses orales, messages d’erreur, fiches), phrases courtes, sans tiret long.
- Une donnée absente n’est jamais inventée : une panne n’est pas « zéro ».
- Les besoins qui dépassent le contrat (nouveau type de carte, outil qui agit) se discutent dans [Cornelius](https://github.com/lfpoulain/Cornelius) : le contrat et sa [référence](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md) y évoluent ensemble.

## Licence des contributions

Ce dépôt est sous [PolyForm Noncommercial License 1.0.0](LICENSE), comme Cornelius. En proposant un changement, vous confirmez en être l’auteur ou avoir le droit de le proposer, et vous acceptez qu’il soit distribué sous cette licence. Vous autorisez aussi les auteurs de Cornelius à le distribuer sous d’autres conditions, notamment dans une licence commerciale accordée par écrit.

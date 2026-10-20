<div align="center">

<img src="docs/assets/banniere.svg" alt="Cornelius · modules : des modules qui se branchent sur le miroir" width="100%" />

<h3>De nouvelles informations pour le miroir, mises à jour sans toucher à Cornelius.</h3>

<p>
  <a href="https://github.com/lfpoulain/Cornelius"><img alt="Pour Cornelius 0.1 ou plus récent" src="https://img.shields.io/badge/Cornelius-%E2%89%A5%200.1-3fb7a3?style=flat-square" /></a>
  <img alt="Contrat des modules v1" src="https://img.shields.io/badge/contrat-apiVersion%201-3fb7a3?style=flat-square" />
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-3fb7a3?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="En français" src="https://img.shields.io/badge/langue-fran%C3%A7ais-3fb7a3?style=flat-square" />
  <a href="LICENSE"><img alt="Licence PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/licence-PolyForm%20NC%201.0.0-b39dff?style=flat-square" /></a>
</p>

<p>
  <a href="#-les-modules">Les modules</a> ·
  <a href="#-installer">Installer</a> ·
  <a href="#-créer-un-module">Créer un module</a> ·
  <a href="#-compatibilité">Compatibilité</a> ·
  <a href="#-documentation">Documentation</a> ·
  <a href="#-licence">Licence</a>
</p>

</div>

---

[Cornelius](https://github.com/lfpoulain/Cornelius) est le miroir intelligent de la famille. Il répond à la voix et affiche des cartes : l’heure, la météo, le prochain bus… Ces informations viennent de **modules**.

Cornelius livre ses modules de base avec lui. Ce dépôt accueille **tous les autres** : chacun est un dossier, Cornelius les charge au démarrage, et un `git pull` suffit à les mettre à jour, sans toucher au miroir.

## 📦 Les modules

| Module | Ce qu’il fait | Jeton | Fiche |
| --- | --- | --- | --- |
| 🗑️ **Poubelles** | Quel bac sortir et quand, d’après le calendrier de la commune écrit en toutes lettres ; rappel la veille au soir | aucun | [poubelles](poubelles/README.md) |
| 🏖️ **Vacances et jours fériés** | En vacances ou pas, prochaines vacances scolaires de la zone, prochain jour férié ; affichage permanent possible | aucun | [vacances](vacances/README.md) |

Livrés avec Cornelius, et donc absents d’ici : Heure, Météo, Transports, Ragator. Voir [Les modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md) dans Cornelius.

## 🚀 Installer

Clonez ce dépôt **à côté** du dossier de Cornelius :

```bash
git clone https://github.com/lfpoulain/cornelius-modules.git
```

```text
📁 GitHub/
├── 📁 cornelius/            le miroir, avec ses modules livrés (addons/)
└── 📁 cornelius-modules/    ce dépôt : un dossier par module
```

Redémarrez Cornelius. Les modules apparaissent dans **Administration → Modules** et se règlent comme les autres : une ou plusieurs sources, un propriétaire, un jeton si le fournisseur en demande un.

> [!TIP]
> Pour ranger ce dépôt ailleurs, indiquez son chemin dans le `.env` de Cornelius : `CORNELIUS_MODULES_DIR=/chemin/vers/cornelius-modules`.

## 🔄 Mettre à jour

```bash
git -C cornelius-modules pull
```

Redémarrez ensuite Cornelius : les modules ne sont lus qu’au démarrage. Les sources déjà réglées sont gardées.

Un module qui demande une version de Cornelius plus récente que celle installée n’est pas chargé. L’administration l’indique en bas de **Modules**, sous « Module non chargé », avec la version attendue : il suffit alors de mettre Cornelius à jour.

## 🧩 Créer un module

```sh
cp -r _template parking
```

Le gabarit `_template` est un module complet relié à un fournisseur fictif, avec ses schémas, une réponse d’exemple et ses tests. Remplacez le fournisseur, adaptez les schémas et les tests, puis vérifiez :

| Commande | Effet |
| --- | --- |
| `npm test` | Lance les tests de tous les modules avec le vrai cœur de Cornelius (base en mémoire, réseau simulé) |
| `npm run check` | Vérifie les types contre le contrat de Cornelius |
| `npm run format` | Met le code en forme, avec les règles de Cornelius |

Rien à installer ici : ces commandes utilisent les outils du Cornelius voisin, où `npm ci` doit avoir été lancé. S’il est rangé ailleurs, indiquez son dossier dans `CORNELIUS_DIR`.

Le pas à pas complet est dans [Créer un module](docs/creer-un-module.md), et la façon de proposer un module dans [Contribuer](CONTRIBUTING.md).

## 🔗 Compatibilité

Un module dépend de Cornelius par trois alias, toujours résolus vers le Cornelius qui le charge :

| Alias | Contenu |
| --- | --- |
| `#cornelius/addons` | Le contrat : types, `AddonCollectError` |
| `#cornelius/validation` | La compilation des schémas JSON |
| `#cornelius/testing` | Pour les tests : `validateAddonDefinition`, `openDatabase`, `AddonRepository`, `AddonRuntime` |

- `apiVersion: 1` est le contrat. Il ne change qu’en cas de rupture : un module d’une autre version est refusé.
- `minCoreVersion`, facultatif, est la version minimale de Cornelius (`'0.2.0'`) pour un module qui s’appuie sur un ajout récent du cœur.
- Un module externe ne remplace jamais un module livré : s’il en reprend l’identifiant, il est refusé.

Les règles complètes vivent dans Cornelius, à côté du code qu’elles décrivent : [référence du contrat des modules](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md).

## 🔒 Sécurité

- 🧑‍💻 Un module s’exécute dans le serveur de Cornelius, avec les mêmes droits que lui : n’installez que des modules dont vous avez lu le code ou connaissez l’auteur.
- 🌐 Le cœur leur impose son client HTTP (sans redirection, réponses bornées) et valide tout ce qu’ils renvoient.
- 🔑 Leurs jetons restent dans le `.env` ou l’administration de Cornelius, jamais dans ce dépôt.

## 📚 Documentation

| | |
|---|---|
| **Écrire** | [Créer un module](docs/creer-un-module.md) · [Fiche à remplir](_template/README.md) · [Contribuer](CONTRIBUTING.md) |
| **Le contrat** | [Référence](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/reference.md) · [Types](https://github.com/lfpoulain/Cornelius/blob/main/shared/addons.ts) |
| **Utiliser** | [Les modules dans Cornelius](https://github.com/lfpoulain/Cornelius/blob/main/docs/modules/README.md) : sources, jetons, affichage permanent |
| **Suivre** | [Historique des changements](CHANGELOG.md) |

## 📜 Licence

Ce dépôt est distribué, comme Cornelius, sous la [PolyForm Noncommercial License 1.0.0](LICENSE) : utilisation, partage et modification libres pour un usage non commercial, en gardant la ligne `Required Notice` du fichier `LICENSE`. Les données des fournisseurs gardent leur propre licence, indiquée dans la fiche de chaque module.

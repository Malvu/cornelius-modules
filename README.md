# Cornelius · modules

Les modules externes de [Cornelius](https://git.diy.yt/lfpoulain/cornelius), le miroir qui parle. Ils ajoutent des informations à demander à la voix ou à garder affichées sur le miroir. On les met à jour avec un `git pull`, **sans mettre à jour Cornelius**.

Cornelius livre ses modules de base (heure, météo, transports, Ragator) dans son propre dossier `addons/`. Ce dépôt accueille tous les autres : ceux qui évoluent à leur rythme, ceux qui ne servent qu’à certains foyers, ceux d’autres auteurs.

```text
GitHub/
├── cornelius/            le miroir : cœur et modules livrés (addons/)
└── cornelius-modules/    ce dépôt : un dossier par module
    ├── _template/        le gabarit, jamais chargé
    ├── parking/          un module (exemple)
    └── docs/             tutoriel et référence du contrat
```

## Installer

Clonez ce dépôt **à côté** du dossier de Cornelius, puis redémarrez Cornelius :

```bash
git clone https://git.diy.yt/lfpoulain/cornelius-modules.git
```

Au démarrage, Cornelius cherche `cornelius-modules` dans le même dossier que lui. Les modules apparaissent dans **Administration → Modules**, et se règlent comme les autres : une ou plusieurs sources, un propriétaire, un jeton si le fournisseur en demande un.

Pour ranger ce dépôt ailleurs, indiquez son chemin dans le `.env` de Cornelius :

```ini
CORNELIUS_MODULES_DIR=/chemin/vers/cornelius-modules
```

## Mettre à jour

```bash
git -C cornelius-modules pull
```

Redémarrez ensuite Cornelius : les modules ne sont lus qu’au démarrage. Les sources déjà réglées sont gardées.

Si un module demande une version de Cornelius plus récente que celle installée, il n’est pas chargé. L’administration l’indique en bas de **Modules**, sous « Module non chargé », avec la version attendue : mettez alors Cornelius à jour.

## Les modules

| Module | Ce qu’il fait | Jeton | Fiche |
| --- | --- | --- | --- |
| _Aucun pour l’instant._ | Le premier se crée à partir du [gabarit](_template/). | | |

## Créer un module

```sh
cp -r _template parking
```

Remplacez le fournisseur fictif du gabarit, adaptez les schémas et les tests, puis :

```sh
npm test
npm run check
```

Le pas à pas complet est dans [Créer un module](docs/creer-un-module.md). Les règles sont dans la [référence du contrat](docs/reference.md).

### Les commandes

Ce dépôt n’a aucune dépendance à installer : ses commandes utilisent les outils du Cornelius voisin. `npm ci` doit seulement y avoir été lancé.

| Commande | Effet |
| --- | --- |
| `npm test` | Lance les tests de tous les modules avec le vrai cœur de Cornelius (base en mémoire, réseau simulé) |
| `npm run check` | Vérifie les types contre le contrat de Cornelius |
| `npm run format` | Met le code en forme (Prettier, mêmes règles que Cornelius) |
| `npm run format:check` | Vérifie la mise en forme sans rien changer |

Si Cornelius n’est pas dans `../cornelius`, indiquez son dossier dans `CORNELIUS_DIR` :

```bash
CORNELIUS_DIR=/chemin/vers/cornelius npm test
```

## Compatibilité

Un module dépend de Cornelius par trois alias, toujours résolus vers le Cornelius qui le charge :

| Alias | Contenu |
| --- | --- |
| `#cornelius/addons` | Le contrat : types, `AddonCollectError` |
| `#cornelius/validation` | La compilation des schémas JSON (Ajv) |
| `#cornelius/testing` | Pour les tests : `validateAddonDefinition`, `openDatabase`, `AddonRepository`, `AddonRuntime` |

Deux numéros protègent l’association :

- `apiVersion: 1` est le contrat. Il ne change qu’en cas de rupture, et un module d’une autre version est refusé.
- `minCoreVersion`, facultatif, est la version minimale de Cornelius (`'0.2.0'`) pour un module qui utilise un ajout récent du cœur.

Un module externe ne remplace jamais un module livré : s’il en reprend l’identifiant, il est refusé.

## Sécurité

Un module s’exécute dans le serveur de Cornelius, avec les mêmes droits que lui. N’ajoutez à ce dépôt, et n’installez, que des modules dont vous avez lu le code ou connaissez l’auteur. Le cœur leur impose son client HTTP (sans redirections, réponses bornées) et valide tout ce qu’ils renvoient. Leurs jetons restent dans le `.env` ou l’administration de Cornelius, jamais dans ce dépôt.

## Documentation

- [Créer un module](docs/creer-un-module.md) : le tutoriel, du gabarit à l’essai à la voix
- [Référence du contrat](docs/reference.md) : toutes les règles (copie de celle de Cornelius, qui fait foi)
- [Fiche d’un module](_template/README.md) : le modèle à remplir pour chaque module
- [Les modules dans Cornelius](https://git.diy.yt/lfpoulain/cornelius/src/branch/main/docs/modules/README.md) : sources, jetons et catalogue, côté administration

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE), comme Cornelius : usage non commercial libre. Chaque module peut préciser dans sa fiche la licence des données de son fournisseur.

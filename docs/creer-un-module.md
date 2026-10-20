# Créer un module

Ce tutoriel construit pas à pas, dans ce dépôt, un module d’informations à partir du gabarit : un module « parking » qui annonce les places libres. Il s’adresse à une développeuse ou un développeur à l’aise avec TypeScript. Les règles complètes du contrat sont dans la [référence](reference.md).

Un module d’informations lit une source, garde des données propres et fournit la réponse orale et la carte. Pour déclencher une action (ouvrir un portail), utilisez plutôt une [commande HTTP](https://git.diy.yt/lfpoulain/cornelius/src/branch/main/docs/modules/README.md#les-commandes-http) de Cornelius : aucun code n’est nécessaire.

Ce tutoriel construit une lecture ordinaire, la même à chaque appel et gardée en cache. Pour un module qui répond à une question libre (chercher dans des documents, interroger un service), suivez les mêmes étapes, puis déclarez un [outil à la demande](reference.md#loutil-à-la-demande) : `collect` reçoit alors la question dans `context.query`. Le module livré [Ragator](https://git.diy.yt/lfpoulain/cornelius/src/branch/main/addons/ragator/index.ts) en est l’exemple.

## Avant de commencer

- Cornelius est cloné **à côté** de ce dépôt, dans `../cornelius`, et `npm ci` y a été lancé. Ailleurs, indiquez son dossier dans `CORNELIUS_DIR`.
- Rien à installer ici : `npm test`, `npm run check` et `npm run format` utilisent les outils de Cornelius.

## 1. Copier le gabarit

Le dossier `_template` contient un module complet relié à un fournisseur fictif, avec ses schémas, une réponse d’exemple et ses tests. Son nom commence par `_` : Cornelius ne le charge pas. Depuis la racine de ce dépôt :

```sh
cp -r _template parking
```

```powershell
Copy-Item -Recurse _template parking
```

Vous obtenez :

| Fichier | Rôle |
| --- | --- |
| `index.ts` | La définition du module, exportée par défaut |
| `config.schema.json` | Les réglages d’une source |
| `data.schema.json` | Les données gardées après chaque lecture |
| `fixtures/availability.json` | Une réponse fictive du fournisseur, pour les tests |
| `addon.test.ts` | Les tests, lancés par `npm test` |
| `README.md` | La fiche du module, à remplir |

## 2. Choisir l’identifiant

Dans `index.ts`, le champ `id` doit être **identique au nom du dossier**. Il commence par une lettre minuscule, puis contient au plus 31 minuscules, chiffres ou `_` (motif `^[a-z][a-z0-9_]{0,31}$`). Pas de tiret : un dossier `parking-gare` serait ignoré sans message, alors que `parking_gare` convient.

L’identifiant ne doit pas être celui d’un module livré avec Cornelius (`clock`, `weather`, `transit`, `ragator`) : le module externe serait refusé, et le module livré resterait en place.

Le gabarit déclare déjà `id: 'parking'`. Pour un dossier d’un autre nom, changez `id` et la valeur de `sources` dans `present` : sinon le module est refusé au démarrage (« identifiant « parking » différent du dossier. »).

Remplacez ensuite les éléments fictifs : `sourceLabel` (le nom du fournisseur, qui sert aussi de nom au module dans l’administration), `baseUrl`, le `provider` renvoyé par `collect`, les types `ParkingConfig` et `ParkingData`, les textes.

Pour les imports :

- le contrat vient de `#cornelius/addons` et `#cornelius/validation`, les outils de test de `#cornelius/testing`. Jamais de chemin vers `../cornelius/` : Cornelius résout ces alias vers lui-même, où qu’il soit installé ;
- les imports locaux gardent l’extension `.js` (`./index.js`) ;
- les fichiers JSON s’importent avec `with { type: 'json' }`.

L’outil vocal prend le nom `<id>__read` : ici `parking__read`.

## 3. Décrire les réglages et les données

`config.schema.json` décrit les réglages d’une source. Le formulaire de l’administration est construit à partir de lui :

```json
"parkingId": {
  "title": "Parking",
  "description": "Identifiant du parking chez le fournisseur.",
  "type": "string",
  "pattern": "^[a-z0-9_-]{1,64}$",
  "examples": ["demo"]
}
```

- `title` devient le libellé du champ et `description` le texte d’aide. Sans description, un champ qui a un `minimum` et un `maximum` affiche « De … à … ».
- Le premier élément de `examples` sert d’exemple dans le champ (« ex. demo »).
- `maxLength` limite la saisie. `pattern`, `minimum`, `maximum` et les champs requis sont contrôlés par le serveur à l’enregistrement, qui affiche ses erreurs en français sous chaque champ.
- Un booléen devient un interrupteur. Un champ nommé `timeZone` devient une liste de fuseaux. Un type `["string", "null"]` rend le champ facultatif.
- Il n’y a pas de liste déroulante pour `enum`, ni d’éditeur pour les objets ou les tableaux imbriqués : gardez des propriétés simples, au premier niveau.

`configDefaults` (dans `index.ts`) préremplit le formulaire de création. Il ne complète pas une configuration existante.

`data.schema.json` décrit les données normalisées que `collect` renvoie. Le serveur les vérifie après chaque lecture : des données non conformes sont refusées comme « mal formées ». Déclarez `additionalProperties: false`, les champs requis, et des bornes.

Ni les réglages ni les données ne contiennent de secret. Un jeton se déclare à part (voir la [référence](reference.md#les-secrets)).

## 4. Écrire la collecte

`collect` interroge le fournisseur avec le client fourni par le cœur (`context.http`), jamais avec `fetch`. Transmettez toujours `context.signal`, pour qu’une lecture devenue inutile s’arrête :

```ts
const response = await context.http.fetch({
  url: `${baseUrl}/parkings/${encodeURIComponent(context.config.parkingId)}`,
  method: 'GET',
  signal: context.signal,
  timeoutMs: 4000,
  maxBytes: 32 * 1024,
});
```

Traduisez chaque statut en une erreur `AddonCollectError` avec un message court et compréhensible. La réponse n’a pas de propriété `ok`, et `json()` lève une exception sur un texte illisible :

```ts
if (response.status === 404) throw new AddonCollectError('not_found', 'Parking introuvable.');
// …
let payload: unknown;
try {
  payload = response.json();
} catch {
  throw new AddonCollectError('malformed', 'Réponse du fournisseur illisible.');
}
```

Vérifiez la réponse avant de l’utiliser (le gabarit compile un validateur), puis renvoyez les données et leur source :

```ts
return {
  data: { name: payload.name, available: payload.available },
  // Zéro place est une information utile : ce n'est pas un résultat « empty ».
  source: { provider: 'parking-demo', sourceId: context.config.parkingId },
  // Pas de date d'observation inventée : fetchedAt sera fourni par le cœur.
};
```

N’inventez jamais de valeur : une panne n’est pas « zéro place ». Les codes d’erreur sont listés dans la [référence](reference.md#les-erreurs-de-collecte).

## 5. Présenter la carte et la réponse orale

`present` transforme les données en carte et en phrase à dire. Elle est synchrone, sans réseau et sans effet de bord :

```ts
present(snapshot) {
  const data = snapshot.data;
  if (!data) throw new Error('Aucune disponibilité à présenter.');
  const stale = snapshot.status === 'stale';
  return {
    title: 'Parking',
    primaryValue: `${data.available} place${data.available === 1 ? '' : 's'}`,
    subtitle: data.name,
    description: stale ? 'Dernière disponibilité connue, à vérifier.' : null,
    items: [],
    summary: stale
      ? `Dernière disponibilité connue à ${data.name} : ${data.available} places ; à vérifier.`
      : `${data.name} : ${data.available} places disponibles.`,
    sources: ['parking'],
  };
},
```

Respectez les longueurs maximales (titre de 80 caractères, cinq lignes au plus…) : une carte trop longue est refusée et Cornelius répond que les données sont illisibles. Avec `status === 'stale'`, les données datent d’avant une panne : dites-le. Utilisez `null`, jamais une chaîne vide.

## 6. Proposer l’affichage permanent (facultatif)

Avec un champ `ambient`, l’administration propose « Afficher en permanence sur le miroir » pour les sources du module :

```ts
ambient: {
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune disponibilité à afficher.');
    return {
      layout: 'metric',
      title: 'Parking',
      value: `${data.available} places`,
      subtitle: data.name,
      items: [],
    };
  },
},
```

`layout` vaut `'metric'` (une valeur en grand) ou `'list'` (trois lignes au plus). Sur le miroir, l’en-tête est le « Nom affiché » de la source (« Parking de la gare ») : `title` est obligatoire mais n’y apparaît pas. La date du relevé s’affiche dessous, sauf avec `showCollectedAt: false`. Retirez ce bloc si le module ne s’y prête pas.

## 7. Déclarer la version de Cornelius nécessaire (si besoin)

Le contrat `apiVersion: 1` ne change pas sans prévenir. Mais Cornelius peut ajouter des fonctions compatibles : un champ facultatif, une fonction dans `#cornelius/addons`. Si votre module en utilise une, déclarez la version de Cornelius qui l’a apportée :

```ts
minCoreVersion: '0.2.0',
```

Sur un Cornelius plus ancien, le module est alors refusé au démarrage avec la raison (« nécessite Cornelius 0.2.0 ou plus récent (installé : 0.1.0). ») au lieu d’échouer à la première lecture. La version installée est celle du `package.json` de Cornelius.

## 8. Tester

Adaptez `addon.test.ts` et la réponse fictive au vrai fournisseur, sans oublier l’adresse attendue dans le premier test. Les tests utilisent une base en mémoire, une horloge réglable et un client HTTP simulé : ils ne contactent aucun serveur. Ils vérifient déjà le contrat, la carte, le cache, les lectures simultanées, la valeur zéro, la panne initiale, le repli sur le dernier relevé, la réponse mal formée et la source inconnue.

```sh
npm test
npm run check
npm run format
```

`npm test` lance les tests de tous les dossiers du dépôt, gabarit compris, avec le Cornelius voisin. `npm run check` vérifie les types contre son contrat. Depuis Cornelius, `npm run test:modules` fait la même chose que `npm test` ici.

## 9. Installer et essayer

1. Redémarrez Cornelius : les modules ne sont lus qu’au démarrage. Il charge ce dépôt s’il est cloné à côté de lui (ou dans `CORNELIUS_MODULES_DIR`).
2. Ouvrez **Modules**. Le module apparaît à la fin du groupe « Au quotidien », sous le nom de son `sourceLabel`, avec une icône de prise et le badge « À configurer ». S’il est refusé, l’encadré « Module non chargé », en bas de la page, donne la raison (« identifiant … différent du dossier », « collecte absente »…).
3. Cliquez sur le nom du module pour le déplier, puis sur **Ajouter une source**. Remplissez le formulaire et cliquez sur **Ajouter**. Une valeur refusée par `config.schema.json` est signalée sous son champ (par exemple « Format invalide. »).
4. Cliquez sur **Tester** : avec un vrai fournisseur, c’est un vrai appel, sans passer par le cache. Le résultat s’affiche sous la source : « Réponse À jour · … », ou « Échec. » suivi du message de `collect` (« Échec. Introuvable : Parking introuvable. »). Tant que l’adresse fictive du gabarit est en place, le test échoue.
5. Si le module déclare `ambient`, activez **Afficher en permanence sur le miroir** dans la source : la valeur apparaît sur le miroir dès qu’une présence est confirmée devant la caméra.
6. En conversation, demandez l’information. Pour un module externe, la phrase proposée sous « Nom affiché » est de la forme « la source de Parking de la gare ».

Les modules livrés ont un nom, une icône et une description écrits dans l’interface de Cornelius. Un module externe s’en passe : il fonctionne avec son `sourceLabel` et l’icône par défaut.

## 10. Liste de contrôle

- [ ] Dossier et `id` identiques, différents des modules livrés ; le module se charge sans « Module non chargé ».
- [ ] Imports par `#cornelius/addons`, `#cornelius/validation` et `#cornelius/testing`, aucun chemin vers `../cornelius/`.
- [ ] `minCoreVersion` déclaré si le module dépend d’un ajout récent de Cornelius.
- [ ] Fournisseur fictif, adresse et textes du gabarit remplacés.
- [ ] Champs de réglage avec `title`, `description` et bornes ; valeurs par défaut vérifiées.
- [ ] Collecte avec `context.http` et `context.signal`, réponse validée, erreurs explicites.
- [ ] Aucun secret dans les réglages, les données, les réponses fictives, les cartes ou le journal.
- [ ] Carte dans les limites, dernier relevé annoncé comme tel.
- [ ] `ambient` présent seulement si l’affichage permanent a un sens.
- [ ] Tests adaptés ; `npm test`, `npm run check` et `npm run format:check` passent.
- [ ] Fiche `<id>/README.md` remplie : ce que fait le module, réglages, jeton et lien d’inscription, limites, outil vocal.
- [ ] Module ajouté au tableau du [README](../README.md#les-modules).
- [ ] Essai réel dans l’administration et à la voix, noté à part des tests automatiques.

## Avec un assistant de code

```text
Crée un module Cornelius pour [besoin], identifiant [id] (minuscules, chiffres, « _ »),
dans le dépôt cornelius-modules. Lis docs/reference.md, docs/creer-un-module.md,
puis ../cornelius/shared/addons.ts, ../cornelius/server/addons/runtime.ts et
../cornelius/server/addons/registry.ts. Pars d'une copie de _template, sans garder son
fournisseur fictif. Inspire-toi du module livré le plus proche dans ../cornelius/addons
(clock, weather, transit ; ragator pour une question libre), sans le modifier.

Source réelle : [documentation de l'API, adresses autorisées, format des réponses].
Réglages : [champs, titres, descriptions, valeurs par défaut].
Jeton : [nom de la variable .env, jamais sa valeur ; la déclaration dans secrets suffit].
Lecture : [ordinaire avec read, ou outil à la demande avec query et sa longueur maximale].
Fraîcheur : [durée, et traitement d'une donnée déjà ancienne].
Carte et oral : [faits prioritaires, comportement sans donnée].
Affichage permanent : [oui ou non ; metric ou list ; valeur et lignes].

Respecte le contrat v1 et ses limites. Importe uniquement par #cornelius/addons,
#cornelius/validation et #cornelius/testing. Ne modifie pas Cornelius : si le besoin
dépasse le contrat, décris l'évolution nécessaire. Livre la définition, les schémas,
des réponses fictives, des tests et la fiche [id]/README.md, et ajoute le module au
tableau du README. Vérifie npm test, npm run check et npm run format:check. Indique
ce qui est testé et ce qui reste à essayer avec le vrai fournisseur et à la voix.
```

## Voir aussi

- [Référence du contrat des modules](reference.md)
- [Fiche à remplir](../_template/README.md)
- [Les modules dans Cornelius](https://git.diy.yt/lfpoulain/cornelius/src/branch/main/docs/modules/README.md) : sources, jetons, catalogue
- Modules livrés, comme exemples : [Heure](https://git.diy.yt/lfpoulain/cornelius/src/branch/main/addons/clock/README.md), [Météo](https://git.diy.yt/lfpoulain/cornelius/src/branch/main/addons/weather/README.md), [Transports](https://git.diy.yt/lfpoulain/cornelius/src/branch/main/addons/transit/README.md)

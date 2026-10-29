# Aubel Réserve B

Application web (installable sur smartphone) permettant aux joueurs de l'équipe
**Aubel Réserve B** de désigner, après chaque match, leurs trois meilleurs
coéquipiers (3, 2 et 1 point). Les votes alimentent un classement de saison
réservé au maître, exportable en PDF.

- Joueurs : connexion par identifiant, vote en quelques secondes, historique personnel.
- Maître : calendrier, feuilles de match, ouverture/fermeture des votes (manuelle,
  programmée ou mixte), malus, classement, bulletins détaillés, corrections
  journalisées, gestion des comptes, export PDF.
- Équipe : surnoms, dates de naissance, statuts joueur / délégué / supporter,
  page de chaque match (présents, score, buteurs, passes, cartons) et page
  « Joueurs » avec les statistiques de la saison.
- Calendrier importable depuis Excel ou CSV, rappels de vote par notification.

Sommaire : [Architecture](#1-architecture-et-décisions) ·
[Structure](#2-structure-du-projet) · [Lancement local](#3-lancement-local) ·
[Tests](#4-tests) · [Déploiement](#5-déploiement-en-ligne) ·
[Compte maître](#6-création-du-compte-maître) ·
[Comptes joueurs](#7-création-et-remise-des-accès-joueurs) ·
[PWA](#8-installer-lapplication-sur-un-smartphone) ·
[Sécurité](#9-sécurité-et-confidentialité) ·
[Opérations manuelles](#10-opérations-restant-à-réaliser-manuellement)

---

## 1. Architecture et décisions

| Couche | Choix | Pourquoi |
| --- | --- | --- |
| Interface + serveur | Next.js 16 (App Router), TypeScript, Tailwind CSS 4 | Un seul projet, Server Actions pour toutes les écritures, rendu côté serveur. |
| Données | PostgreSQL (Supabase) | Contraintes, transactions et Row Level Security au plus près des données. |
| Authentification | Supabase Auth | Mots de passe hachés, sessions, bannissement des comptes désactivés. |
| Planification | `pg_cron` (Supabase), chaque minute | Ouvertures/fermetures fiables, sans dépendre d'un navigateur. |
| PDF | `pdf-lib` (pur JavaScript) | Fonctionne sur Vercel sans binaire natif. |
| Hébergement | Vercel (région Paris) + Supabase (région UE) | Gratuit pour une équipe amateur, HTTPS automatique. |

**Principe de sécurité central : la base de données fait foi.** Toutes les règles
métier (vote ouvert, feuille de match, 3 joueurs distincts, pas d'auto-vote,
heure limite, malus unique, droits du maître) sont vérifiées dans des fonctions
PostgreSQL transactionnelles. Les clients (navigateur, API REST de Supabase) n'ont
**aucun droit d'écriture direct** sur les tables et ne lisent que ce que la RLS
autorise. L'interface ne fait qu'appeler ces fonctions.

### Décisions fonctionnelles (validées ou prises par défaut)

1. **Feuille de match** : pour chaque match, le maître coche les joueurs présents.
   Seuls ces joueurs peuvent voter et être choisis.
2. **Le maître est aussi joueur** : il vote, peut être choisi et figure au classement.
3. **Malus de non-vote** : en plus du malus de retard, un malus optionnel
   (désactivé par défaut) frappe les joueurs de la feuille sans bulletin à la
   fermeture. Il n'est appliqué que si le vote a réellement été ouvert, et il est
   retiré si le joueur vote après une réouverture.
4. **Un seul malus par joueur et par match** (retard *ou* non-vote), garanti par
   une contrainte d'unicité.
5. **Montant du malus figé au moment où il est appliqué.** Changer le réglage ne
   recalcule pas le passé ; le maître peut ajuster un malus match par match
   (journalisé).
6. **Combinaison manuel / automatique** : l'événement le plus récent déjà survenu
   l'emporte (ouverture programmée, fermeture programmée ou action manuelle).
   Exemple : ouverture manuelle à 20 h puis fermeture programmée à 18 h le
   lendemain → fermé à 18 h. Le maître peut à tout moment « revenir aux horaires
   programmés ».
7. **Retard** : un bulletin est en retard si sa *première* soumission est reçue
   après l'heure limite (horloge du serveur de base de données). Une modification
   ultérieure ne change jamais ce statut.
8. **Heure limite ≠ fermeture** : si le vote reste ouvert après l'heure limite,
   on peut encore voter (en retard). Après la fermeture, plus rien n'est accepté.
9. **Classement** : points nets = max(0, bruts − malus). Tri : nets, puis bruts,
   puis égalité (même rang, rang suivant sauté : 1, 1, 3).
   « Matchs pris en compte » = matchs comptant pour le classement où le joueur
   figurait sur la feuille.
10. **Suppression d'un match** : impossible s'il contient des bulletins ou des
    malus. On peut l'**archiver** (masqué aux joueurs, vote fermé, toujours
    compté) ou le **sortir du classement**.
11. **Identifiants sans e-mail** : les joueurs se connectent avec un identifiant
    (`jean.dupont`). Techniquement, Supabase Auth reçoit une adresse
    `jean.dupont@<LOGIN_EMAIL_DOMAIN>` qui ne reçoit jamais de courrier. Il n'y a
    donc pas de « mot de passe oublié » par e-mail : le maître réinitialise.
12. **Heures** : stockées en `timestamptz`, saisies et affichées en heure de
    Bruxelles. Lors des changements d'heure, une heure inexistante (fin mars,
    02:30) est décalée à 03:30 ; une heure ambiguë (fin octobre, 02:30) est
    interprétée en heure d'hiver.
13. **Saisons** : plusieurs saisons possibles, une seule « en cours » (celle que
    voient les joueurs). Le maître consulte et exporte n'importe quelle saison.
14. **Correction d'un bulletin** par le maître : création, modification,
    annulation ou rétablissement, avec motif obligatoire, nouvelle version
    historisée et entrée au journal (valeurs avant/après).

---

## 2. Structure du projet

```
supabase/migrations/          Migrations SQL (à appliquer dans l'ordre)
  …0001_schema.sql            Tables, contraintes, index, triggers d'intégrité
  …0002_functions.sql         Vote atomique, planification, malus, classement, admin
  …0003_security.sql          RLS, révocation des droits, vue calendrier, droits d'exécution
  …0004_scheduler.sql         Tâche pg_cron (chaque minute)
src/
  proxy.ts                    Rafraîchit la session, redirige vers /connexion
  lib/                        Accès aux données, comptes, PDF, dates, logique de vote
  app/connexion               Connexion
  app/premiere-connexion      Choix du mot de passe (imposé si mot de passe temporaire)
  app/(joueur)/               Accueil, calendrier, vote/[match], historique, profil
  app/maitre/                 Tableau de bord, matchs, classement, résultats,
                              équipe, règles et saisons, journal, récap joueur
  app/api/classement/pdf      Export PDF (maître uniquement)
  app/api/cron/votes          Planificateur de secours (protégé par CRON_SECRET)
public/                       Icônes PWA et service worker
scripts/
  create-maitre.ts            Création sécurisée du premier compte maître
  seed-demo.ts                Données de démonstration (base locale uniquement)
  stack/                      Banc de test local sans Docker (Postgres + Auth + PostgREST)
tests/
  unit/                       Logique de sélection, dates/DST, comptes, PDF
  db/                         Tests contre une vraie pile Supabase (droits, RLS, vote, malus…)
  e2e/parcours.mjs            Parcours complet dans un navigateur (smartphone)
```

---

## 3. Lancement local

Prérequis : Node.js 20.9+ (22 recommandé).

**Option A, avec la CLI Supabase (Docker)** — la plus simple :

```bash
npm install
npx supabase init            # une fois, si le dossier supabase/config.toml n'existe pas
npx supabase start           # lance Postgres + Auth + API en local
npx supabase db reset        # applique supabase/migrations
cp .env.example .env.local   # puis collez l'URL et les clés affichées par « supabase start »
npm run seed:demo            # facultatif : équipe et matchs de démonstration
npm run dev                  # http://localhost:3000
```

Dans `supabase/config.toml`, mettez `enable_signup = false` (section `[auth]`).

**Option B, sans Docker (Linux x86-64)** : un PostgreSQL 16 local accessible en
`postgres` sans mot de passe sur le port 54322, puis :

```bash
npm run stack:download && npm run stack:start   # réinitialise la base de test !
# .env.local : NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#              + les deux clés de .stack/run/keys.env
npm run seed:demo && npm run dev
```

Comptes de démonstration : maître `coach`, joueurs `thomas.kessels`,
`julien.franssen`, `loic.pirard`… ; mot de passe commun `Demo-2026`.

---

## 4. Tests

```bash
npm run typecheck && npm run lint
npm run test:unit      # 28 tests : sélection 3/2/1, fuseau horaire, mots de passe, PDF, import Excel/CSV
npm run test:db        # 69 tests contre une vraie pile Supabase locale (option B ci-dessus)
npm run test:e2e       # parcours navigateur (application lancée + seed:demo, CHROME_PATH requis)
node tests/e2e/ameliorations.mjs   # surnom, statuts, stats, import, suppression (idem)
```

`test:db` recrée une base vierge, applique les migrations, puis vérifie
notamment :

- création des comptes par le maître uniquement, connexion, déconnexion,
  première connexion, réinitialisation, désactivation/réactivation, limitation des
  tentatives (5 échecs / 15 min), inscription publique refusée ;
- confidentialité **via l'API REST**, comme le ferait un joueur malveillant :
  un joueur ne voit que son bulletin, jamais qui a voté pour lui, ni les malus,
  le journal, le classement ; aucune écriture directe possible (bulletin, rôle,
  points, réglages) ; toutes les fonctions maître renvoient `FORBIDDEN` ;
  un visiteur anonyme n'accède à rien ;
- barème 3/2/1, auto-vote et doublons refusés (même en écriture SQL directe),
  feuille de match respectée, modification tant que c'est ouvert, refus après
  fermeture, statut de retard selon l'horloge serveur, bulletin à temps modifié
  après l'heure limite qui reste à temps, malus appliqué une seule fois ;
- 15 soumissions simultanées du même joueur → un bulletin cohérent, un malus ;
  toute l'équipe qui vote en même temps ;
- ouvertures/fermetures automatiques, modes mixtes, réouverture, retour au mode
  automatique, malus de non-vote, conversion des heures autour du changement d'heure ;
- classement : bruts, malus, nets plafonnés à zéro, départage, égalités,
  match hors classement, bulletin annulé non compté, correction journalisée,
  journal immuable.

Résultat au 29/10/2026 : **97 tests automatisés réussis** (28 unitaires,
69 base de données, dont l'envoi réel de notifications chiffrées vers un faux
service de push) et les deux parcours navigateur réussis (création de compte,
première connexion, vote 3/2/1, PDF, refus d'accès joueur, déconnexion, surnom,
feuille avec supporter, statistiques, import CSV, suppression confirmée, export
CSV ; aucun défilement horizontal à 390 px). La mise à jour SQL a aussi été
testée sur une base contenant déjà des joueurs, matchs et bulletins.

---

## 5. Déploiement en ligne

### 5.1 Supabase

1. Créez un compte sur supabase.com puis un projet (région **Europe**, ex.
   Frankfurt ou Paris). Notez le mot de passe de la base dans votre gestionnaire
   de mots de passe (il n'est pas utilisé par l'application).
2. **Appliquez les migrations**, au choix :
   - CLI : `npx supabase link --project-ref <ref>` puis `npx supabase db push` ;
   - ou **SQL Editor** : collez `supabase/installation-complete.sql` (les 4
     migrations réunies) et exécutez-le en une fois.
3. **Désactivez les inscriptions** : Authentication → Sign In / Providers →
   désactivez *Allow new users to sign up*. (Le fournisseur *Email* doit rester
   activé : c'est lui qui gère les mots de passe.)
4. **Vérifiez le planificateur** : Integrations → Cron : la tâche
   `aubel-vote-schedule` doit exister (`* * * * *`). Si la migration 4 a affiché
   « pg_cron indisponible », activez l'extension `pg_cron` (Database → Extensions)
   puis ré-exécutez la migration 4.
5. Récupérez dans Project Settings → API Keys : l'URL, la **Publishable key** et
   la **Secret key**.

### 5.2 Vercel

1. Poussez le code sur un dépôt GitHub privé, puis « Add New Project » sur
   vercel.com en important ce dépôt (framework détecté : Next.js).
2. Renseignez les variables d'environnement de `.env.example`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `LOGIN_EMAIL_DOMAIN`, `CRON_SECRET`).
3. Déployez. Optionnel : ajoutez un nom de domaine (Settings → Domains).
4. Dans Supabase → Authentication → URL Configuration, mettez l'adresse Vercel
   comme *Site URL*.

`vercel.json` déclare un appel quotidien de secours à `/api/cron/votes` ; le
planificateur principal reste `pg_cron` (chaque minute). Même si les deux
tombaient en panne, aucun vote ne pourrait être accepté hors fenêtre : l'état du
vote est recalculé à la réception de chaque bulletin.

---

## 6. Création du compte maître

**Méthode recommandée (navigateur, sans rien installer)** : renseignez
`SETUP_TOKEN` dans Vercel, ouvrez `https://<votre-site>/installation`, saisissez
ce code puis votre identifiant, nom et mot de passe. La page ne fonctionne
qu'une fois (elle se désactive dès qu'un maître existe) ; les codes erronés sont
limités à 5 essais par 15 minutes. Vous pouvez ensuite supprimer `SETUP_TOKEN`.

**Méthode alternative (script)** : une seule fois, depuis votre ordinateur, avec un `.env.local` pointant vers le
projet Supabase de production :

```bash
npm install
npm run create-maitre
```

Le script demande l'identifiant, le nom affiché, le numéro de maillot et le
mot de passe (saisi sans affichage, jamais écrit sur disque). Il refuse de
s'exécuter si un maître existe déjà. Supprimez ensuite la clé secrète de votre
`.env.local` si cet ordinateur est partagé.

Puis connectez-vous à l'application et :
1. **Règles et saisons** → créez la saison (ex. `2026-2027`, cochée « en cours ») ;
   réglez les malus.
2. **Équipe** → créez les comptes des joueurs.
3. **Matchs** → ajoutez les matchs, cochez la feuille de match, réglez l'heure
   limite et, si vous le souhaitez, l'ouverture/fermeture automatiques.

---

## 7. Création et remise des accès joueurs

1. Espace maître → **Équipe** → *Créer un compte joueur* : nom affiché,
   numéro (facultatif), identifiant (ex. `jean.dupont`).
2. L'application génère un **mot de passe temporaire** (ex. `K7PQ-M3XR-9TBW`),
   affiché **une seule fois**. Le bouton *Copier le message à envoyer* prépare un
   texte avec l'adresse du site, l'identifiant et ce mot de passe.
3. Transmettez-le **individuellement** (en main propre, ou message privé au
   joueur seul — jamais dans le groupe de l'équipe).
4. À sa première connexion, le joueur doit choisir son propre mot de passe ;
   le temporaire cesse alors de fonctionner. Le tableau de bord signale les
   comptes qui ne l'ont pas encore fait.
5. Mot de passe oublié : *Réinitialiser le mot de passe* sur la fiche du joueur
   (nouveau mot de passe temporaire, changement imposé).
6. Départ d'un joueur : *Désactiver le compte* (connexion impossible, historique
   et points conservés). Réactivable à tout moment.

Un joueur qui n'utilise pas l'application peut être ajouté *sans compte* : il
figure sur les feuilles de match et peut recevoir des voix.

---

## 8. Installer l'application sur un smartphone

Rien n'est obligatoire : le lien web suffit. Pour une icône sur l'écran d'accueil :

- **iPhone (Safari)** : ouvrir le site → bouton *Partager* → *Sur l'écran
  d'accueil* → *Ajouter*.
- **Android (Chrome)** : ouvrir le site → menu ⋮ → *Installer l'application*
  (ou *Ajouter à l'écran d'accueil*).

L'application s'ouvre alors en plein écran. Les données ne sont jamais mises en
cache sur le téléphone (seuls les fichiers statiques le sont) ; hors connexion,
une page l'indique.

---

## 9. Sécurité et confidentialité

- **Refus par défaut** : tous les droits accordés par défaut par Supabase sur le
  schéma `public` sont révoqués ; RLS activée sur toutes les tables ; aucune
  politique d'écriture pour les clients.
- **Écritures uniquement via fonctions** `SECURITY DEFINER` à `search_path` vide,
  qui vérifient l'identité (`auth.uid()`), le rôle maître et l'état du vote, dans
  une seule transaction.
- **Un joueur ne lit que** : l'effectif (noms/numéros), les matchs non archivés,
  les feuilles de match, **son** profil, **ses** bulletins et **leurs**
  sélections. Jamais les bulletins des autres, les voix reçues, les malus, le
  classement, le journal.
- **Le maître seul** voit l'association votant ↔ sélections (pages *Résultats
  détaillés*). Le PDF ne contient que le classement agrégé.
- **Clé secrète** utilisée seulement côté serveur, après vérification explicite
  du rôle maître, et revérifiée par la base (`svc_require_maitre`).
- **Comptes** : inscription publique désactivée, création réservée au maître,
  mots de passe hachés par Supabase Auth, mot de passe temporaire à changer,
  comptes désactivés bannis côté Auth, 5 échecs de connexion par identifiant
  (20 par IP) en 15 minutes → blocage temporaire, en plus des limites de Supabase.
- **Intégrité** : un bulletin par joueur et par match (contrainte unique),
  3 sélections exactement (trigger différé), pas d'auto-vote (trigger), points
  calculés par la base (3/2/1), un malus par joueur et par match, journal d'audit
  non modifiable.
- **En-têtes HTTP** : HSTS, `X-Frame-Options: DENY`, `nosniff`, pages en
  `Cache-Control: private, no-store`.

---

## 10. Opérations restant à réaliser manuellement

1. Créer les comptes Supabase et Vercel, le projet Supabase, et appliquer les
   4 migrations (§ 5.1).
2. Désactiver les inscriptions dans Supabase Auth et vérifier la tâche Cron (§ 5.1).
3. Renseigner les variables d'environnement dans Vercel et déployer (§ 5.2).
4. Créer le compte maître via la page `/installation` (§ 6).
5. Créer la saison, les comptes joueurs, puis le calendrier (§ 6 et 7).
6. Remettre individuellement les accès aux joueurs (§ 7).
7. Facultatif : nom de domaine personnalisé ; sauvegardes (les projets Supabase
   gratuits sont mis en pause après une période d'inactivité prolongée et n'ont pas
   de sauvegardes téléchargeables : exportez régulièrement la base via
   `npx supabase db dump` ou passez à une offre payante pendant la saison).
8. Vérifier sur un vrai iPhone et un vrai Android l'installation de la PWA
   (testée ici en navigateur headless à 390 px de large).

**Limites connues** : pas de récupération de mot de passe par e-mail (choix de
conception, cf. décision 11) ; pas de notifications push de rappel de vote.

---

## 11. Améliorations du 29 octobre 2026

### Ce qui change

| Fonction | Où | Règle |
| --- | --- | --- |
| Surnom | Profil (joueur) ou Équipe (maître) | Le joueur ou le maître coche « afficher le surnom » : il remplace le nom partout (vote, classement, PDF). Deux joueurs ne peuvent pas avoir le même nom affiché. |
| Date de naissance | Profil ou Équipe | Visible par tous les membres (âge sur la page Joueurs) ; export CSV de l'équipe pour le maître. |
| Joueur / délégué / supporter | Statut par défaut sur la fiche, modifiable sur chaque feuille de match | Joueur et délégué : votent et peuvent recevoir des voix. Supporter : vote, mais ne peut pas être choisi (contrôlé par la base). Un joueur ayant déjà reçu des voix ne peut pas devenir supporter pour ce match. Les supporters n'apparaissent pas au classement. |
| Supprimer un match avec votes | Fiche du match, zone « Archivage et suppression » | Taper `SUPPRIMER`. Bulletins, malus, statistiques et feuille sont effacés et retirés du classement ; une copie complète est conservée dans le journal. |
| Import du calendrier | Calendrier → « Importer (Excel / CSV) » | Modèle téléchargeable (.xlsx ou .csv). Aperçu avec erreurs ligne par ligne, puis import « tout ou rien ». Les doublons (même adversaire, date et heure) sont ignorés. |
| Notifications | Profil → Notifications (chaque joueur, sur chaque téléphone) | À l'ouverture du vote et X heures avant l'heure limite (réglable, 3 h par défaut), uniquement pour les joueurs de la feuille qui n'ont pas voté. Une seule fois par type. |
| Score, buts, passes, cartons | Fiche du match (maître) | Visibles par tous : page du match et page Joueurs. 2 jaunes et 1 rouge maximum par joueur et par match. |
| Présents | Page du match (tous les joueurs) | Liste de la feuille de match avec les statuts. Qui a voté pour qui reste confidentiel. |

### Format du fichier de calendrier

Première ligne = en-têtes (accents et majuscules indifférents). Une ligne par match.

| Colonne | Obligatoire | Format | Exemple |
| --- | --- | --- | --- |
| date | oui | JJ/MM/AAAA | 08/11/2026 |
| heure | oui | HH:MM (heure belge) | 15:00 |
| adversaire | oui | texte | FC Herve C |
| lieu | non | texte | Aubel |
| classement | non | oui / non (oui par défaut) | non |
| ouverture_vote | non | JJ/MM/AAAA HH:MM | 08/11/2026 17:00 |
| heure_limite | non | JJ/MM/AAAA HH:MM | 10/11/2026 20:00 |
| fermeture_vote | non | JJ/MM/AAAA HH:MM | 11/11/2026 20:00 |

Colonnes de vote vides : règles choisies à l'import (par défaut ouverture 2 h
après le coup d'envoi, heure limite 48 h après, fermeture 72 h après ; chaque
règle peut être « manuelle »).

### Comment fonctionnent les notifications

- Norme Web Push, sans service payant. Les clés de chiffrement (VAPID) sont
  générées automatiquement et stockées dans la base : aucune variable à ajouter.
- Android (Chrome) : fonctionne directement. iPhone : uniquement si
  l'application est **installée sur l'écran d'accueil** (iOS 16.4 ou plus).
- Toutes les 10 minutes, la base (pg_cron) vérifie s'il y a des rappels à
  envoyer et, seulement dans ce cas, appelle le site via pg_net. L'adresse du
  site est mémorisée automatiquement quand le maître ouvre son tableau de bord.
- À l'ouverture manuelle d'un vote, la notification part immédiatement.

### Mettre à jour une installation existante

1. **Supabase → SQL Editor** : coller `supabase/mise-a-jour-2026-10-29.sql`,
   cliquer **Run** (une seule fois). Attendu : « Success. No rows returned ».
2. **Supabase → Database → Extensions** : vérifier que **pg_net** est activé
   (la mise à jour l'active si possible). **Integrations → Cron** : une
   nouvelle tâche `aubel-push` doit apparaître.
3. **GitHub** : déposer les fichiers mis à jour (Add file → Upload files) :
   d'abord le dossier `src`, puis `public`, `supabase`, `scripts`, `tests` et
   les fichiers `package.json`, `package-lock.json`, `next.config.ts`,
   `vitest.config.mts`, `README.md`. Les fichiers existants sont remplacés.
4. **Vercel** redéploie automatiquement. Ouvrir une fois l'espace maître
   (tableau de bord) pour mémoriser l'adresse du site.
5. Demander aux joueurs d'activer les notifications dans leur Profil.

Ordre important : la base (étape 1) **avant** le code (étape 3), sinon le
nouveau site cherchera des colonnes qui n'existent pas encore.

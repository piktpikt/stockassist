# Stock Assist for Salonkee — Executive Summary

> Document de référence projet. Contient l'ensemble des décisions produit, architecture, pricing et stratégie commerciale. À utiliser comme base de connaissances dans un projet Claude ou à partager avec des partenaires.

**Auteur** : Philippe / PIKT Consulting SARL — Luxembourg
**Dernière mise à jour** : Février 2026
**Statut** : MVP complet, prêt pour pilote terrain

---

## 1. Le problème

Les salons de coiffure/beauté au Luxembourg utilisent **Salonkee** comme logiciel de gestion (POS, planning, stock transactionnel). Salonkee gère bien le stock automatique (vente = décrément), les alertes low-stock, et le multi-sites.

Mais Salonkee **ne propose aucune solution d'inventaire physique**. Pas de mode "stocktake", pas d'import CSV pour corriger les niveaux de stock, pas d'API publique. Le gérant qui veut réconcilier son stock réel avec Salonkee doit :

1. Compter à la main (papier, mémoire)
2. Retaper chaque quantité dans Salonkee, produit par produit
3. Espérer ne pas se tromper

Avec 9 employés, des centaines de références, du Wi-Fi instable, et plusieurs zones physiques (vitrine, réserve, postes de travail), ce processus est lent, source d'erreurs, et non traçable.

**Stock Assist comble ce trou.** Pas en remplaçant Salonkee. En rendant fiable le moment critique : la mise à jour du stock.

---

## 2. Ce que fait le produit

Stock Assist est une **Progressive Web App** (PWA) d'inventaire physique assisté. Elle permet à plusieurs employés de scanner simultanément les produits avec leurs téléphones, consolide le comptage, et génère un export fiche par fiche pour ressaisir dans Salonkee sans erreur.

### Fonctionnalités clés

**Scan multi-poste** : Chaque employé ouvre la PWA sur son téléphone, se connecte avec un code salon + PIN, choisit sa zone (Vitrine, Réserve, Coiffure…), et scanne. Tous les scans convergent vers un Google Sheet centralisé.

**Feedback immédiat** : Bip sonore (Web Audio API, zéro fichier), flash visuel vert/ambre, vibration, banner avec nom du produit. Produit connu → carte instantanée. Produit inconnu → modal pour le nommer, le photographier, et l'ajouter au catalogue.

**Quantités et état** : Boutons +/− pour compter plusieurs unités. Toggle Ouvert/Fermé pour distinguer stock neuf vendable vs stock entamé en cours d'utilisation.

**Mode hors-ligne** : Les scans sont mis en file d'attente dans localStorage et partent automatiquement au retour réseau. L'outil reste utilisable même sans Wi-Fi.

**Écran Stock** : Consultation des résultats d'inventaire par date. Filtres par zone, catégorie, marque, type. Produits triés par écart croissant (pires manques en premier). Indicateurs financiers : coût stock, valeur vente, marge brute, perte sèche.

**Écran Export Salonkee** (la fonctionnalité différenciante) : Transforme l'inventaire en fiches scannables. Chaque fiche affiche le code-barres SVG du produit, le stock compté, l'écart vs catalogue, et une instruction opérateur en langage clair : "Dans Salonkee, augmenter le stock à 12" ou "Rien à modifier". Le gérant ouvre Salonkee sur le PC, navigue les fiches sur son téléphone, le scanner USB du POS lit le barcode depuis l'écran, et il saisit la bonne quantité. Navigation par boutons, swipe, ou défilement automatique.

**Annulation** : Chaque scan est annulable individuellement (ligne négative dans le Sheet, stats recalculées).

**Synthèse** : Rapport auto-généré avec ventilation par produit, zone, personne, alertes écarts, valorisation financière par type (Vente / Consommable / Les deux).

---

## 3. Décisions d'architecture

### Modèle centralisé PIKT

L'architecture est **centralisée sous le compte PIKT Consulting**. Un seul Apps Script déployé dessert tous les clients. Chaque client a son propre Google Sheet (il possède ses données), mais le moteur logiciel est contrôlé par PIKT.

```
COMPTE PIKT CONSULTING
├── Registre Licences (Sheet privé PIKT)
│     Code Salon → Hash PIN → Sheet ID client → Date expiration → Actif
├── Apps Script centralisé (unique, sert tous les clients)
├── PWA statique hébergée sur Coolify (scan.piktconsulting.lu)
└── Dossier Drive pour photos inventaire

COMPTE DU CLIENT
└── Google Sheet partagé en Éditeur (ses données, export libre)
```

**Pourquoi ce choix :**

- Le client possède ses données (éthique + légal + confiance)
- Le moteur est chez PIKT → lock-in technique sans lock-in contractuel
- Désactivation d'un client = changer une cellule dans le Registre
- Zéro infrastructure à gérer chez le client
- Coût d'hébergement total : 0 €

**Lock-in** : Pour bypasser Stock Assist, un concurrent devrait comprendre l'architecture, recréer les endpoints Apps Script, recoder la PWA. Le client garde toujours ses données, mais l'outil n'est pas trivialement réplicable. C'est un lock-in par la valeur, pas par le contrat.

### Authentification

- **Code salon** : identifiant public (ex: WALF), persisté en localStorage pour confort
- **PIN** : numérique, hashé SHA-256 côté serveur, jamais stocké en clair ni côté client ni dans le Registre
- Token format `CODE:PIN` dans le body de chaque requête POST (jamais en URL)
- Vérification à chaque requête : code valide + PIN correct + licence active + non expirée
- Pas de login individuel par employé (prénom déclaratif) — V2

### Sécurité

- Toutes les requêtes en POST (token hors URL)
- HTTPS obligatoire (Let's Encrypt via Coolify)
- Protection XSS systématique : fonction `esc()` appliquée sur 20 points d'injection, pattern data-attributes pour les onclick dynamiques, parseInt() pour les nombres, whitelist pour les types
- Zéro innerHTML non protégé sur données externes

### Stack technique — coût zéro

| Composant | Technologie |
|-----------|------------|
| Frontend | HTML5 + CSS + JS (fichier unique 1921 lignes), police Outfit |
| Scanner | html5-qrcode 2.3.8 (CDN) — EAN-13, EAN-8, UPC, CODE-128 |
| Barcodes export | JsBarcode 3.11.6 (CDN) |
| Audio | Web Audio API (synthèse sonore, zéro fichier) |
| Backend | Google Apps Script centralisé |
| Données | Google Sheets (1 par client) |
| Photos | Google Drive |
| Hébergement | Coolify sur infra PIKT |
| **Coût total** | **0 €** |

### Limites connues (acceptées pour MVP)

- Apps Script : 20 000 requêtes/jour, ~1 seconde par exécution — suffisant pour 1-5 salons, fragile au-delà de 10 clients actifs simultanés
- Pas de sync temps réel entre téléphones (historique local par session)
- Catalogue chargé une fois au login (produit ajouté par un autre → invisible jusqu'au prochain login)
- Photos en base64 dans le POST (fonctionnel mais pas optimal)
- Synthèse déclenchée manuellement

---

## 4. L'écran Export — pourquoi c'est le cœur du produit

Sans l'Export, Stock Assist est un inventaire de plus. Avec l'Export, c'est le **pont entre "j'ai compté" et "c'est dans Salonkee"** — et c'est exactement là que les erreurs coûtent de l'argent.

L'Export transforme un inventaire brut en workflow opérationnel :

1. **Deux métriques par produit** : stock compté (bleu) + écart vs catalogue (4 états : à ajouter ▲ orange, à retirer ▼ violet, conforme = gris, pas de référence)
2. **Instruction opérateur** en langage naturel : "Dans Salonkee, augmenter le stock à 12" — pas de calcul mental, pas d'interprétation
3. **Code-barres SVG scannable** depuis l'écran du téléphone par le scanner USB du POS
4. **Palette colorblind-safe** (bleu/orange/violet) + symboles redondants (▲/▼/=)
5. **Toggle EAN-13** pour filtrer les produits dont le code-barres ne sera pas reconnu par le scanner USB
6. **Cache offline borné** (max 10 dates, versionné, purge propre)

C'est ce qui différencie Stock Assist d'un tableur ou d'une app de comptage générique.

---

## 5. Pricing et stratégie commerciale

### Positionnement

> "On ne remplace pas Salonkee. On vous aide à ne plus vous tromper quand vous mettez à jour votre stock."

Stock Assist n'est **pas** une intégration Salonkee, **pas** une synchronisation automatique, **pas** un outil de vente ou de caisse. C'est un **outil de fiabilisation** du processus d'inventaire physique + ressaisie.

Ce framing est délibéré : il évite toute friction avec Salonkee (pas de concurrence perçue, pas de zone grise API), et positionne le produit dans la catégorie "petit outil utile" — pas "investissement IT".

### Tarification

| | Détail |
|---|---|
| **Prix standard** | **39 € / mois HT par salon** |
| **Prix pilote** | **29 € / mois HT pendant 3 mois**, puis passage automatique à 39 € |
| Engagement | Aucun — annulation libre |
| Inclus | Inventaires illimités, employés illimités, export, offline, synthèse, photos, support email |

### Logique de pricing

La grille 39 €/29 € résulte d'une analyse structurée :

**Plafonds psychologiques dans le marché salon** :
- < 30 € = "petit outil utile" → zéro friction, mais sous-valorise le travail
- 30–40 € = "outil pro spécialisé" → bon positionnement, prix crédible
- > 50 € = "logiciel à justifier" → déclenche comparaison avec Salonkee, attentes support/SLA/intégration

**À 39 €/mois, le gérant compare inconsciemment à** : 1 heure de travail (≈ 25-40 € au Luxembourg), 1 erreur de stock, 1 produit perdu, 1 café par employé. Il ne compare pas à un logiciel métier.

**Pourquoi pas 50 €** : à ce niveau, le produit passe dans la zone "décision stratégique" — le gérant demande une intégration officielle, un SLA, du support téléphonique. Le produit ne supporte pas ces attentes (backend Apps Script, pas d'intégration Salonkee).

**Pourquoi pas 20 €** : la valeur délivrée est réelle (2-3h économisées × 9 employés × 12 inventaires/an × erreurs évitées). À 20 €, le client ne prend pas l'outil au sérieux et il sera difficile d'augmenter ensuite.

**Phrase clé** : "C'est moins qu'une heure de travail, et ça évite les erreurs quand vous mettez à jour Salonkee." Si on dit ça, 39 € passe.

### Ce qu'on ne fait pas

- ❌ Plusieurs plans (Basic/Pro/Premium) — un seul produit, un seul prix
- ❌ Prix "à la demande" — pas de négociation salon par salon
- ❌ Freemium — friction inutile, revenus imprévisibles
- ❌ 50 €+ — pas adapté au positionnement MVP

### Pitch commercial

**30 secondes (verbal, au comptoir)** : "Aujourd'hui, votre inventaire c'est du papier, des erreurs, et 3 heures à tout retaper dans Salonkee. Là, chaque employé scanne avec son téléphone, chacun dans sa zone. Tout se consolide. À la fin, l'export vous dit exactement quoi modifier dans Salonkee. 39 euros par mois, pas d'engagement."

**10 secondes (couloir)** : "C'est un outil qui évite les erreurs quand vous mettez à jour votre stock dans Salonkee. Inventaire rapide, hors ligne, multi-employés. 39 € par mois."

**Règles de communication** :
- Toujours dire : fiabilité, temps gagné, erreurs évitées, inventaire physique assisté, export assisté pour Salonkee, multi-employés, hors-ligne
- Ne jamais dire : API, contournement, limites Salonkee, hack, workaround, intégration, synchronisation automatique

---

## 6. Marché cible et contexte

### Le client type

- Salon de coiffure/beauté/manucure au Luxembourg
- Utilise Salonkee (position dominante au Luxembourg)
- Équipe de 3 à 15 personnes
- Mix produits revente (shampoings, soins) + consommables (colorations, oxydants)
- Fait un inventaire mensuel ou trimestriel
- Le gérant veut un stock fiable mais n'a pas envie d'y passer la journée

### Pourquoi Salonkee ne résoudra pas ce problème

Salonkee est un système fermé : pas d'API publique documentée, pas d'export CSV du stock, pas d'import inventaire physique, pas de mode stocktake. Leur modèle est le stock transactionnel (vente = décrément, réception = incrément, alertes low-stock). L'inventaire physique est un besoin "trop petit" pour un SaaS de cette taille — exactement le genre de niche qu'un consultant terrain peut exploiter.

### Salon pilote

Le premier pilote cible est un salon à **Walferdange** (Luxembourg), 9 employés, utilisateur Salonkee.

---

## 7. Risques et tests critiques

### Deux tests bloquants (5 minutes chacun, au salon)

| Test | Question | Impact si échoue |
|------|----------|------------------|
| **Scanner USB lit barcode écran** | Le scanner USB/Bluetooth du POS Salonkee peut-il lire un code-barres SVG affiché sur un écran de téléphone ? | Si non → l'Export perd sa valeur principale. Fallback : saisie manuelle EAN. |
| **Salonkee permet "set stock"** | Après avoir scanné/trouvé un produit dans Salonkee, peut-on saisir un niveau de stock absolu (ex: "stock = 12") ? Ou seulement "+1 par scan" ? | Si seulement +1 → l'Export devient inutilisable pour les ajustements. Le produit reste un bon inventaire, mais perd son pont vers Salonkee. |

**Tant que ces deux tests ne sont pas validés, tout le reste est conditionnel.**

### Autres risques

- **Apps Script comme backend de production** : quotas 20k/jour, latence ~1s, absence de logs structurés. Tient pour 1-5 salons. Au-delà de 10 clients actifs, il faudra migrer vers un vrai backend.
- **CODE-128 vs EAN-13** : si le scanner USB du salon n'accepte que EAN-13, certains produits avec des codes-barres non-standard seront exclus de l'Export (d'où le toggle EAN-13).
- **Catalogue initial** : le premier inventaire nécessite un catalogue pré-rempli (EAN, nom, marque). Sans export Salonkee, c'est une saisie manuelle ou un premier passage "découverte".

---

## 8. Roadmap V2 (post-pilote, ne pas bloquer le MVP)

| Feature | Priorité | Complexité |
|---------|----------|------------|
| Rôles gérant / employé (flag admin dans token) | Haute | Moyenne |
| Export CSV compatible Salonkee (si format documenté) | Haute | Faible |
| Validation "inventaire terminé" + verrouillage | Moyenne | Faible |
| Produits sans EAN : mode fiche texte | Moyenne | Faible |
| Cache stock offline | Moyenne | Faible |
| Migration backend (Node.js / Cloudflare Workers) | Haute (si >5 clients) | Haute |
| API officielle Salonkee (si partenariat) | Basse | Haute |

---

## 9. Livrables techniques disponibles

| Fichier | Description | Lignes |
|---------|-------------|--------|
| `scanner-inventaire-salon-v2.html` | PWA complète (HTML + CSS + JS, fichier unique) | 1921 |
| `google-apps-script-centralized.js` | Backend Apps Script centralisé | 715 |
| `spec-inventaire-salon.md` | Spécifications techniques complètes v2 | 517 |
| `pricing-stock-assist.md` | Page pricing client | 68 |
| `pitch-stock-assist.md` | Pitch 30s + 10s + script démo 3 min | 70 |
| `guide-deploiement-centralise.md` | Guide déploiement pas à pas | 184 |
| `guide-implementation-pwa.md` | Guide installation PWA | 389 |
| `manifest.json` | Manifest PWA | 26 |
| `sw.js` | Service Worker | 94 |
| `icons/icon-192.png` + `icon-512.png` | Icônes PWA (design custom ciseaux + code-barres) | — |

---

## 10. Synergies potentielles avec d'autres produits PIKT

Stock Assist est le premier produit packagé de PIKT Consulting. Le modèle (service récurrent + stack zéro coût + positionnement "je m'occupe de X pour vous") est réplicable.

**Service en développement** : Automatisation courrier fournisseurs et factures — workflow n8n existant qui gère la collecte (Gmail + Google Drive), l'OCR multilingue (Google Document AI), la classification, l'archivage Drive structuré, et le remplissage Google Sheet. Pricing cible 79-129 €/mois selon volume. Stack : n8n + Google Document AI + Google Drive + Google Sheets.

**Points de synergie possibles** :
- Même cible client (PME luxembourgeoises, salons, commerces)
- Même modèle commercial (abonnement mensuel, setup done-for-you, support PIKT)
- Même infrastructure (Coolify, Google Workspace, n8n)
- Bundle possible à terme (Stock Assist + Factures Auto → offre combinée)
- Argument commun : "PIKT s'occupe de vos tâches administratives récurrentes"

---

## 11. Résumé décisionnel

| Dimension | Décision | Justification |
|-----------|----------|---------------|
| Positionnement | "Fiabilisation stock, pas remplacement Salonkee" | Évite friction avec Salonkee, catégorie "petit outil utile" |
| Pricing | 39 €/mois, 29 € pilote 3 mois | Sweet spot crédibilité/friction, zone "pas besoin de réfléchir" |
| Architecture | Apps Script centralisé PIKT | Lock-in technique, coût zéro, données client portables |
| Backend | Google Apps Script | MVP suffisant, migration V2 si > 5 clients |
| Frontend | PWA fichier unique | Zéro dépendance, offline, installable, pas d'app store |
| Sécurité | PIN hashé SHA-256, esc() XSS, POST only | Niveau suffisant pour données non-sensibles (stock salon) |
| Export | Fiches scannables + instructions opérateur | Différenciateur produit, pont inventaire → POS |
| Palette couleurs | Colorblind-safe (bleu/orange/violet) + symboles | Accessibilité, fiabilité visuelle |
| Plans tarifaires | Un seul plan, un seul prix | Simplicité, pas de friction inutile |
| Premier pilote | Salon Walferdange, 9 employés | Terrain connu, volume suffisant pour valider |
| Tests bloquants | Scanner USB + "set stock" Salonkee | 5 minutes chacun, conditionnent tout le reste |

# Stock Assist for Salonkee — Spécifications complètes v2

> **Outil d'inventaire physique assisté pour salons sous Salonkee.**
> Scannez vos produits, comptez à plusieurs, retrouvez les écarts,
> et ressaisissez dans Salonkee sans erreur. Fonctionne hors-ligne, prêt en 5 minutes.

---

## 1. Architecture

Le scanner fonctionne en mode **centralisé** : un seul Apps Script déployé sous le compte PIKT Consulting dessert tous les clients. Chaque client a son propre Google Sheet (ses données), mais le moteur est contrôlé par PIKT.

```
COMPTE PIKT CONSULTING
├── Registre Licences (Sheet privé)
│     Client | Code Salon | Hash PIN | Sheet ID | Expire | Actif
│     Salon Walferdange | WALF  | 8d969ee... | 1BxC...kQ4 | 2026-12-31 | OUI
│     Salon Bonnevoie   | BONNE | a665a45... | 1Fy2...mR8 | 2026-06-30 | OUI
│
├── Apps Script centralisé (unique, sert tous les clients)
│     1. Reçoit code salon + PIN
│     2. Cherche dans le Registre par code salon
│     3. Hash le PIN reçu → compare avec le hash stocké
│     4. Vérifie Actif + date expiration
│     5. Si OK → ouvre le Sheet du client et exécute l'action
│     6. Si NON → "Licence expirée, contactez PIKT Consulting"
│
├── Coolify (PWA statique — scan.piktconsulting.lu)
└── Dossier Drive "Photos Inventaire"

COMPTE DU CLIENT
└── Google Sheet partagé en Éditeur (ses données, qu'il peut exporter librement)
```

Le client possède ses données (éthique + légal). Le moteur est chez PIKT. Désactivation = changer une cellule dans le Registre.

### Registre Licences (chez PIKT — non accessible au client)

| Colonne | Contenu | Exemple |
|---------|---------|---------|
| A — Client | Nom du salon | Salon Walferdange |
| B — Code Salon | Identifiant public (majuscules) | BELLA |
| C — Hash PIN | SHA-256 du PIN (jamais le PIN en clair) | 8d969eef6ecad... |
| D — Sheet ID | ID du Google Sheet client | 1BxC...kQ4 |
| E — Expire | Date d'expiration licence | 31/12/2026 |
| F — Actif | OUI ou NON | OUI |
| G — Contact | Email/tel du gérant | +352 xxx |
| H — Notes | Libre | Setup mars 2025 |

> **Sécurité** : le PIN n'est jamais stocké en clair. Utiliser la fonction `generatePinHash()` dans l'éditeur Apps Script pour obtenir le hash à coller dans la colonne C.

---

## 2. Google Sheet client — Structure des onglets

### Onglet "Catalogue"

| Colonne | Contenu | Exemple |
|---------|---------|---------|
| A — EAN | Code-barres du produit (EAN-13, EAN-8, UPC) | 3474636391028 |
| B — Produit | Nom complet du produit | Shampoing Bain Satin 1 250ml |
| C — Marque | Fabricant / marque | Kérastase |
| D — Catégorie | Type de produit | Shampoing |
| E — Prix Achat | Prix d'achat HT fournisseur | 14.20 |
| F — Prix Vente | Prix de vente TTC en salon | 28.50 |
| G — Photo | URL Google Drive (thumbnail public) | https://drive.google.com/thumbnail?id=xxx&sz=w400 |
| H — Stock Théorique | Quantité attendue en stock | 5 |
| I — Type | V (Vente), C (Consommable), CV (Les deux) | V |

> **Colonne Type** : V = produits vendus aux clients, C = consommables internes (coloration, oxydant, papier alu…), CV = produits mixtes (shampoing technique utilisé au bac et vendu). Si vide → traité comme CV par défaut.

### Onglet "Inventaire"

| Colonne | Contenu | Exemple |
|---------|---------|---------|
| A — EAN | Code-barres scanné | 3474636391028 |
| B — Produit | Nom (auto depuis catalogue, ou "INCONNU") | Shampoing Bain Satin 1 250ml |
| C — Marque | Marque (auto depuis catalogue) | Kérastase |
| D — Quantité | Nombre scanné (+N = ajout, -N = annulation) | 2 |
| E — Zone | Emplacement physique au moment du scan | Vitrine |
| F — État | F = Fermé (neuf), O = Ouvert (entamé) | F |
| G — Scanné par | Prénom de l'employé | Marie |
| H — Date/Heure | Horodatage serveur (dd/MM/yyyy HH:mm:ss) | 07/02/2026 14:32:18 |
| I — Date | Date seule (dd/MM/yyyy) | 07/02/2026 |

> **Annulations** : une ligne avec quantité négative et "[ANNULÉ]" ajouté au nom produit. L'inventaire réel = somme algébrique des quantités par EAN.

### Onglet "Zones"

| Colonne | Contenu | Exemple |
|---------|---------|---------|
| A — Nom | Nom de la zone | Vitrine |
| B — Emoji | Emoji affiché dans l'app | 🪟 |

> Si cet onglet n'existe pas, 5 zones par défaut : Vitrine 🪟, Réserve 📦, Coiffure 💇, Manucure 💅, Accueil 🛋️.

### Onglet "Synthèse" (généré automatiquement)

| Section | Contenu |
|---------|---------|
| 📊 Synthèse par produit | EAN, Produit, Marque, Catégorie, Type, Achat €, Vente €, Théorique, Fermés, Ouverts, Total, Écart, Coût Stock €, Valeur Vente €, Perte Sèche € |
| 📍 Répartition par zone | Zone, Produits uniques, Quantité totale, Valeur €, % du stock |
| 👤 Activité par personne | Nom, Produits scannés, % du total |
| ⚠️ Alertes écarts | Produits avec écart ≠ 0 + Perte Sèche €, triés du pire au meilleur |
| ℹ️ Informations | Date, coût stock, valeur vente, marge brute, perte sèche, ventilation par type |

> Déclenchement : POST `{ action: "genererSynthese", token: "CODE:PIN" }`.

---

## 3. Fonctionnalités

### 3.1 Authentification (Code salon + PIN hashé)

- **Code salon** : identifiant public (ex: `BELLA`), pré-rempli après première connexion
- **PIN** : secret numérique, hashé en SHA-256 côté serveur, jamais stocké en clair
- Token format `CODE:PIN` dans le body de chaque requête POST (jamais en URL)
- Réponses JSON lisibles (pas de `no-cors`) — détection licence expirée, PIN incorrect, erreurs serveur
- Code salon persisté en localStorage (confort), PIN **jamais** (re-saisie à chaque session)
- Requête `ping` pour validation initiale
- Erreurs distinctes : "Code salon inconnu" / "PIN incorrect" / "Licence expirée"

### 3.2 Scan code-barres

- Caméra arrière via html5-qrcode (CDN)
- Formats : EAN-13, EAN-8, UPC-A, UPC-E, CODE-128, CODE-39
- Anti-doublon : même code ignoré pendant 800ms (debounce)
- Freeze caméra : image figée 500ms après chaque scan (confirmation visuelle)
- Saisie manuelle EAN en fallback (champ texte + touche Entrée)

### 3.3 Feedback multi-sensoriel

- **Bip sonore** : montant 880→1320 Hz (connu), descendant 440→330 Hz (inconnu), doux 660→440 Hz (annulation). Web Audio API, zéro fichier.
- **Flash visuel** : bordure + fond vert (connu) ou ambre (inconnu), 0.6s
- **Vibration** : simple 80ms (connu), double 80-50-80ms (inconnu), double courte 40-30-40ms (annulation)
- **Banner flottant** : nom du produit en overlay sur la caméra pendant 1.8s

### 3.4 Gestion des zones

- Chargées dynamiquement depuis l'onglet "Zones" du Sheet
- Pills horizontales scrollables sous le scanner
- Zone par défaut au login, modifiable en un tap
- Enregistrée avec chaque scan

### 3.5 Quantités + État Ouvert/Fermé

- Boutons +/− (min 1, max 99), défaut 1, remis à 1 après chaque scan
- Toggle **Fermé** (défaut, vert) / **Ouvert** (ambre) — retour à Fermé après chaque scan
- Fermé = produit neuf vendable, Ouvert = entamé en cours d'utilisation
- Badge "OUVERT" dans l'historique, colonnes séparées dans la synthèse

### 3.6 Produit inconnu + Photo

- Si EAN absent du catalogue : modal bottom-sheet après 0.7s
- Champs : EAN (readonly), Nom, Marque, Prix achat/vente (optionnels, côte à côte), Type (pills V/C/CV)
- Photo optionnelle : capture frame du flux vidéo, JPEG 70% 640px max, uploadée vers Google Drive
- "Ajouter au catalogue" → écrit dans le Sheet + cache local
- "Ignorer" → scan enregistré comme INCONNU

### 3.7 Annulation de scan (Undo)

- Bouton ↩ sur chaque carte historique
- Ligne avec quantité négative + "[ANNULÉ]" dans le Sheet
- Carte grisée/barrée, stats recalculées, bip descendant + vibration

### 3.8 Mode hors-ligne

- File d'attente localStorage, envoi automatique au retour réseau
- Indicateur "⚡ Hors-ligne" visible, file persistante entre sessions

### 3.9 Statistiques temps réel

- 3 compteurs : Scans (rose), Produits uniques (vert), Inconnus (ambre)
- Mis à jour instantanément à chaque scan et annulation

### 3.10 Historique local

- 60 derniers scans, cartes avec quantité, nom+marque, EAN, zone, heure, bouton annuler
- Badge "OUVERT" ambre, animation slide-in, cartes annulées grisées

### 3.11 Écran Stock (consultation inventaire)

- Onglet "📦 Stock", données servies via API (pas besoin d'accès au Sheet)
- Sélecteur de date **obligatoire** (dates réelles d'inventaire)
- Filtres : recherche texte, pills zone, catégorie, marque, type
- Bandeau résumé : nombre de produits, fermés, ouverts, coût stock, valeur vente, perte sèche
- Liste agrégée triée par écart croissant (pires manques en premier)
- Indicateur "▼ X de moins · perte X€" (rouge) / "▲ X de plus que prévu" (vert)

### 3.12 Écran Export Salonkee (passerelle vers POS)

**Objectif** : transformer un inventaire compté en fiches scannables pour mise à jour manuelle du stock dans Salonkee (ou tout POS fermé sans API d'import).

**Workflow opérationnel** :
1. Le gérant ouvre Salonkee sur le PC du salon en mode ajustement stock
2. Il ouvre l'onglet Export sur son téléphone
3. Chaque fiche affiche le code-barres + le stock compté + l'instruction exacte
4. Le scanner USB/Bluetooth du POS lit le barcode depuis l'écran du téléphone
5. Le gérant saisit la quantité indiquée dans Salonkee
6. Fiche suivante → répéter

**Composants de l'écran** :

- **Sélecteur de date** : même mécanisme que Stock (dates réelles triées décroissant)
- **Toggle "EAN-13 uniquement"** : checkbox — filtre côté client sans re-fetch. Si actif, seuls les EAN à 13 chiffres sont exportés. Compteur orange "X produits ignorés (EAN ≠ 13)" visible quand des produits sont exclus.
- **Compteur position** : "3 / 47" en haut de l'écran + badge "12 / 132" en haut à droite de la carte
- **Indicateur cache** : "⚡ cache" si données issues du cache hors-ligne

**Fiche produit (carte blanche)** :

- **Code-barres SVG** (JsBarcode) — haute résolution, fond blanc, barres noires, quiet zones. Format auto : EAN-13 si 13 chiffres, EAN-8 si 8, CODE128 sinon. Fallback texte si EAN invalide pour le format.
- **Badge page** : "12 / 132" en haut à droite de la carte
- **Nom produit** + marque, catégorie, badge type (V/C/CV)
- **Deux métriques principales** (cadres colorés, gros chiffres) :
  - **Stock compté** (bleu `#4A90D9`) — total inventorié physiquement
  - **Écart vs catalogue** — calcul `compté − théorique`, 4 états :
    - **▲ +N · À ajouter** (orange `#D9853A`) — surplus vs catalogue
    - **▼ −N · À retirer** (violet `#8B6FC0`) — manque vs catalogue
    - **= 0 · Stock conforme** (gris neutre) — aligné
    - **Pas de réf. · Catalogue** (gris) — pas de stock théorique renseigné
- **Ligne de détail** : "12 fermés · 3 ouverts · théorique : 10"
- **Instruction opérateur** (bandeau gris clair) :
  - "👉 Dans Salonkee, augmenter le stock à 37"
  - "👉 Dans Salonkee, diminuer le stock à 12"
  - "✅ Rien à modifier dans Salonkee"
  - "⚙️ Vérifier le stock théorique dans le catalogue"

**Palette colorblind-safe** : bleu (#4A90D9) / orange (#D9853A) / violet (#8B6FC0) distinguables en protanopie, deutéranopie, tritanopie, renforcés par symboles ▲/▼/=.

**Détection stock théorique** : `theorique === 0` est une vraie référence (delta = compté − 0). Seuls `undefined`/`null`/`''`/`NaN` déclenchent "Pas de réf.".

**Navigation** :
- Boutons "◀ Précédent" / "Suivant ▶" (pill shape, touch targets 52px)
- Swipe gauche/droite sur la fiche (seuil 50px)
- Défilement auto optionnel "⏩ Défilement auto (5s)" / "⏸ Arrêter le défilement" — s'arrête au dernier, OFF par défaut

**Cache hors-ligne borné** :
- Clé : `exportCache:v1:dd/MM/yyyy`
- Stocké après chaque fetch réussi
- Fallback automatique en cas d'erreur réseau
- Purge : snapshot des clés avant suppression (pas d'itération pendant removeItem), garde les 10 dates les plus récentes, supprime les clés de versions antérieures
- Indicateur "⚡ cache" dans le compteur si données issues du cache

**Filtrage** : stock > 0 ET EAN valide (≥ 8 chiffres), tri alphabétique produit. Toggle EAN-13 appliqué côté client sans re-fetch (conserve `exportAllStock` en mémoire).

**Conseil UX** : luminosité écran au maximum, téléphone à 5-10cm du scanner USB.

### 3.13 Navigation par onglets

- Barre fixe en bas : 📷 Scanner (défaut) | 📦 Stock | 📤 Export | ⚙️ Config
- Scanner se met en pause quand on quitte l'onglet, reprend quand on revient
- Auto-advance Export s'arrête quand on quitte l'onglet

### 3.14 Persistance locale (localStorage)

- Prénom utilisateur, zone par défaut, file d'attente hors-ligne, code salon
- PIN **jamais** persisté
- Cache export borné (max 10 dates, versionné)

---

## 4. Sécurité

### 4.1 Transport & authentification

| Mesure | Détail |
|--------|--------|
| Token en body POST | Jamais en URL/query string |
| PIN hashé SHA-256 | Jamais stocké en clair dans le Registre |
| PIN non persisté côté client | Re-saisie à chaque session |
| HTTPS obligatoire | Let's Encrypt via Coolify, requis pour caméra + transit PIN |
| Réponses JSON lisibles | Pas de `no-cors`, erreurs détectables |

### 4.2 Protection XSS (innerHTML)

Toute donnée serveur ou utilisateur injectée dans `innerHTML` est échappée via la fonction `esc()` :

```javascript
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
```

**Surfaces protégées** (20 usages `esc()`) :

| Zone | Champs échappés | Technique complémentaire |
|------|----------------|--------------------------|
| Historique scans | produit, marque, ean, zone, time | `parseInt()` sur quantite, id |
| Zone pills (scanner) | z.nom, z.emoji | `data-z` attribute + `this.dataset.z` |
| Stock zone pills | z.nom, z.emoji | `data-z` attribute |
| Stock catégorie pills | cat | `data-v` attribute |
| Stock marque pills | m | `data-v` attribute (remplace l'ancien `.replace(/'/g, "\\'")`) |
| Stock type pills | t | whitelist `['V','C','CV']` + `esc()` fallback |
| Stock list | produit, marque, ean, categorie, type | `parseInt()` sur quantités, `(perteSèche\|\|0)` null-safe, whitelist type |
| Stock erreurs | err.message | `esc()` |
| Export fiches | produit, marque, categorie, type, ean | `parseInt()` sur quantités, whitelist type |
| Export erreurs | err.message | `esc()` |

**Pattern systématique** : valeurs texte → `esc()`, onclick dynamiques → `data-*` attributes (HTML auto-unescape), nombres → `parseInt()`, types → whitelist.

**Seul innerHTML non échappé** : `preview.innerHTML = <img src="${dataUrl}">` — `dataUrl` vient de `canvas.toDataURL()`, toujours `data:image/jpeg;base64,...`, safe par construction.

### 4.3 Lock-in

| Mesure | Détail |
|--------|--------|
| Apps Script centralisé | Tourne sous le compte PIKT — invisible au client |
| Registre Licences | Table code→Sheet ID chez PIKT |
| Expiration licence | Date vérifiée à chaque requête |
| Données portables | Le client garde propriété et accès total à son Sheet |
| Photos en lecture seule | Drive thumbnails, pas d'écriture |
| Pas de compte Google requis | Les employés n'ont aucun accès direct |

Pour bypasser : comprendre l'architecture, recréer un Apps Script, recoder les endpoints, reconfigurer le déploiement. Autant payer la licence.

---

## 5. Process & UX — Flux complet

### 5.1 Mise en place (une seule fois, par PIKT)

1. Créer le Sheet "PIKT — Registre Licences"
2. Apps Script → coller `google-apps-script-centralized.js` → Déployer en Web App
3. Autoriser permissions (Sheets + Drive)
4. Copier l'URL → modifier `API_URL` dans le HTML
5. Héberger la PWA sur Coolify (scan.piktconsulting.lu)

### 5.2 Ajout d'un nouveau client

1. Créer un Sheet client avec 3 onglets (Catalogue, Inventaire, Zones)
2. Remplir en-têtes + Zones + catalogue
3. Partager le Sheet avec le compte PIKT en Éditeur
4. Copier le Sheet ID, choisir code salon + PIN
5. `generatePinHash()` → hash dans le Registre
6. Communiquer au client : lien scanner + code + PIN

### 5.3 Jour de l'inventaire

```
┌─ LOGIN ──────────────────────────────────────┐
│  Code salon (BELLA) + PIN (••••••)           │
│  → [Se connecter] → validation + zones       │
│  Prénom + zone de départ                     │
│  → [Lancer le scanner 📷] → catalogue        │
└──────────────────┬───────────────────────────┘
                   ▼
┌─ SCANNER ────────────────────────────────────┐
│  Stats: 12 Scans │ 8 Produits │ 2 Inconnus   │
│  [Caméra + flash + banner]                   │
│  Qté [−] 1 [+]  [○ Fermé]  🪟 📦 💇 💅 🛋️   │
│  Saisie manuelle [______________] [OK]       │
│  Historique: [2] Shampoing 14:32 ↩           │
└──────────────────┬───────────────────────────┘
                   ▼
┌─ STOCK ──────────────────────────────────────┐
│  Date obligatoire + filtres zone/cat/marque  │
│  Résumé: 47 refs, 12 fermés, 3 ouverts      │
│  Liste: écarts triés du pire au meilleur     │
└──────────────────┬───────────────────────────┘
                   ▼
┌─ EXPORT SALONKEE ────────────────────────────┐
│  Date + ☐ EAN-13 only + "4 ignorés (EAN≠13)"│
│  ┌─ Carte blanche ──────────────────────┐    │
│  │  12 / 132            [barcode SVG]   │    │
│  │  Shampoing Bain Satin · Kérastase    │    │
│  │  ┌──────────┐  ┌──────────┐          │    │
│  │  │    12    │  │   ▲ +2   │          │    │
│  │  │Stock cmpt│  │ À ajouter│          │    │
│  │  └──────────┘  └──────────┘          │    │
│  │  10 fermés · 2 ouverts · théo: 10    │    │
│  │  👉 Dans Salonkee, augmenter à 12    │    │
│  └──────────────────────────────────────┘    │
│  [◀ Précédent]  [Suivant ▶]                  │
│  [⏩ Défilement auto (5s)]                   │
└──────────────────────────────────────────────┘
```

---

## 6. Pricing

### Positionnement

> "On ne remplace pas Salonkee. On vous aide à ne plus vous tromper quand vous mettez à jour votre stock."

**Stock Assist for Salonkee** n'est pas une intégration, une synchronisation, ni une automatisation complète. C'est un outil de fiabilisation : inventaire physique + réduction d'erreurs de ressaisie.

### Offre unique

| | Stock Assist |
|---|---|
| **Prix** | **39 € / mois HT** |
| Inventaires | Illimités |
| Employés simultanés | Illimités |
| Export Salonkee | Inclus |
| Mode hors-ligne | Inclus |
| Synthèse écarts | Inclus |
| Photos produits | Inclus |
| Support | Email PIKT |
| Engagement | Aucun — annulation libre |

### Tarif pilote

29 € / mois HT pendant les 3 premiers mois (early adopter), puis passage automatique à 39 €.

### Justification

- 39 € < une heure de travail
- 39 € < une erreur de stock mensuelle
- 39 € < un produit perdu par mois
- ROI évident : 9 employés × 2-3h gagnées × erreurs évitées = amortissement immédiat
- Rythme inventaire : mensuel (12/an minimum)
- Reste en "petite ligne SaaS", pas en décision stratégique

---

## 7. Commercial

### Pitch 30 secondes (verbal, au comptoir)

> "Aujourd'hui, votre inventaire c'est du papier, des erreurs, et 3 heures à tout retaper dans Salonkee."
>
> "Là, chaque employé scanne avec son téléphone, chacun dans sa zone. Tout se consolide automatiquement. À la fin, vous ouvrez l'export : chaque produit avec le code-barres, le stock compté, et ce qu'il faut modifier dans Salonkee. Même sans wifi."
>
> "39 euros par mois. Pas d'engagement. On essaie sur un inventaire et vous décidez."

### Script démo 3 minutes

**0:00–0:30 · Le problème** : "Aujourd'hui vous comptez sur papier ou dans votre tête, puis vous retapez dans Salonkee. Erreurs, oublis, produits en double. Et impossible de faire compter plusieurs personnes en même temps."

**0:30–1:00 · Login + scan** : Ouvrir la PWA. Code salon + PIN. Choisir zone Vitrine. Scanner un produit connu → bip vert, carte instantanée. Scanner un inconnu → modal, nommer, photo, ajouté au catalogue.

**1:00–1:30 · Multi-poste + hors-ligne** : "Pendant que vous scannez la vitrine, votre collègue fait la réserve. Si le wifi tombe, les scans sont en file d'attente." Montrer le badge ⚡ hors-ligne.

**1:30–2:15 · Stock + écarts** : Onglet Stock. Sélectionner la date. "47 références, coût stock, valeur vente, et surtout les écarts — les manques en haut, avec la perte en euros."

**2:15–2:50 · Export Salonkee** : Onglet Export. "Chaque fiche : le code-barres scannable, le stock compté, et l'instruction exacte : dans Salonkee, mettre le stock à 12. Vous passez les fiches une par une." Toggle EAN-13, badge 12/47, instruction opérateur.

**2:50–3:00 · Close** : "Un inventaire fiable, à plusieurs, sans papier, avec un export prêt pour Salonkee. 39€ par mois, sans engagement."

---

## 8. Checklist pilote

| # | Item | Statut | Critique |
|---|------|--------|----------|
| 1 | Apps Script déployé (scan, getStockView, ajouterProduit, getZones, ping, uploadPhoto) | À vérifier | |
| 2 | Sheet structuré (Scans, Catalogue avec Type/Prix/Photo/Théorique, Synthèse, Zones, Registre) | À vérifier | |
| 3 | Licence pilote créée (code salon + PIN hashé, date expiration, statut actif) | À créer | |
| 4 | PWA déployée (HTML + manifest.json + sw.js + icônes) sur Coolify | À déployer | |
| 5 | API_URL dans le HTML pointant vers le déploiement Apps Script | À configurer | |
| 6 | Zones configurées pour le salon (valider avec le gérant) | À valider | |
| 7 | Catalogue pré-rempli (import depuis Salonkee ou saisie manuelle initiale) | À évaluer | |
| 8 | Stock théorique renseigné (colonne H) pour que l'écart export fonctionne | À évaluer | |
| 9 | **Test scanner USB/Bluetooth Salonkee avec fiche Export** | À tester | **⚠️ CRITIQUE** |
| 10 | **Valider workflow Salonkee : set stock vs +1 après scan** | À tester | **⚠️ CRITIQUE** |
| 11 | Luminosité écran + distance 5-10cm testée sur le matériel du salon | À tester | |
| 12 | Compte démo prêt (credentials pilote, 5-10 produits, 1 inventaire fictif) | À créer | |

> Les points 9 et 10 sont les deux seuls bloquants réels. Si le scanner USB lit le barcode à l'écran et que Salonkee permet de modifier un niveau de stock après scan, c'est go.

---

## 9. Stack technique

| Composant | Technologie | Propriétaire | Coût |
|-----------|------------|-------------|------|
| Frontend | HTML5 + CSS + JS, police Outfit | PIKT | 0€ |
| Scanner | html5-qrcode 2.3.8 (CDN) | Open source | 0€ |
| Barcodes | JsBarcode 3.11.6 (CDN) | Open source | 0€ |
| Audio | Web Audio API | Navigateur | 0€ |
| Backend | Google Apps Script centralisé | PIKT | 0€ |
| Registre Licences | Google Sheet (chez PIKT) | PIKT | 0€ |
| Données client | Google Sheet (chez le client) | Client | 0€ |
| Stockage photos | Google Drive (chez PIKT) | PIKT | 0€ |
| Hébergement | Coolify (scan.piktconsulting.lu) | PIKT | ~0€ |
| **Total** | | | **0€** |

---

## 10. Livrables techniques

| Fichier | Rôle |
|---------|------|
| `scanner-inventaire-salon-v2.html` | PWA complète (HTML + CSS + JS en fichier unique) |
| `google-apps-script-centralized.js` | Backend Apps Script centralisé (tous les endpoints) |
| `manifest.json` | Manifest PWA (nom, icônes, thème, display standalone) |
| `sw.js` | Service Worker (cache statique + offline shell) |
| `icons/` | Icônes PWA 192px + 512px (ciseaux + code-barres) |
| `spec-inventaire-salon.md` | Ce document |
| `guide-deploiement-centralise.md` | Guide de déploiement pas à pas |
| `guide-implementation-pwa.md` | Guide d'installation PWA (manifest, SW, icônes) |

---

## 11. Limitations connues

- Pas de login individuel par employé (code salon + PIN partagé, prénom déclaratif)
- Pas de synchronisation temps réel entre téléphones (historique local par session)
- Catalogue chargé une fois au login (produit ajouté par un autre téléphone → invisible jusqu'au prochain login)
- Google Apps Script : 20 000 requêtes/jour, ~1s par exécution (suffisant pour 9 personnes × 1h)
- Photos en base64 dans le POST (suffisant pour JPEG 640px)
- Synthèse générée manuellement depuis le Registre (pas automatique après chaque inventaire)
- Multi-client : tous les clients partagent le même quota Apps Script du compte PIKT

---

## 12. Roadmap V2 (post-pilote)

| Feature | Priorité | Complexité |
|---------|----------|------------|
| Rôles gérant / employé (flag admin dans token) | Haute | Moyenne |
| Export CSV compatible Salonkee (si format documenté) | Haute | Faible |
| Validation "inventaire terminé" + verrouillage | Moyenne | Faible |
| Produits sans EAN : mode fiche texte pour recherche manuelle | Moyenne | Faible |
| Cache stock offline (même pattern que export) | Moyenne | Faible |
| OurAirports data sync (aéroports, pays — pour FlightPawr) | Hors scope | — |
| API officielle Salonkee (si partenariat) | Basse | Haute |

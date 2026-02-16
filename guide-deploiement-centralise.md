# Déploiement centralisé — Guide pas à pas

## Vue d'ensemble

```
COMPTE PIKT CONSULTING (pikt.consulting@gmail.com)
├── Google Sheet "Registre Licences"          ← privé, non partagé
├── Google Apps Script (déployé une seule fois) ← invisible au client
├── Dossier Drive "Photos Inventaire"         ← créé automatiquement
│
├── Google Sheet "Salon Walferdange"          ← partagé avec le client (Éditeur)
├── Google Sheet "Salon Bonnevoie"            ← partagé avec le client
└── Google Sheet "Salon Esch"                 ← partagé avec le client

COOLIFY (scan.piktconsulting.lu)
└── PWA statique (index.html + manifest.json + sw.js + icons/)
```

Le client possède ses données. Le moteur est chez PIKT. Désactivation = changer une cellule.

---

## Étape 1 — Créer le Registre Licences (une seule fois)

1. Aller sur [Google Sheets](https://sheets.google.com) avec le compte PIKT
2. Créer un nouveau classeur : **"Registre Licences — Inventaire"**
3. En-têtes en ligne 1 :

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| Client | Code Salon | Hash PIN | Sheet ID | Expire | Actif | Contact | Notes |

4. Copier l'ID du Sheet (dans l'URL : `https://docs.google.com/spreadsheets/d/`**`CE_BOUT_ICI`**`/edit`)
5. Ce Sheet reste **privé** — ne le partager avec personne

---

## Étape 2 — Déployer le script (une seule fois)

1. Aller sur [Google Apps Script](https://script.google.com) avec le compte PIKT
2. Créer un nouveau projet : **"Scanner Inventaire — Central"**
3. Supprimer le code par défaut, coller le contenu de `google-apps-script-centralized.js`
4. Remplacer `COLLER_ID_DU_REGISTRE_ICI` par l'ID copié à l'étape 1
5. **Sauvegarder** (Ctrl+S)
6. **Déployer** > Nouveau déploiement :
   - Type : Application Web
   - Exécuter en tant que : **Moi** ← CRUCIAL (lock-in)
   - Accès : **Tout le monde**
7. Google demandera d'autoriser l'accès (Sheets + Drive) → accepter
8. **Copier l'URL de déploiement** — URL UNIQUE pour tous les clients

> ⚠️ Pour mettre à jour le code sans changer l'URL :
> "Gérer les déploiements" → sélectionner le déploiement → "Modifier" → Version: "Nouveau script".

---

## Étape 3 — Configurer le HTML (une seule fois)

1. Ouvrir `index.html` (renommer `scanner-inventaire-salon-v2.html`)
2. Remplacer l'URL en dur :
   ```javascript
   const API_URL = 'https://script.google.com/macros/s/VOTRE_URL_DE_DEPLOIEMENT/exec';
   ```
3. Héberger sur Coolify (voir `guide-implementation-pwa.md`)

---

## Étape 4 — Onboarder un nouveau client

### 4a. Créer le Sheet client

1. Créer un nouveau Google Sheet : **"Inventaire — Salon Walferdange"**
2. Créer 3 onglets avec en-têtes :

**Onglet "Catalogue"** (ligne 1) :

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| EAN | Produit | Marque | Catégorie | Prix Achat | Prix Vente | Photo | Stock Théorique | Type |

> **Colonne I (Type)** : `V` = Vente, `C` = Consommable, `CV` = Les deux. Si vide → traité comme CV.

**Onglet "Inventaire"** (ligne 1) :

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| EAN | Produit | Marque | Quantité | Zone | État | Scanné par | Date/Heure | Date |

**Onglet "Zones"** (ligne 1 + données adaptées au salon) :

| A | B |
|---|---|
| Nom | Emoji |
| Vitrine | 🪟 |
| Réserve | 📦 |
| Poste Coiffure | 💇 |
| Poste Manucure | 💅 |
| Accueil | 🛋️ |

3. Pré-remplir le catalogue (EAN, noms, marques, catégories, prix, type)
4. Remplir le stock théorique (colonne H) — nécessaire pour que l'écart export fonctionne
5. Adapter les zones à l'agencement physique du salon
6. **Partager le Sheet avec le client en Éditeur** (il voit et exporte ses données)

### 4b. Choisir un Code Salon + PIN

- **Code Salon** : court, mémorable, majuscules (ex: `WALF`, `BELLA`, `BONNE`)
- **PIN** : numérique, 4-8 chiffres (ex: `847291`)

Générer le hash du PIN :
1. Ouvrir l'éditeur Apps Script
2. Modifier `pin` dans `generatePinHash()` avec le PIN choisi
3. Exécuter `generatePinHash()`
4. Copier le hash depuis les logs (Affichage → Journaux d'exécution)

### 4c. Ajouter au Registre Licences

| Client | Code Salon | Hash PIN | Sheet ID | Expire | Actif | Contact | Notes |
|--------|-----------|----------|----------|--------|-------|---------|-------|
| Salon Walferdange | WALF | 8d969eef... | 1BxC...kQ4 | 2026-12-31 | OUI | +352 xxx | Setup fév 2026, 30€/mois |

> Ne JAMAIS mettre le PIN en clair dans le Registre.

### 4d. Communiquer au client

```
Bonjour,

Votre scanner d'inventaire est prêt.

📱 Lien : https://scan.piktconsulting.lu
🏪 Code salon : WALF
🔒 PIN : 847291

Pour installer l'app sur votre téléphone :
1. Ouvrez le lien dans Chrome (Android) ou Safari (iPhone)
2. Tapez "Ajouter à l'écran d'accueil"
3. L'app apparaît comme une icône sur votre écran

Le jour de l'inventaire :
1. Ouvrez l'app
2. Entrez le code salon et le PIN
3. Choisissez votre prénom et votre zone
4. Scannez !

Le même code et PIN fonctionnent pour toute votre équipe.
Le code salon sera mémorisé, seul le PIN sera à re-saisir.
```

---

## Gestion courante

### Désactiver un client

Registre Licences → colonne **Actif** de `OUI` à `NON`. Effet immédiat.

### Renouveler une licence

Changer la date dans **Expire**. C'est tout.

### Changer le PIN d'un client

1. Choisir un nouveau PIN → `generatePinHash()` → copier le hash
2. Remplacer dans la colonne C du Registre
3. Communiquer le nouveau PIN au gérant — effet immédiat

### Générer la synthèse

```bash
curl -L -X POST 'URL_SCRIPT' \
  -H 'Content-Type: application/json' \
  -d '{"action":"genererSynthese","token":"WALF:847291"}'
```

### Mettre à jour le code

1. Modifier le code dans Apps Script
2. Gérer les déploiements → Modifier → Version: "Nouveau script" (garde la même URL)
3. Modifier le HTML si besoin → redéployer sur Coolify
4. Incrémenter `CACHE_NAME` dans `sw.js` pour forcer la mise à jour PWA

---

## Checklist premier inventaire accompagné

```
□ Google Sheet client créé avec 3 onglets + en-têtes (incl. colonne Type)
□ Catalogue importé (EAN, noms, marques, catégories, prix achat, prix vente, type)
□ Stock théorique rempli (colonne H — nécessaire pour l'écart export)
□ Zones configurées (adaptées au salon physique)
□ Ligne ajoutée au Registre Licences (code + hash PIN + Sheet ID + expire + OUI)
□ Test connexion : ouvrir l'app → code salon + PIN → ✅
□ Test scan connu → bip vert
□ Test scan inconnu → modal + ajout catalogue
□ Test export → sélectionner date → vérifier barcode + métriques + instruction
□ ⚠️ CRITIQUE : Test scanner USB Salonkee (barcode lu depuis l'écran téléphone)
□ ⚠️ CRITIQUE : Test workflow Salonkee (set stock vs +1 après scan)
□ Former le gérant + l'équipe
□ Lancer le premier inventaire complet
□ Générer la synthèse + présenter les résultats
```

---

## Troubleshooting

| Problème | Solution |
|----------|---------|
| App ne s'installe pas (iPhone) | Safari → Partager (↑) → Sur l'écran d'accueil |
| Caméra ne se lance pas | Vérifier HTTPS + permission caméra. iOS = Safari uniquement en PWA |
| Serveur injoignable | Vérifier API_URL, déploiement "Tout le monde", Actif = OUI |
| PIN incorrect | Relancer `generatePinHash()` et comparer les hashes |
| Scanner USB ne lit pas le barcode | Luminosité max, 5-10cm, fond blanc confirmé |
| Export : "Pas de réf." partout | Stock théorique non renseigné (colonne H catalogue) |
| Export : produits manquants | Toggle EAN-13 actif, ou stock = 0, ou EAN < 8 chiffres |
| Produit scanné non trouvé | Catalogue chargé au login — relancer l'app après ajout |
| Service worker ne se met pas à jour | Incrémenter CACHE_NAME dans sw.js |

---

## Coûts de fonctionnement

| Poste | Coût |
|-------|------|
| Hébergement Coolify | ~0€ (infra existante) |
| Google Sheet + Apps Script | 0€ |
| CDN (html5-qrcode, JsBarcode, Outfit) | 0€ |
| **Total infrastructure** | **~0€/mois** |

Les 30€ HT/mois par client sont de la marge pure après le setup initial (~1h par nouveau client).

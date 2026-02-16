# Inventaire Salon — Guide d'implémentation & déploiement PWA

## Vue d'ensemble

L'application est une **PWA** (Progressive Web App) : un site web qui s'installe comme une app native sur téléphone. Pas d'App Store, pas de validation Apple/Google, mise à jour instantanée côté serveur.

### Fichiers livrés

```
inventaire-salon/
├── index.html          ← L'application (renommer scanner-inventaire-salon-v2.html)
├── manifest.json       ← Metadata PWA (nom, icône, couleurs)
├── sw.js               ← Service Worker (cache offline)
└── icons/
    ├── icon-192.png    ← Icône app (192×192)
    └── icon-512.png    ← Icône app (512×512)
```

### Architecture globale

```
┌──────────────────┐     HTTPS      ┌──────────────────────┐
│  Téléphone gérant │ ──────────────▶│  Coolify (PIKT)      │
│  ou employé       │               │  scan.piktconsulting.lu│
│  (PWA installée)  │               │  fichiers statiques   │
└────────┬─────────┘               └──────────────────────┘
         │
         │ HTTPS (token dans chaque requête)
         ▼
┌──────────────────────────────────┐
│  Google Apps Script (PIKT)       │
│  Script unique multi-clients     │
│  Registre Licences → Sheet ID    │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────┐
│  Google Sheet (client)│
│  Catalogue + Inventaire│
│  Données = propriété   │
│  du client             │
└──────────────────────┘
```

---

## Étape 1 — Préparer les fichiers

### 1.1 Configurer l'URL du serveur

Ouvrir `index.html`, trouver cette ligne (vers le début du `<script>`) :

```javascript
const API_URL = 'https://script.google.com/macros/s/VOTRE_ID_ICI/exec';
```

Remplacer `VOTRE_ID_ICI` par l'ID de déploiement du Apps Script (obtenu à l'étape 3).

### 1.2 Remplacer les icônes (optionnel)

Les icônes fournies sont fonctionnelles (ciseaux sur fond sombre). Pour un branding custom :

- `icons/icon-192.png` — 192×192px, PNG, fond opaque (pas transparent)
- `icons/icon-512.png` — 512×512px, PNG, fond opaque

Les icônes doivent avoir un fond opaque car `purpose: "any maskable"` dans le manifest signifie qu'Android peut les recadrer en cercle — un fond transparent donnerait un résultat moche.

### 1.3 Personnaliser le manifest (optionnel)

Dans `manifest.json`, tu peux changer :

- `name` : nom complet affiché à l'installation
- `short_name` : nom sous l'icône (max 12 caractères)
- `background_color` / `theme_color` : couleurs du splash screen

---

## Étape 2 — Déployer sur Coolify

### 2.1 Créer le projet

1. Dans Coolify, créer un nouveau service **Static** (ou Nginx)
2. Source : Git repo privé ou upload direct
3. Domaine : `scan.piktconsulting.lu` (ou sous-domaine de ton choix)
4. HTTPS obligatoire (les PWA et la caméra nécessitent HTTPS)

### 2.2 Structure du repo

```
/
├── index.html
├── manifest.json
├── sw.js
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

C'est tout. Pas de build, pas de node_modules, pas de bundler. 5 fichiers statiques.

### 2.3 Configuration Nginx (si tu utilises un Dockerfile custom)

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # PWA : le service worker doit être servi avec ce header
    location /sw.js {
        add_header Cache-Control "no-cache";
        add_header Service-Worker-Allowed "/";
    }

    # Cache agressif pour les assets statiques
    location /icons/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Manifest
    location /manifest.json {
        add_header Content-Type "application/manifest+json";
        expires 1d;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 2.4 Dockerfile minimal (si besoin)

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

### 2.5 Vérification

Après déploiement, ouvrir `https://scan.piktconsulting.lu` sur Chrome Desktop :

1. **F12 → Application → Manifest** : vérifier que le manifest est chargé, icônes visibles
2. **F12 → Application → Service Workers** : vérifier que sw.js est enregistré et activé
3. **Lighthouse → PWA** : lancer un audit, tout doit être vert

---

## Étape 3 — Déployer le Apps Script

Référence complète dans `guide-deploiement-centralise.md`. Résumé :

1. Créer le Registre Licences (Google Sheet privé PIKT)
2. Coller le code `google-apps-script-centralized.js` dans Apps Script
3. Déployer en "Application Web" → Exécuter en tant que MOI, accès TOUT LE MONDE
4. Copier l'URL de déploiement → coller dans `index.html` (étape 1.1)
5. Redéployer les fichiers statiques sur Coolify

---

## Étape 4 — Onboarder un client

### 4.1 Préparer le Google Sheet client

1. Créer un nouveau Google Sheet
2. Créer les onglets avec en-têtes :

**Onglet "Catalogue"** (ligne 1) :

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| EAN | Produit | Marque | Catégorie | Prix Achat | Prix Vente | Photo | Stock Théorique |

**Onglet "Inventaire"** (ligne 1) :

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| EAN | Produit | Marque | Quantité | Zone | État | Scanné par | Date/Heure | Date |

**Onglet "Zones"** (ligne 1 + données) :

| A | B |
|---|---|
| Nom | Emoji |
| Vitrine | 🪟 |
| Étagère soins | 🧴 |
| Poste coiffure | 💇 |
| Réserve | 📦 |
| Caisse | 💰 |

3. Remplir le catalogue (import CSV du fournisseur, saisie manuelle, ou scan initial)

### 4.2 Enregistrer dans le Registre Licences

**Générer le hash du PIN :**
1. Ouvrir l'éditeur Apps Script
2. Modifier la variable `pin` dans la fonction `generatePinHash()` avec le PIN choisi (ex: `847291`)
3. Exécuter `generatePinHash()`
4. Copier le hash depuis les logs (Affichage → Journaux d'exécution)

Ajouter une ligne dans le Sheet privé PIKT :

| Client | Code Salon | Hash PIN | Sheet ID | Expire | Actif | Notes |
|--------|-----------|----------|----------|--------|-------|-------|
| Salon Bella | BELLA | 8d969eef6ecad... | 1BxiMV... | 2027-02-28 | OUI | Setup 08/02/2026 |

- **Code Salon** : court, mémorable, majuscules (ex: `BELLA`, `WALF`, `BONNE`)
- **Hash PIN** : ne JAMAIS mettre le PIN en clair, toujours le hash SHA-256
- **Sheet ID** : extraire de l'URL du Sheet client (`https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`)

### 4.3 Communiquer au client

Envoyer au gérant :

```
Bonjour,

Votre scanner d'inventaire est prêt.

📱 Lien : https://scan.piktconsulting.lu
🏪 Code salon : BELLA
🔒 PIN : 847291

Pour installer l'app sur votre téléphone :
1. Ouvrez le lien ci-dessus dans Chrome (Android) ou Safari (iPhone)
2. Tapez "Ajouter à l'écran d'accueil" (menu ⋮ sur Android, partage ↑ sur iPhone)
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

## Étape 5 — Mise à jour de l'app

### Mettre à jour le HTML / JS

1. Modifier `index.html` localement
2. Push sur le repo ou upload sur Coolify
3. **Incrémenter la version du cache** dans `sw.js` :

```javascript
const CACHE_NAME = 'inventaire-salon-v2'; // était v1
```

4. Le service worker détecte le changement et re-télécharge tout
5. Les utilisateurs voient la nouvelle version au prochain lancement

### Mettre à jour le Apps Script

1. Modifier le code dans l'éditeur Apps Script
2. **Créer un nouveau déploiement** (pas "modifier", ça ne marche pas de façon fiable)
3. Mettre à jour l'URL dans `index.html` si l'ID de déploiement change
4. Redéployer les fichiers statiques

---

## Gestion des clients

### Changer le PIN d'un client

1. Choisir un nouveau PIN
2. Exécuter `generatePinHash()` avec le nouveau PIN → copier le hash
3. Remplacer le hash dans la colonne C du Registre Licences
4. Communiquer le nouveau PIN au gérant
5. Effet immédiat : l'ancien PIN ne fonctionne plus

### Désactiver un client

Dans le Registre Licences, passer la colonne **Actif** de `OUI` à `NON`. Effet immédiat : le prochain appel API du client retournera "Licence inactive".

### Supprimer un client

1. Passer Actif à NON
2. Optionnel : supprimer la ligne du registre
3. Le client garde son Google Sheet (ses données lui appartiennent)
4. Le moteur (Apps Script + PWA) reste chez PIKT

### Suivi facturation

Le Registre Licences sert aussi de suivi. Colonnes suggérées à ajouter :

| ... | Tarif | Début | Dernière facture | Prochain renouvellement |
|-----|-------|-------|------------------|------------------------|

---

## Checklist premier inventaire accompagné

```
□ Google Sheet client créé avec 3 onglets
□ Catalogue importé (EAN, noms, marques, catégories, prix achat, prix vente)
□ Zones configurées (adaptées au salon physique)
□ Stock théorique rempli (si disponible)
□ Ligne ajoutée au Registre Licences
□ Tester le token : ouvrir l'app → entrer le code → vérifier "Connexion OK"
□ Tester un scan : scanner un produit du catalogue → vérifier qu'il apparaît
□ Tester un inconnu : scanner un produit hors catalogue → vérifier le modal
□ Former le gérant : installation PWA, choix zone, toggle ouvert/fermé
□ Former l'équipe : scan, quantité, changement de zone
□ Lancer le premier inventaire complet
□ Générer la synthèse : appeler ?action=genererSynthese&token=xxx
□ Présenter les résultats au gérant (perte sèche, écarts, valeur stock)
```

---

## Troubleshooting

### "L'app ne s'installe pas sur iPhone"

Safari iOS supporte les PWA mais ne montre pas de bannière d'installation automatique. Le gérant doit :
1. Ouvrir le lien dans **Safari** (pas Chrome iOS)
2. Taper l'icône **Partager** (carré avec flèche vers le haut)
3. Scroller jusqu'à **Sur l'écran d'accueil**

### "La caméra ne se lance pas"

- Vérifier que le site est en **HTTPS** (obligatoire pour `getUserMedia`)
- Vérifier que le navigateur a la **permission caméra** (Réglages → Safari/Chrome → Caméra)
- Sur iOS, seul Safari peut accéder à la caméra dans une PWA

### "Serveur injoignable"

- Vérifier que l'URL dans `index.html` est correcte
- Vérifier que le Apps Script est bien déployé en "Tout le monde"
- Vérifier que le code salon est dans le Registre Licences avec Actif = OUI

### "PIN incorrect"

- Vérifier que le hash dans le Registre correspond bien au PIN communiqué au client
- Relancer `generatePinHash()` avec le bon PIN et comparer les hashes
- Le PIN est sensible à la casse et aux espaces

### "Produit scanné mais pas trouvé"

- Le catalogue est chargé au login. Si un produit a été ajouté au Sheet après le login, l'employé doit relancer l'app (Config → re-login)
- Vérifier que l'EAN dans le catalogue correspond exactement (pas d'espace, pas de 0 manquant)

### "Le service worker ne se met pas à jour"

- Incrémenter `CACHE_NAME` dans `sw.js`
- Sur Chrome : F12 → Application → Service Workers → "Update on reload"
- Sur mobile : fermer complètement l'app et la rouvrir

### "Les scans sont lents / la caméra lag"

- html5-qrcode utilise la caméra arrière par défaut (meilleur autofocus)
- Éviter le contre-jour direct sur le code-barres
- Nettoyer l'objectif de la caméra
- Si le téléphone est ancien, réduire la résolution dans les options html5-qrcode (dans le code)

---

## Coûts de fonctionnement

| Poste | Coût | Notes |
|-------|------|-------|
| Hébergement Coolify | ~0€ marginal | Déjà payé, 5 fichiers statiques |
| Google Sheet | 0€ | Workspace PIKT existant |
| Google Apps Script | 0€ | Quotas généreux (6 min/exec, 90 min/jour) |
| Domaine | ~0€ | Sous-domaine de piktconsulting.lu |
| html5-qrcode | 0€ | Librairie open source |
| Google Fonts (Outfit) | 0€ | CDN gratuit |
| **Total infrastructure** | **~0€/mois** | |

Le coût par client est quasi nul. Les 30€ HT/mois sont de la marge pure après le setup initial (~1h par nouveau client).

---

## Évolutions futures possibles

Ces points ne sont PAS dans la version actuelle. Ce sont des pistes si le besoin se confirme sur le terrain :

- **Export PDF** de la synthèse (rapport brandé pour le comptable)
- **Comparaison multi-dates** (évolution des pertes mois par mois dans l'écran Stock)
- **Import catalogue CSV** (upload depuis l'app au lieu de saisie manuelle dans le Sheet)
- **QR code sur l'écran login** (le gérant scanne un QR au lieu de taper le token)
- **Mode inventaire tournant** (une zone par semaine au lieu de tout le salon d'un coup)

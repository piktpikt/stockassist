// ============================================================
// GOOGLE APPS SCRIPT — Scanner Inventaire CENTRALISÉ
// Déployé sous le compte PIKT Consulting
// ============================================================
//
// ARCHITECTURE :
//
//   Ce script est UNIQUE et sert TOUS les clients.
//   Il est déployé sous le compte Google de PIKT Consulting.
//   Chaque client a son propre Google Sheet (ses données).
//   Le script résout quel Sheet utiliser via le code salon + PIN hashé.
//
//   ┌─────────────┐     ┌──────────────────────┐     ┌─────────────────┐
//   │ Téléphones  │────▶│ CE SCRIPT (chez toi) │────▶│ Sheet du client │
//   │ du client   │     │                      │     │ (chez le client)│
//   └─────────────┘     │  Registre Licences   │     └─────────────────┘
//                       │  (chez toi aussi)     │
//                       └──────────────────────┘
//
// SETUP INITIAL (une seule fois) :
//
//   1. Créer un Google Sheet "Registre Licences" dans ton Drive
//      Onglet unique avec en-têtes :
//      Client | Token | Sheet ID | Expire | Actif | Notes
//
//   2. Copier l'ID de ce Sheet → REGISTRE_SHEET_ID ci-dessous
//
//   3. Déployer ce script :
//      Déployer > Application Web
//        Exécuter en tant que : Moi
//        Accès : Tout le monde
//
//   4. L'URL obtenue est l'URL UNIQUE pour tous les clients
//
// ONBOARDING NOUVEAU CLIENT :
//
//   1. Créer un Google Sheet pour le client avec 3 onglets :
//      "Catalogue"  → EAN | Produit | Marque | Catégorie | Prix Achat | Prix Vente | Photo | Stock Théorique
//      "Inventaire" → EAN | Produit | Marque | Quantité | Zone | Scanné par | Date/Heure | Date
//      "Zones"      → Nom | Emoji
//
//   2. Partager ce Sheet avec ton compte Google (Éditeur)
//
//   3. Ajouter une ligne dans le Registre Licences :
//      Salon X | BELLA | (hash SHA-256 du PIN) | ID_DU_SHEET | 2026-12-31 | OUI | notes
//      → Utiliser generatePinHash() dans l'éditeur pour obtenir le hash
//
//   4. Communiquer au client : l'URL du scanner + le code salon + le PIN
//
// DÉSACTIVATION :
//   Changer "OUI" en "NON" dans la colonne Actif. Effet immédiat.
// ============================================================

// ──────────────────────────────────────────────
// ⚠️  CONFIGURATION
// ──────────────────────────────────────────────
const REGISTRE_SHEET_ID = "COLLER_ID_DU_REGISTRE_ICI";
const PHOTO_FOLDER_ID = "";
// ──────────────────────────────────────────────

const CATALOGUE_SHEET = "Catalogue";
const INVENTAIRE_SHEET = "Inventaire";
const ZONES_SHEET = "Zones";
const SYNTHESE_SHEET = "Synthèse";

// ═══════════════════════════════════════════════
// CATALOGUE INDEX (cache O(1) au lieu de O(n))
// ═══════════════════════════════════════════════

/**
 * Construit un index {ean: {produit, marque, row}} depuis le Sheet Catalogue.
 * Utilise CacheService (6h TTL) pour éviter de relire le Sheet à chaque scan.
 * Clé cache = sheetId pour isolation multi-clients.
 */
function getCatalogueIndex(ss) {
  const cacheKey = "catIdx_" + ss.getId();
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);

  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  // Build index from Sheet
  const catData = ss.getSheetByName(CATALOGUE_SHEET).getDataRange().getValues();
  const idx = {};
  for (let i = 1; i < catData.length; i++) {
    const ean = String(catData[i][0]).trim();
    if (!ean) continue;
    idx[ean] = {
      produit: catData[i][1] || "",
      marque: catData[i][2] || "",
      categorie: catData[i][3] || "",
      prixAchat: Number(catData[i][4]) || 0,
      prixVente: Number(catData[i][5]) || 0,
      photoUrl: catData[i][6] || "",
      stockTheorique: Number(catData[i][7]) || 0,
      type: String(catData[i][8] || "CV").toUpperCase(), // V=Vente, C=Consommable, CV=Les deux
      row: i + 1  // 1-indexed row in Sheet (pour uploadPhoto)
    };
  }

  // CacheService limite à 100KB par clé — tronquer si trop gros
  const json = JSON.stringify(idx);
  if (json.length < 90000) {
    cache.put(cacheKey, json, 21600); // 6h
  }

  return idx;
}

/** Invalide le cache catalogue (après ajout produit) */
function invalidateCatalogueCache(ss) {
  CacheService.getScriptCache().remove("catIdx_" + ss.getId());
}

// ═══════════════════════════════════════════════
// RÉSOLUTION DE LICENCE
// ═══════════════════════════════════════════════

function resolveLicence(token) {
  if (!token) return { valid: false, error: "Identifiants manquants" };

  // Token format: "CODE_SALON:PIN"
  const sep = token.indexOf(":");
  if (sep === -1) return { valid: false, error: "Format d'identifiants invalide" };

  const codeSalon = token.substring(0, sep).trim().toUpperCase();
  const pin = token.substring(sep + 1).trim();

  if (!codeSalon || !pin) return { valid: false, error: "Code salon et PIN requis" };

  // Hash le PIN pour comparaison
  const pinHash = hashSHA256(pin);

  try {
    const registre = SpreadsheetApp.openById(REGISTRE_SHEET_ID);
    const data = registre.getSheets()[0].getDataRange().getValues();

    // Colonnes : Client | Code Salon | Hash PIN | Sheet ID | Expire | Actif | Notes
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim().toUpperCase() === codeSalon) {
        const client = data[i][0];
        const storedHash = String(data[i][2]).trim();
        const sheetId = String(data[i][3]).trim();
        const expire = data[i][4];
        const actif = String(data[i][5]).trim().toUpperCase();

        // Vérifier le PIN hashé
        if (storedHash !== pinHash) {
          return { valid: false, error: "🔒 PIN incorrect." };
        }

        if (actif !== "OUI" && actif !== "YES" && actif !== "TRUE" && actif !== "1") {
          return { valid: false, error: "⛔ Licence désactivée. Contactez PIKT Consulting pour réactiver." };
        }

        if (expire) {
          const expDate = new Date(expire);
          if (!isNaN(expDate.getTime()) && expDate < new Date()) {
            return {
              valid: false,
              error: "⏰ Licence expirée le " +
                Utilities.formatDate(expDate, Session.getScriptTimeZone(), "dd/MM/yyyy") +
                ". Contactez PIKT Consulting pour renouveler."
            };
          }
        }

        if (!sheetId) return { valid: false, error: "Configuration incomplète — Sheet ID manquant." };

        return { valid: true, client, sheetId };
      }
    }

    return { valid: false, error: "❌ Code salon inconnu." };
  } catch (err) {
    return { valid: false, error: "Erreur serveur: " + err.message };
  }
}

// ── SHA-256 hash ──
function hashSHA256(input) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return raw.map(b => ("0" + ((b < 0 ? b + 256 : b).toString(16))).slice(-2)).join("");
}

// ═══════════════════════════════════════════════
// UTILITAIRE — Générer le hash d'un PIN (à appeler depuis l'éditeur Apps Script)
// Usage : dans l'éditeur, exécuter generatePinHash() → voir les logs
// ═══════════════════════════════════════════════
function generatePinHash() {
  const pin = "123456"; // ← CHANGER ICI avant d'exécuter
  const hash = hashSHA256(pin);
  Logger.log("PIN: " + pin);
  Logger.log("Hash SHA-256: " + hash);
  Logger.log("→ Coller ce hash dans la colonne 'Hash PIN' du Registre Licences");
}

// ═══════════════════════════════════════════════
// RÉPONSES
// ═══════════════════════════════════════════════

function jsonOk(obj) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, ...obj }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(msg) {
  return ContentService.createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════

function doGet(e) {
  // Health check only — no token in URL
  return ContentService.createTextOutput(JSON.stringify({ success: true, status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const licence = resolveLicence(data.token);
    if (!licence.valid) return jsonError(licence.error);

    const ss = SpreadsheetApp.openById(licence.sheetId);
    const action = data.action;

    // Read actions (ex-GET)
    if (action === "ping") return jsonOk({ message: "✅ Connexion OK — " + licence.client });
    if (action === "getCatalogue") return getCatalogue(ss);
    if (action === "getZones") return getZones(ss);
    if (action === "getInventaire") return getInventaire(ss);
    if (action === "getStockView") return getStockView(ss, data.date || "");
    if (action === "genererSynthese") { genererSynthese(ss); return jsonOk({ message: "Synthèse générée" }); }

    // Write actions
    if (action === "scan") return enregistrerScan(ss, data);
    if (action === "ajouterProduit") return ajouterAuCatalogue(ss, data);
    if (action === "uploadPhoto") return uploadPhoto(ss, data);

    // Manager actions
    if (action === "resetInventaire") return resetInventaire(ss);

    return jsonError("Action inconnue: " + action);
  } catch (err) {
    return jsonError(err.toString());
  }
}

// ═══════════════════════════════════════════════
// ZONES
// ═══════════════════════════════════════════════

function getZones(ss) {
  const sheet = ss.getSheetByName(ZONES_SHEET);
  if (!sheet) {
    return jsonOk({ zones: [
      { nom: "Vitrine", emoji: "🪟" }, { nom: "Réserve", emoji: "📦" },
      { nom: "Poste Coiffure", emoji: "💇" }, { nom: "Poste Manucure", emoji: "💅" },
      { nom: "Accueil", emoji: "🛋️" }
    ]});
  }
  const data = sheet.getDataRange().getValues();
  const zones = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) zones.push({ nom: String(data[i][0]), emoji: data[i][1] || "📍" });
  }
  return jsonOk({ zones });
}

// ═══════════════════════════════════════════════
// CATALOGUE
// ═══════════════════════════════════════════════

function getCatalogue(ss) {
  // Warm the cache (sera réutilisé par enregistrerScan/uploadPhoto)
  const idx = getCatalogueIndex(ss);
  const produits = Object.keys(idx).map(ean => ({
    ean, produit: idx[ean].produit, marque: idx[ean].marque,
    categorie: idx[ean].categorie, prixAchat: idx[ean].prixAchat,
    prixVente: idx[ean].prixVente, photo: idx[ean].photoUrl,
    stockTheorique: idx[ean].stockTheorique, type: idx[ean].type
  }));
  return jsonOk({ produits });
}

function ajouterAuCatalogue(ss, data) {
  ss.getSheetByName(CATALOGUE_SHEET).appendRow([
    String(data.ean), data.produit || "", data.marque || "",
    data.categorie || "", data.prixAchat || "", data.prixVente || "",
    data.photo || "", data.stockTheorique || 0,
    String(data.type || "CV").toUpperCase()
  ]);
  invalidateCatalogueCache(ss);
  return jsonOk({ message: `${data.produit} ajouté au catalogue` });
}

// ═══════════════════════════════════════════════
// INVENTAIRE
// ═══════════════════════════════════════════════

function getInventaire(ss) {
  const sheet = ss.getSheetByName(INVENTAIRE_SHEET);
  const data = sheet.getDataRange().getValues();
  const scans = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      scans.push({
        ean: String(data[i][0]), produit: data[i][1] || "", marque: data[i][2] || "",
        quantite: data[i][3] || 1, zone: data[i][4] || "", etat: data[i][5] || "F",
        scannePar: data[i][6] || "", dateHeure: data[i][7] || "", date: data[i][8] || ""
      });
    }
  }
  return jsonOk({ scans });
}

function enregistrerScan(ss, data) {
  const idx = getCatalogueIndex(ss);
  const entry = idx[String(data.ean)] || null;

  const produit = entry ? entry.produit : (data.produit || "INCONNU");
  const marque = entry ? entry.marque : (data.marque || "");
  const trouve = !!entry;

  const maintenant = new Date();
  const tz = Session.getScriptTimeZone();

  ss.getSheetByName(INVENTAIRE_SHEET).appendRow([
    String(data.ean),
    produit,
    marque,
    data.quantite || 1,
    data.zone || "",
    data.etat || "F",
    data.scannePar || "",
    Utilities.formatDate(maintenant, tz, "dd/MM/yyyy HH:mm:ss"),
    Utilities.formatDate(maintenant, tz, "dd/MM/yyyy")
  ]);

  return jsonOk({ trouve, produit, marque,
    message: trouve ? `${produit} (${marque})` : `EAN ${data.ean} — inconnu`
  });
}

function resetInventaire(ss) {
  const sheet = ss.getSheetByName(INVENTAIRE_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  return jsonOk({ message: "Inventaire réinitialisé" });
}

// ═══════════════════════════════════════════════
// STOCK VIEW — Agrégation par date d'inventaire
// ═══════════════════════════════════════════════

function getStockView(ss, dateFilter) {
  const catData = ss.getSheetByName(CATALOGUE_SHEET).getDataRange().getValues();
  const invData = ss.getSheetByName(INVENTAIRE_SHEET).getDataRange().getValues();

  // Index catalogue par EAN (avec prixAchat + prixVente)
  const cat = {};
  const categories = new Set();
  for (let i = 1; i < catData.length; i++) {
    const ean = String(catData[i][0]); if (!ean) continue;
    const categorie = catData[i][3] || "";
    if (categorie) categories.add(categorie);
    cat[ean] = {
      produit: catData[i][1] || "", marque: catData[i][2] || "",
      categorie, prixAchat: Number(catData[i][4]) || 0,
      prixVente: Number(catData[i][5]) || 0,
      stockTheorique: Number(catData[i][7]) || 0,
      type: String(catData[i][8] || "CV").toUpperCase()
    };
  }

  // Collecter toutes les dates d'inventaire disponibles
  const datesSet = new Set();
  for (let i = 1; i < invData.length; i++) {
    const dateCell = normalizeDateCell(invData[i][8] || invData[i][7]);
    if (dateCell && dateCell !== "undefined" && dateCell !== "") datesSet.add(dateCell);
  }
  // Trier les dates (format dd/MM/yyyy) — plus récent en premier
  const dates = [...datesSet].sort((a, b) => {
    const pa = a.split("/"), pb = b.split("/");
    const da = new Date(pa[2], pa[1]-1, pa[0]), db = new Date(pb[2], pb[1]-1, pb[0]);
    return db - da;
  });

  // Si pas de date sélectionnée, retourner uniquement les dates + catégories (pas de stock)
  if (!dateFilter || dateFilter === "") {
    return jsonOk({ stock: null, dates, categories: [...categories].sort(), message: "Sélectionnez une date d'inventaire." });
  }

  // Normaliser le filtre date
  let filterDateStr = "";
  if (dateFilter.includes("-")) {
    // yyyy-MM-dd → dd/MM/yyyy
    const parts = dateFilter.split("-");
    if (parts.length === 3) filterDateStr = parts[2] + "/" + parts[1] + "/" + parts[0];
  } else {
    // Déjà en dd/MM/yyyy
    filterDateStr = dateFilter;
  }

  // Date range: si dateFilter contient "|" c'est un range from|to (dd/MM/yyyy|dd/MM/yyyy)
  let filterDateEnd = "";
  if (dateFilter.includes("|")) {
    const rangeParts = dateFilter.split("|");
    filterDateStr = rangeParts[0];
    filterDateEnd = rangeParts[1];
  }

  // Agréger l'inventaire pour la date sélectionnée
  const parEan = {};
  for (let i = 1; i < invData.length; i++) {
    const ean = String(invData[i][0]); if (!ean) continue;
    const qty = Number(invData[i][3]) || 0;
    const zone = invData[i][4] || "";
    const etat = String(invData[i][5] || "F").toUpperCase();
    const dateCell = normalizeDateCell(invData[i][8] || invData[i][7]);

    // Filtre par date (exacte ou range)
    if (filterDateEnd) {
      if (!isDateInRange(dateCell, filterDateStr, filterDateEnd)) continue;
    } else {
      if (dateCell !== filterDateStr) continue;
    }

    if (!parEan[ean]) parEan[ean] = { total: 0, fermes: 0, ouverts: 0, zones: {} };
    parEan[ean].total += qty;
    if (etat === "O") parEan[ean].ouverts += qty; else parEan[ean].fermes += qty;
    if (zone) parEan[ean].zones[zone] = (parEan[ean].zones[zone] || 0) + qty;
  }

  // Construire le résultat
  const stock = [];
  // Seuls les EAN avec des scans à cette date + ceux du catalogue pour écarts
  const tousEan = new Set([...Object.keys(cat), ...Object.keys(parEan)]);

  for (const ean of tousEan) {
    const c = cat[ean] || { produit: "INCONNU", marque: "", categorie: "", prixAchat: 0, prixVente: 0, stockTheorique: 0, type: "CV" };
    const inv = parEan[ean] || { total: 0, fermes: 0, ouverts: 0, zones: {} };
    const ecart = inv.total - c.stockTheorique;
    const coutStock = Math.round(inv.fermes * c.prixAchat * 100) / 100;
    const valeurVente = Math.round(inv.fermes * c.prixVente * 100) / 100;
    const perteSèche = ecart < 0 ? Math.round(Math.abs(ecart) * c.prixAchat * 100) / 100 : 0;

    stock.push({
      ean, produit: c.produit, marque: c.marque, categorie: c.categorie,
      type: c.type,
      prixAchat: c.prixAchat, prixVente: c.prixVente, theorique: c.stockTheorique,
      total: inv.total, fermes: inv.fermes, ouverts: inv.ouverts,
      ecart, coutStock, valeurVente, perteSèche,
      zones: inv.zones
    });
  }

  // Collecter les types disponibles pour filtrage
  const types = [...new Set(stock.map(s => s.type))].sort();
  return jsonOk({ stock, dates, categories: [...categories].sort(), types, date: filterDateStr });
}

// Helper: compare dd/MM/yyyy dates
// Normalise une valeur de cellule date en string "dd/MM/yyyy"
function normalizeDateCell(val) {
  if (!val) return "";
  // Si c'est un objet Date natif (Google Sheets le fait parfois)
  if (val instanceof Date) {
    const d = val.getDate(), m = val.getMonth() + 1, y = val.getFullYear();
    return (d < 10 ? "0" + d : d) + "/" + (m < 10 ? "0" + m : m) + "/" + y;
  }
  const s = String(val).split(" ")[0]; // enlever la partie heure si présente
  // Si format yyyy-MM-dd (ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const p = s.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  return s; // déjà dd/MM/yyyy (on espère)
}

function isDateInRange(dateStr, startStr, endStr) {
  const toTs = (d) => { const p = String(d).split("/"); return new Date(p[2], p[1]-1, p[0]).getTime(); };
  try { const t = toTs(dateStr); return t >= toTs(startStr) && t <= toTs(endStr); }
  catch { return false; }
}

// ═══════════════════════════════════════════════
// PHOTOS
// ═══════════════════════════════════════════════

function getPhotoFolder() {
  if (PHOTO_FOLDER_ID) return DriveApp.getFolderById(PHOTO_FOLDER_ID);
  const folders = DriveApp.getFoldersByName("Photos Inventaire");
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder("Photos Inventaire");
}

function uploadPhoto(ss, data) {
  try {
    const folder = getPhotoFolder();
    const blob = Utilities.newBlob(
      Utilities.base64Decode(data.photo), "image/jpeg",
      `${data.ean || "unknown"}_${Date.now()}.jpg`
    );
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileUrl = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w400`;

    if (data.ean) {
      const idx = getCatalogueIndex(ss);
      const entry = idx[String(data.ean)];
      if (entry && entry.row) {
        ss.getSheetByName(CATALOGUE_SHEET).getRange(entry.row, 7).setValue(fileUrl);
      }
    }
    return jsonOk({ url: fileUrl, message: "Photo uploadée" });
  } catch (err) {
    return jsonError("Erreur upload photo: " + err.toString());
  }
}

// ═══════════════════════════════════════════════
// SYNTHÈSE
// ═══════════════════════════════════════════════

function genererSynthese(ss) {
  const catData = ss.getSheetByName(CATALOGUE_SHEET).getDataRange().getValues();
  const invData = ss.getSheetByName(INVENTAIRE_SHEET).getDataRange().getValues();

  // Index catalogue
  const cat = {};
  for (let i = 1; i < catData.length; i++) {
    const ean = String(catData[i][0]); if (!ean) continue;
    cat[ean] = {
      produit: catData[i][1] || "", marque: catData[i][2] || "",
      categorie: catData[i][3] || "", prixAchat: Number(catData[i][4]) || 0,
      prixVente: Number(catData[i][5]) || 0,
      stockTheorique: Number(catData[i][7]) || 0,
      type: String(catData[i][8] || "CV").toUpperCase()
    };
  }

  // Agrégation
  const parEan = {}, parZone = {}, parPersonne = {}, parDate = {};
  for (let i = 1; i < invData.length; i++) {
    const ean = String(invData[i][0]); if (!ean) continue;
    const qty = Number(invData[i][3]) || 0;
    const zone = invData[i][4] || "Non défini";
    const etat = String(invData[i][5] || "F").toUpperCase();
    const personne = invData[i][6] || "Anonyme";
    const date = normalizeDateCell(invData[i][8] || invData[i][7]);

    if (!parEan[ean]) parEan[ean] = { qty: 0, fermes: 0, ouverts: 0, zones: {} };
    parEan[ean].qty += qty;
    if (etat === "O") parEan[ean].ouverts += qty; else parEan[ean].fermes += qty;
    parEan[ean].zones[zone] = (parEan[ean].zones[zone] || 0) + qty;

    if (!parZone[zone]) parZone[zone] = {};
    parZone[zone][ean] = (parZone[zone][ean] || 0) + qty;

    if (qty > 0) parPersonne[personne] = (parPersonne[personne] || 0) + qty;
    const ds = String(date).split(" ")[0];
    if (ds && qty > 0) parDate[ds] = (parDate[ds] || 0) + qty;
  }

  // Feuille synthèse
  let syn = ss.getSheetByName(SYNTHESE_SHEET);
  if (syn) syn.clear(); else syn = ss.insertSheet(SYNTHESE_SHEET);

  const bold = SpreadsheetApp.newTextStyle().setBold(true).build();
  let row = 1;

  function hdr(texts, r) {
    syn.getRange(r, 1, 1, texts.length).setValues([texts])
      .setBackground("#2d2d2d").setFontColor("#ffffff").setTextStyle(bold).setHorizontalAlignment("center");
    return r + 1;
  }
  function title(text, r, cols) {
    syn.getRange(r, 1, 1, cols).merge().setValue(text)
      .setTextStyle(SpreadsheetApp.newTextStyle().setBold(true).setFontSize(13).build())
      .setBackground("#f0f0f0").setHorizontalAlignment("left");
    return r + 2;
  }

  // ── Section 1 : Par produit ──
  row = title("📊 SYNTHÈSE PAR PRODUIT", row, 15);
  row = hdr(["EAN","Produit","Marque","Catégorie","Type","Achat €","Vente €","Théorique","Fermés","Ouverts","Total","Écart","Coût Stock €","Valeur Vente €","Perte Sèche €"], row);

  const tousEan = new Set([...Object.keys(cat), ...Object.keys(parEan)]);
  const lignes = [];
  let totT = 0, totC = 0, totF = 0, totO = 0, totCout = 0, totVente = 0, totPerte = 0;
  // Type-split totals
  const typeLabels = { V: "Vente", C: "Consommable", CV: "Vente + Conso" };
  const typeTotals = { V: { cout: 0, vente: 0, perte: 0, items: 0 }, C: { cout: 0, vente: 0, perte: 0, items: 0 }, CV: { cout: 0, vente: 0, perte: 0, items: 0 } };

  for (const ean of tousEan) {
    const c = cat[ean] || { produit:"INCONNU", marque:"", categorie:"", prixAchat:0, prixVente:0, stockTheorique:0, type:"CV" };
    const e = parEan[ean] || { qty: 0, fermes: 0, ouverts: 0 };
    const ec = e.qty - c.stockTheorique;
    const coutStock = Math.round(e.fermes * c.prixAchat * 100) / 100;
    const valeurVente = Math.round(e.fermes * c.prixVente * 100) / 100;
    const perteSèche = ec < 0 ? Math.round(Math.abs(ec) * c.prixAchat * 100) / 100 : 0;
    totT += c.stockTheorique; totC += e.qty;
    totF += e.fermes; totO += e.ouverts;
    totCout += coutStock; totVente += valeurVente; totPerte += perteSèche;
    // Type-split
    const t = c.type || "CV";
    if (typeTotals[t]) { typeTotals[t].cout += coutStock; typeTotals[t].vente += valeurVente; typeTotals[t].perte += perteSèche; typeTotals[t].items++; }
    const typeDisplay = typeLabels[t] || t;
    lignes.push([ean, c.produit, c.marque, c.categorie, typeDisplay, c.prixAchat, c.prixVente, c.stockTheorique, e.fermes, e.ouverts, e.qty, ec, coutStock, valeurVente, perteSèche]);
  }
  lignes.sort((a,b) => String(a[1]).localeCompare(String(b[1])));

  if (lignes.length) {
    syn.getRange(row, 1, lignes.length, 15).setValues(lignes);
    for (let i = 0; i < lignes.length; i++) {
      const cellEcart = syn.getRange(row+i, 12);
      if (lignes[i][11] < 0) cellEcart.setBackground("#ffcccc").setFontColor("#cc0000");
      else if (lignes[i][11] > 0) cellEcart.setBackground("#ccffcc").setFontColor("#006600");
      else cellEcart.setBackground("#e8e8e8").setFontColor("#666666");
      // Amber ouverts
      if (lignes[i][9] > 0) syn.getRange(row+i, 10).setBackground("#fff3cc").setFontColor("#996600");
      // Red perte sèche
      if (lignes[i][14] > 0) syn.getRange(row+i, 15).setBackground("#ffcccc").setFontColor("#cc0000");
      // Type pill color
      const typeVal = lignes[i][4];
      if (typeVal === "Consommable") syn.getRange(row+i, 5).setBackground("#e0f0ff").setFontColor("#0066aa");
      else if (typeVal === "Vente") syn.getRange(row+i, 5).setBackground("#e0ffe0").setFontColor("#006600");
      else syn.getRange(row+i, 5).setBackground("#fff0e0").setFontColor("#996600");
    }
    row += lignes.length;
  }
  syn.getRange(row,1,1,15).setValues([["","","","","","","TOTAUX","",totF,totO,totC,totC-totT,Math.round(totCout*100)/100,Math.round(totVente*100)/100,Math.round(totPerte*100)/100]]).setTextStyle(bold).setBackground("#f5f5f5");
  row += 2;

  // ── Section 2 : Par zone ──
  row = title("📍 RÉPARTITION PAR ZONE", row, 5);
  row = hdr(["Zone","Produits uniques","Quantité","Valeur €","% stock"], row);

  const lz = []; let gTot = 0;
  for (const z of Object.keys(parZone).sort()) {
    let zq=0, zv=0, zu=0;
    for (const ean of Object.keys(parZone[z])) {
      const q = parZone[z][ean]; if (q>0) { zq+=q; zu++; zv+=q*(cat[ean]?cat[ean].prixVente:0); }
    }
    gTot += zq; lz.push([z, zu, zq, Math.round(zv*100)/100, 0]);
  }
  for (const l of lz) l[4] = gTot>0 ? Math.round(l[2]/gTot*100)+"%" : "0%";
  if (lz.length) { syn.getRange(row,1,lz.length,5).setValues(lz); row += lz.length; }
  row += 2;

  // ── Section 3 : Par personne ──
  row = title("👤 ACTIVITÉ PAR PERSONNE", row, 3);
  row = hdr(["Nom","Scans","% total"], row);
  const tS = Object.values(parPersonne).reduce((a,b)=>a+b,0);
  const lp = Object.entries(parPersonne).sort((a,b)=>b[1]-a[1]).map(([n,c])=>[n,c,tS>0?Math.round(c/tS*100)+"%":"0%"]);
  if (lp.length) { syn.getRange(row,1,lp.length,3).setValues(lp); row += lp.length; }
  row += 2;

  // ── Section 4 : Alertes ──
  row = title("⚠️ ALERTES — Écarts", row, 9);
  row = hdr(["EAN","Produit","Marque","Théorique","Fermés","Ouverts","Total","Écart","Perte Sèche €"], row);
  const al = lignes.filter(l=>l[10]!==0).sort((a,b)=>a[10]-b[10]).map(l=>[l[0],l[1],l[2],l[6],l[7],l[8],l[9],l[10],l[13]]);
  if (al.length) {
    syn.getRange(row,1,al.length,9).setValues(al);
    for (let i=0;i<al.length;i++) {
      const cellEcart=syn.getRange(row+i,8);
      if(al[i][7]<0) cellEcart.setBackground("#ffcccc").setFontColor("#cc0000");
      else cellEcart.setBackground("#ccffcc").setFontColor("#006600");
      if(al[i][8]>0) syn.getRange(row+i,9).setBackground("#ffcccc").setFontColor("#cc0000");
    }
    row += al.length;
  } else { syn.getRange(row,1).setValue("✅ Aucun écart."); row++; }
  row += 2;

  // ── Section 5 : Infos ──
  row = title("ℹ️ INFORMATIONS", row, 3);
  const dts = Object.keys(parDate).sort();
  const marge = totVente - totCout;

  // Type breakdown
  const tV = typeTotals.V, tC = typeTotals.C, tCV = typeTotals.CV;

  syn.getRange(row,1,18,3).setValues([
    ["Date de génération", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"), ""],
    ["Date(s) d'inventaire", dts.join(", ") || "Aucun scan", ""],
    ["Produits au catalogue", Object.keys(cat).length, ""],
    ["Produits scannés", Object.keys(parEan).length, ""],
    ["Total articles comptés", totC, "dont " + totF + " fermés, " + totO + " ouverts"],
    ["", "", ""],
    ["💰 Coût du stock (prix achat)", totCout.toFixed(2) + " €", "(fermés × prix achat)"],
    ["💶 Valeur vente du stock", totVente.toFixed(2) + " €", "(fermés × prix vente)"],
    ["📈 Marge brute potentielle", marge.toFixed(2) + " €", "(" + (totCout > 0 ? Math.round(marge/totCout*100) : 0) + "% de marge)"],
    ["🔴 Perte sèche (écarts négatifs)", totPerte.toFixed(2) + " €", "(produits manquants × prix achat)"],
    ["", "", ""],
    ["📦 Ventilation par type", "", ""],
    ["   🟢 Vente (" + tV.items + " produits)", "Coût: " + tV.cout.toFixed(2) + "€ · Valeur: " + tV.vente.toFixed(2) + "€", "Perte: " + tV.perte.toFixed(2) + "€"],
    ["   🔵 Consommable (" + tC.items + " produits)", "Coût: " + tC.cout.toFixed(2) + "€", "Perte: " + tC.perte.toFixed(2) + "€"],
    ["   🟠 Vente + Conso (" + tCV.items + " produits)", "Coût: " + tCV.cout.toFixed(2) + "€ · Valeur: " + tCV.vente.toFixed(2) + "€", "Perte: " + tCV.perte.toFixed(2) + "€"],
    ["", "", ""],
    ["Personnes", Object.keys(parPersonne).join(", ") || "—", ""],
    ["Zones utilisées", Object.keys(parZone).join(", ") || "—", ""]
  ]);

  syn.autoResizeColumns(1, 15);
  syn.setColumnWidth(1, 150);
  syn.setColumnWidth(2, 250);
  ss.setActiveSheet(syn);
}

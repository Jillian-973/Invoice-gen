const express = require("express");
const path = require("path");
const multer = require("multer");
const session = require("express-session");
const bcrypt = require("bcrypt");
const fs = require("fs").promises;
const nodemailer = require("nodemailer");

require("dotenv").config();
const mongoose = require("mongoose");
const MongoStore = require('connect-mongo').default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

mongoose.connect(process.env.MONGO_URI, {
  tls: true,
  tlsAllowInvalidCertificates: true,
}).then(() => console.log('✅ MongoDB connecté'))
  .catch(err => console.error('❌ Erreur MongoDB:', err));

const userSchema = new mongoose.Schema(
  { email: { type: String, required: true, unique: true }, password: { type: String, required: true } },
  { timestamps: true }
);
const User = mongoose.model("User", userSchema);

const ligneDepenseSchema = new mongoose.Schema({
  dateDepense: String, objetDepense: String, km: Number, peages: Number, autres: Number,
});

const invoiceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  nomDemandeur: { type: String, required: true },
  dateDemande: String, raisonDepense: String, budget: String,
  lignes: [ligneDepenseSchema],
  totalFrais: Number,
  choix: { type: String, enum: ["abandon", "remboursement"] },
  montantAbandon: Number, iban: String, bic: String,
  signature: String,
  justificatifs: [String],
  emailDestinataire: String,
}, { timestamps: true });
const Invoice = mongoose.model("Invoice", invoiceSchema);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = 'public/uploads';
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const existing = await User.findOne({ email });
  if (existing) return res.status(400).send("Email déjà utilisé");
  const hashedPassword = await bcrypt.hash(password, 10);
  await User.create({ email, password: hashedPassword });
  res.send("Utilisateur créé");
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.send('Utilisateur introuvable');
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.send('Mot de passe incorrect');
  req.session.userId = user._id;
  res.send('Connecté');
});

app.get("/logout", (req, res) => { req.session.destroy(); res.send("Déconnecté"); });

function isAuth(req, res, next) {
  if (req.session.userId) next();
  else res.status(401).send("Non autorisé");
}

app.post('/invoice', isAuth, upload.array('justificatifs'), async (req, res) => {
  try {
    const {
      nomDemandeur, dateDemande, raisonDepense, budget,
      lignes, totalFrais, choix, montantAbandon, iban, bic,
      signature, emailDestinataire
    } = req.body;

    const justificatifs = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];
    const parsedLignes = lignes ? JSON.parse(lignes) : [];
    const totalNum = parseFloat(totalFrais) || 0;

    const invoice = await Invoice.create({
      userId: req.session.userId, nomDemandeur, dateDemande, raisonDepense, budget,
      lignes: parsedLignes, totalFrais: totalNum,
      choix, montantAbandon: montantAbandon ? parseFloat(montantAbandon) : undefined,
      iban, bic, signature, justificatifs, emailDestinataire,
    });

    // Envoi du mail si une adresse est fournie
    if (emailDestinataire && emailDestinataire.trim()) {
      try {
        const BAREME = 0.606;

        // Construire le tableau HTML des dépenses
        const lignesHTML = parsedLignes.map(l => {
          const kmTotal = (parseFloat(l.km) || 0) * BAREME;
          return `
            <tr>
              <td style="padding:8px 12px;border:1px solid #ddd">${l.dateDepense || '—'}</td>
              <td style="padding:8px 12px;border:1px solid #ddd">${l.objetDepense || '—'}</td>
              <td style="padding:8px 12px;border:1px solid #ddd;text-align:right">${parseFloat(l.km)||0} km</td>
              <td style="padding:8px 12px;border:1px solid #ddd;text-align:right">${kmTotal.toFixed(2)} €</td>
              <td style="padding:8px 12px;border:1px solid #ddd;text-align:right">${parseFloat(l.peages||0).toFixed(2)} €</td>
              <td style="padding:8px 12px;border:1px solid #ddd;text-align:right">${parseFloat(l.autres||0).toFixed(2)} €</td>
            </tr>`;
        }).join('');

        let choixHTML = '';
        if (choix === 'abandon') {
          const apresImpots = totalNum * (1 - 0.66);
          choixHTML = `
            <p><strong>Choix :</strong> Don au CST (abandon des frais)</p>
            <p><strong>Montant abandonné :</strong> ${totalNum.toFixed(2)} €</p>
            <p>Après déduction d'impôts (66%), le montant réel dépensé sera de : <strong>${apresImpots.toFixed(2)} €</strong></p>`;
        } else {
          choixHTML = `
            <p><strong>Choix :</strong> Remboursement</p>
            <p><strong>Montant à rembourser :</strong> ${totalNum.toFixed(2)} €</p>
            ${iban ? `<p><strong>IBAN :</strong> ${iban}</p>` : ''}
            ${bic ? `<p><strong>BIC :</strong> ${bic}</p>` : ''}`;
        }

        // Pièces jointes justificatifs
        const attachments = [];
        for (const filePath of justificatifs) {
          const fullPath = path.join(__dirname, 'public', filePath);
          const filename = path.basename(filePath);
          try {
            attachments.push({ filename, path: fullPath });
          } catch (_) {}
        }

        const htmlBody = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/><style>
  body{font-family:Arial,sans-serif;color:#1a1714;max-width:700px;margin:0 auto;padding:24px}
  h1{font-family:Georgia,serif;color:#1a1714;border-bottom:2px solid #c9a84c;padding-bottom:12px}
  h2{font-family:Georgia,serif;font-size:1.1rem;color:#4a4540;margin-top:28px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:#f5f0e8;padding:8px 12px;border:1px solid #ddd;text-align:left;font-size:0.85rem}
  .total{text-align:right;font-size:1.1rem;font-weight:bold;padding:12px 0;border-top:2px solid #1a1714}
  .footer{margin-top:40px;font-size:0.8rem;color:#888;border-top:1px solid #ddd;padding-top:16px}
</style></head>
<body>
  <h1>📋 Note de frais — CST</h1>
  <h2>Informations du demandeur</h2>
  <table>
    <tr><th>Nom</th><td style="padding:8px 12px;border:1px solid #ddd">${nomDemandeur}</td></tr>
    <tr><th>Date de la demande</th><td style="padding:8px 12px;border:1px solid #ddd">${dateDemande || '—'}</td></tr>
    <tr><th>Raison</th><td style="padding:8px 12px;border:1px solid #ddd">${raisonDepense || '—'}</td></tr>
    <tr><th>Budget</th><td style="padding:8px 12px;border:1px solid #ddd">${budget || '—'}</td></tr>
  </table>
  <h2>Détail des dépenses</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Objet</th><th>Km</th>
        <th>Montant km (0,606 €/km)</th><th>Péages</th><th>Autres</th>
      </tr>
    </thead>
    <tbody>${lignesHTML}</tbody>
  </table>
  <p class="total">TOTAL des frais : ${totalNum.toFixed(2)} €</p>
  <h2>Traitement</h2>
  ${choixHTML}
  <div class="footer">
    Note de frais générée automatiquement — CST<br/>
    Référence : #${String(invoice._id).slice(-6)}
  </div>
</body>
</html>`;

        await transporter.sendMail({
          from: `"Note de Frais CST" <${process.env.SMTP_USER}>`,
          to: emailDestinataire.trim(),
          subject: `Note de frais — ${nomDemandeur} — ${totalNum.toFixed(2)} €`,
          html: htmlBody,
          attachments,
        });

        console.log(`✉️ Mail envoyé à ${emailDestinataire}`);
      } catch (mailErr) {
        console.error('❌ Erreur envoi mail:', mailErr.message);
        // On ne bloque pas la réponse si le mail échoue
      }
    }

    res.json({ ok: true, id: invoice._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/my-invoices', isAuth, async (req, res) => {
  const userInvoices = await Invoice.find({ userId: req.session.userId }).sort({ createdAt: -1 });
  res.json(userInvoices);
});

app.delete('/invoice/:id', isAuth, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!invoice) return res.status(404).json({ ok: false, error: 'Facture introuvable' });
    for (const filePath of invoice.justificatifs || []) {
      try { await fs.unlink(path.join(__dirname, 'public', filePath)); } catch (_) {}
    }
    await Invoice.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── HELPERS GLOBAUX ───────────────────────────────────────────────────────────
const fmt = (n) => parseFloat(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
};
const BAREME = 0.606;

// ── HELPER : génère le HTML de la note de frais ──────────────────────────────
function buildInvoiceHTML(invoice) {

  const lignesHTML = (invoice.lignes || []).map((l, i) => {
    const kmMontant = (parseFloat(l.km) || 0) * BAREME;
    const ligneTotal = kmMontant + (parseFloat(l.peages) || 0) + (parseFloat(l.autres) || 0);
    return `
      <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
        <td>${fmtDate(l.dateDepense)}</td>
        <td>${l.objetDepense || '—'}</td>
        <td class="num">${parseFloat(l.km) || 0} km</td>
        <td class="num">${fmt(kmMontant)} €</td>
        <td class="num">${fmt(l.peages)} €</td>
        <td class="num">${fmt(l.autres)} €</td>
        <td class="num total-cell">${fmt(ligneTotal)} €</td>
      </tr>`;
  }).join('');

  let choixHTML = '';
  if (invoice.choix === 'abandon') {
    const apresImpots = (invoice.totalFrais || 0) * (1 - 0.66);
    choixHTML = `
      <div class="choix-block abandon-block">
        <div class="choix-title">Don au CST (abandon des frais)</div>
        <p class="legal-text">Conformément à l'article 41 de la loi 2000-627 du 6 juillet 2000 modifiant la loi du
        16 juillet 1984 relative à l'organisation et la promotion des activités physiques et sportives, vous
        bénéficiez d'une réduction d'impôts égale à 66&nbsp;% de la somme concernée (dans la limite de 20&nbsp;%
        du revenu imposable). Un reçu fiscal vous sera envoyé.</p>
        <table class="recap-table">
          <tr><td>Montant total abandonné</td><td class="num">${fmt(invoice.totalFrais)} €</td></tr>
          <tr class="highlight-row"><td>Après déduction d'impôts (66%), montant réel dépensé</td><td class="num"><strong>${fmt(apresImpots)} €</strong></td></tr>
        </table>
      </div>`;
  } else if (invoice.choix === 'remboursement') {
    choixHTML = `
      <div class="choix-block remboursement-block">
        <div class="choix-title">Remboursement</div>
        <table class="recap-table">
          <tr><td>Montant à rembourser</td><td class="num"><strong>${fmt(invoice.totalFrais)} €</strong></td></tr>
          ${invoice.iban ? `<tr><td>IBAN</td><td class="mono">${invoice.iban}</td></tr>` : ''}
          ${invoice.bic ? `<tr><td>BIC</td><td class="mono">${invoice.bic}</td></tr>` : ''}
        </table>
      </div>`;
  }

  const justificatifsHTML = (invoice.justificatifs || []).length > 0
    ? `<ul class="justif-list">${invoice.justificatifs.map(j => `<li>${j.split('/').pop()}</li>`).join('')}</ul>`
    : '<p class="empty-note">Aucun justificatif joint.</p>';

  const sigHTML = invoice.signature
    ? `<img src="${invoice.signature}" alt="Signature" class="sig-img"/>`
    : '<div class="sig-placeholder">Signature manquante</div>';

  const refNum = String(invoice._id).slice(-6).toUpperCase();
  const dateCreation = fmtDate(invoice.createdAt);

  return { html: buildDocHTML({ lignesHTML, choixHTML, justificatifsHTML, sigHTML, refNum, dateCreation, invoice, fmt }), refNum };
}

function buildDocHTML({ lignesHTML, choixHTML, justificatifsHTML, sigHTML, refNum, dateCreation, invoice, fmt }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Note de frais — ${invoice.nomDemandeur}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,400&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --ink: #111827; --ink2: #374151; --ink3: #6B7280;
    --gold: #B8860B; --gold-light: #FEF3C7; --gold-border: #D97706;
    --blue: #1E3A5F; --blue-light: #EFF6FF;
    --green: #065F46; --green-light: #ECFDF5;
    --border: #E5E7EB; --bg: #F9FAFB;
  }
  @page { size: A4; margin: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 10pt; color: var(--ink); background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 0; }
  .doc-header { background: var(--blue); color: #fff; padding: 28px 40px 24px; position: relative; overflow: hidden; }
  .doc-header::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, var(--gold-border), #F59E0B, var(--gold-border)); }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .org-name { font-family: 'Playfair Display', serif; font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; color: #fff; }
  .org-name span { color: #FCD34D; font-style: italic; }
  .doc-ref { text-align: right; font-size: 8pt; color: rgba(255,255,255,0.7); line-height: 1.6; }
  .doc-ref strong { color: #FCD34D; font-size: 10pt; display: block; }
  .doc-title { font-size: 14pt; font-weight: 600; color: #fff; letter-spacing: 0.02em; text-transform: uppercase; }
  .doc-date { font-size: 8.5pt; color: rgba(255,255,255,0.65); margin-top: 3px; }
  .doc-body { padding: 32px 40px 40px; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--blue); border-bottom: 2px solid var(--blue); padding-bottom: 5px; margin-bottom: 14px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .info-cell { padding: 10px 14px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .info-cell:nth-child(even) { border-right: none; }
  .info-cell:nth-last-child(-n+2) { border-bottom: none; }
  .info-label { font-size: 7pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink3); margin-bottom: 3px; }
  .info-value { font-size: 10pt; font-weight: 500; color: var(--ink); }
  .badge { display: inline-block; background: var(--gold-light); color: var(--gold); border: 1px solid #FDE68A; font-size: 7.5pt; font-weight: 600; padding: 2px 10px; border-radius: 20px; letter-spacing: 0.04em; }
  .depenses-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .depenses-table thead tr { background: var(--blue); color: #fff; }
  .depenses-table thead th { padding: 8px 10px; text-align: left; font-weight: 600; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
  .depenses-table thead th.num { text-align: right; }
  .depenses-table tbody td { padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .row-even { background: #fff; } .row-odd { background: var(--bg); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .total-cell { font-weight: 600; }
  .bareme-note { font-size: 7.5pt; color: var(--ink3); font-style: italic; margin-top: 6px; padding-left: 4px; }
  .total-band { background: var(--blue); color: #fff; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-radius: 0 0 6px 6px; }
  .total-band .label { font-size: 9pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.8); }
  .total-band .amount { font-family: 'Playfair Display', serif; font-size: 16pt; font-weight: 700; color: #FCD34D; }
  .choix-block { border-radius: 6px; padding: 16px 18px; border: 1px solid; }
  .abandon-block { background: var(--green-light); border-color: #A7F3D0; }
  .remboursement-block { background: var(--blue-light); border-color: #BFDBFE; }
  .choix-title { font-weight: 700; font-size: 10.5pt; margin-bottom: 8px; }
  .abandon-block .choix-title { color: var(--green); }
  .remboursement-block .choix-title { color: var(--blue); }
  .legal-text { font-size: 8pt; color: var(--ink3); line-height: 1.6; margin-bottom: 12px; font-style: italic; }
  .recap-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .recap-table td { padding: 5px 8px; border-bottom: 1px solid rgba(0,0,0,0.06); }
  .recap-table td:first-child { color: var(--ink2); }
  .highlight-row td { font-size: 10.5pt; padding-top: 8px; }
  .mono { font-family: 'Courier New', monospace; font-size: 9pt; letter-spacing: 0.05em; }
  .justif-list { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .justif-list li { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 10px; font-size: 8pt; color: var(--ink2); }
  .justif-list li::before { content: '📎 '; }
  .empty-note { font-size: 8.5pt; color: var(--ink3); font-style: italic; }
  .sig-section { display: flex; justify-content: flex-end; margin-top: 8px; }
  .sig-box { border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; min-width: 220px; text-align: center; }
  .sig-box-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink3); font-weight: 600; margin-bottom: 8px; }
  .sig-img { max-height: 80px; max-width: 200px; display: block; margin: 0 auto; }
  .sig-placeholder { height: 60px; display: flex; align-items: center; justify-content: center; color: var(--ink3); font-size: 8pt; font-style: italic; }
  .doc-footer { border-top: 1px solid var(--border); padding: 14px 40px; display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; color: var(--ink3); background: var(--bg); }
  .doc-footer strong { color: var(--ink2); }
  @media print { body { width: 210mm; } .no-print { display: none !important; } }
  .print-bar { background: var(--blue); padding: 10px 40px; display: flex; gap: 12px; align-items: center; justify-content: flex-end; }
  .btn-dl { background: #FCD34D; color: var(--blue); border: none; border-radius: 6px; padding: 8px 20px; font-family: 'Inter', sans-serif; font-size: 9pt; font-weight: 700; cursor: pointer; letter-spacing: 0.04em; text-decoration: none; display: inline-block; transition: background 0.15s; }
  .btn-dl:hover { background: #F59E0B; }
</style>
</head>
<body>
<div class="print-bar no-print">
  <a class="btn-dl" href="/invoice/${invoice._id}/download">⬇️ Télécharger le PDF</a>
</div>
<div class="doc-header">
  <div class="header-top">
    <div>
      <div class="org-name">Note de <span>Frais</span></div>
      <div class="doc-date">CST — Club Spéléo Troglos</div>
    </div>
    <div class="doc-ref">
      <strong>#${refNum}</strong>
      Émise le ${dateCreation}
    </div>
  </div>
  <div class="doc-title">Demande de remboursement de frais</div>
</div>
<div class="doc-body">
  <div class="section">
    <div class="section-title">Informations du demandeur</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Nom du demandeur</div><div class="info-value">${invoice.nomDemandeur || '—'}</div></div>
      <div class="info-cell"><div class="info-label">Date de la demande</div><div class="info-value">${fmtDate(invoice.dateDemande)}</div></div>
      <div class="info-cell"><div class="info-label">Raison de la dépense</div><div class="info-value">${invoice.raisonDepense || '—'}</div></div>
      <div class="info-cell"><div class="info-label">Budget concerné</div><div class="info-value">${invoice.budget ? `<span class="badge">${invoice.budget}</span>` : '—'}</div></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Détail des dépenses</div>
    <table class="depenses-table">
      <thead><tr><th>Date</th><th>Objet de la dépense</th><th class="num">Km</th><th class="num">Montant km</th><th class="num">Péages / transports</th><th class="num">Autres</th><th class="num">Sous-total</th></tr></thead>
      <tbody>${lignesHTML || '<tr><td colspan="7" style="text-align:center;color:#6B7280;font-style:italic;padding:16px">Aucune dépense enregistrée</td></tr>'}</tbody>
    </table>
    <div class="bareme-note">Barème kilométrique appliqué : 0,606 €/km</div>
    <div class="total-band"><span class="label">Total des frais</span><span class="amount">${fmt(invoice.totalFrais)} €</span></div>
  </div>
  <div class="section">
    <div class="section-title">Traitement des frais</div>
    ${choixHTML || '<p class="empty-note">Aucun choix effectué.</p>'}
  </div>
  <div class="section">
    <div class="section-title">Justificatifs joints</div>
    ${justificatifsHTML}
  </div>
  <div class="section">
    <div class="section-title">Signature du demandeur</div>
    <div class="sig-section">
      <div class="sig-box">
        <div class="sig-box-label">Signature</div>
        ${sigHTML}
      </div>
    </div>
  </div>
</div>
<div class="doc-footer">
  <span>CST — Club Spéléo Troglos &nbsp;|&nbsp; <strong>tresorier@troglos.fr</strong></span>
  <span>Référence : <strong>#${refNum}</strong> &nbsp;|&nbsp; Généré le ${new Date().toLocaleDateString('fr-FR')}</span>
</div>
</body>
</html>`;
}

// Utilitaire : lit un fichier image et retourne son data URL base64
async function imageToDataURL(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', bmp: 'image/bmp' };
  const mime = mimeMap[ext] || 'image/jpeg';
  const buf = await fs.readFile(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// PREVIEW HTML A4
app.get('/invoice/:id/preview', isAuth, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!invoice) return res.status(404).send('Facture introuvable');
    const { html } = buildInvoiceHTML(invoice);
    res.send(html);
  } catch (err) {
    res.status(500).send('Erreur : ' + err.message);
  }
});

// TÉLÉCHARGEMENT PDF COMPLET (note de frais + justificatifs)
app.get('/invoice/:id/download', isAuth, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!invoice) return res.status(404).send('Facture introuvable');

    const puppeteer = require('puppeteer');
    const { PDFDocument } = require('pdf-lib');

    const { html, refNum } = buildInvoiceHTML(invoice);

    // 1. Générer le PDF de la note de frais via Puppeteer
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const mainPdfBytes = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    await browser.close();

    // 2. Fusionner avec les justificatifs
    const merged = await PDFDocument.create();

    // Ajouter les pages de la note de frais
    const mainDoc = await PDFDocument.load(mainPdfBytes);
    const mainPages = await merged.copyPages(mainDoc, mainDoc.getPageIndices());
    mainPages.forEach(p => merged.addPage(p));

    // Ajouter chaque justificatif
    for (const justifPath of invoice.justificatifs || []) {
      const fullPath = path.join(__dirname, 'public', justifPath);
      const ext = path.extname(justifPath).toLowerCase();

      try {
        if (ext === '.pdf') {
          // Justificatif PDF : copier ses pages directement
          const justifBytes = await fs.readFile(fullPath);
          const justifDoc = await PDFDocument.load(justifBytes, { ignoreEncryption: true });
          const pages = await merged.copyPages(justifDoc, justifDoc.getPageIndices());
          pages.forEach(p => merged.addPage(p));

        } else {
          // Justificatif image : l'intégrer dans une page A4
          const imgBytes = await fs.readFile(fullPath);
          const imgPage = merged.addPage([595.28, 841.89]); // A4 en points
          const W = imgPage.getWidth();
          const H = imgPage.getHeight();
          const margin = 40;

          let embeddedImg;
          if (ext === '.png') {
            embeddedImg = await merged.embedPng(imgBytes);
          } else {
            // jpg, jpeg, webp, heic, bmp → tenter jpg
            embeddedImg = await merged.embedJpg(imgBytes);
          }

          const { width: iw, height: ih } = embeddedImg.scale(1);
          const maxW = W - margin * 2;
          const maxH = H - margin * 2;
          const scale = Math.min(maxW / iw, maxH / ih, 1);
          const dw = iw * scale;
          const dh = ih * scale;
          const x = (W - dw) / 2;
          const y = (H - dh) / 2;

          imgPage.drawImage(embeddedImg, { x, y, width: dw, height: dh });
        }
      } catch (justifErr) {
        console.warn(`⚠️ Justificatif ignoré (${justifPath}) :`, justifErr.message);
      }
    }

    const finalPdfBytes = await merged.save();
    const filename = `note-de-frais-${refNum}-${invoice.nomDemandeur.replace(/\s+/g, '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(finalPdfBytes));

  } catch (err) {
    console.error('❌ Erreur génération PDF :', err);
    res.status(500).send('Erreur lors de la génération du PDF : ' + err.message);
  }
});


app.get("/", (req, res) => { res.render("index"); });

app.listen(PORT, () => {
 console.log(`
╔════════════════════════════════════════════════╗
║   🧾 GÉNÉRATEUR DE NOTE DE FRAIS TROGLOS     ║
╚════════════════════════════════════════════════╝

✅ Serveur démarré avec succès !
🌐 URL: http://localhost:${PORT}
📁 Dossier factures: ./generated-invoices/

💡 Appuyez sur Ctrl+C pour arrêter le serveur
    `);});

    //test export

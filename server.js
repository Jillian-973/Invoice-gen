const express = require("express");
const puppeteer = require("puppeteer");
const path = require("path");
const multer = require("multer");
const session = require("express-session");
const bcrypt = require("bcrypt");
const fs = require("fs").promises;

require("dotenv").config();
const mongoose = require("mongoose");
const MongoStore = require('connect-mongo').default;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI, {
  tls: true,
  tlsAllowInvalidCertificates: true,
}).then(() => console.log('✅ MongoDB connecté'))
  .catch(err => console.error('❌ Erreur MongoDB:', err));

// Schéma Utilisateur
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  },
  { timestamps: true },
);
const User = mongoose.model("User", userSchema);

// Schéma Facture
const invoiceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    montant: { type: Number, required: true },
  },
  { timestamps: true },
);
const Invoice = mongoose.model("Invoice", invoiceSchema);

//SESSION UTILISATEUR
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI
  }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const existing = await User.findOne({ email });
  if (existing) return res.status(400).send("Email déjà utilisé");
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({ email, password: hashedPassword });
  res.send("Utilisateur créé");
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.send('Utilisateur introuvable');
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.send('Mot de passe incorrect');
  req.session.userId = user._id;  // ← _id MongoDB, plus Date.now()
  res.send('Connecté');
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.send("Déconnecté");
});

function isAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.send("Non autorisé");
  }
}

app.get("/admin", isAuth, (req, res) => {
  res.send("Zone admin");
});

//FACTURE UTILISATEUR

app.post('/invoice', isAuth, async (req, res) => {
  const { montant } = req.body;
  await Invoice.create({ userId: req.session.userId, montant });
  res.send('Facture créée');
});

// GET INVOICES
app.get('/my-invoices', isAuth, async (req, res) => {
  const userInvoices = await Invoice.find({ userId: req.session.userId }).sort({ createdAt: -1 });
  res.json(userInvoices);
});

// Route principale - Afficher le formulaire
app.get("/", (req, res) => {
  res.render("index");
});

/*
// Créer le dossier uploads s'il n'existe pas
const initDirectories = async () => {
  const dirs = ['public/uploads', 'generated-invoices'];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Erreur lors de la création du dossier ${dir}:`, error);
    }
  }
};*/

// Initialiser les dossiers et démarrer le serveur
//initDirectories().then(() => {
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║   🧾 GÉNÉRATEUR DE FACTURES PROFESSIONNEL     ║
╚════════════════════════════════════════════════╝

✅ Serveur démarré avec succès !
🌐 URL: http://localhost:${PORT}
📁 Dossier factures: ./generated-invoices/

📋 Fonctionnalités:
   • Téléchargement direct

💡 Appuyez sur Ctrl+C pour arrêter le serveur
    `);
});
//});

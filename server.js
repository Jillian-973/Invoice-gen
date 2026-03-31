const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;
let users = [];
let invoices = [];

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
/*app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
*/

//SESSION UTILISATEUR
app.use(session({
  secret: 'secret123',
  resave: false,
  saveUninitialized: false,
}));

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // hash du mot de passe
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = {
    id: Date.now(),
    email,
    password: hashedPassword
  };

  users.push(user);

  res.send('Utilisateur créé');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email === email);

  if (!user) return res.send('Utilisateur introuvable');

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) return res.send('Mot de passe incorrect');

  // créer session
  req.session.userId = user.id;

  res.send('Connecté');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.send('Déconnecté');
});

function isAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.send('Non autorisé');
  }
}

app.get('/admin', isAuth, (req, res) => {
  res.send('Zone admin');
});

//FACTURE UTILISATEUR
app.post('/invoice', isAuth, (req, res) => {
  const { montant } = req.body;

  const invoice = {
    id: Date.now(),
    userId: req.session.userId,
    montant
  };

  invoices.push(invoice);

  res.send('Facture créée');
});

app.get('/my-invoices', isAuth, (req, res) => {
  const userInvoices = invoices.filter(
    inv => inv.userId === req.session.userId
  );

  res.json(userInvoices);
});

app.get('/my-invoices', isAuth, (req, res) => {
  const userInvoices = invoices.filter(
    inv => inv.userId === req.session.userId
  );

  res.json(userInvoices);
});


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
};

// Route principale - Afficher le formulaire
app.get('/', (req, res) => {
  res.render('index');
});
// Initialiser les dossiers et démarrer le serveur
initDirectories().then(() => {
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
});
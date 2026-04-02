# 🧾 Invoice Generator — Note de frais

Application web de gestion de notes de frais. Elle permet aux utilisateurs de créer, consulter, télécharger et envoyer par e-mail des notes de frais au format PDF.

---

## ✨ Fonctionnalités

- Authentification (inscription / connexion) avec mot de passe hashé (bcrypt)
- Création de notes de frais avec lignes de dépenses (km, péages, autres)
- Upload de justificatifs
- Génération de PDF (via Puppeteer)
- Envoi par e-mail (via Nodemailer / SMTP)
- Historique des notes de frais par utilisateur
- Sessions persistantes stockées en MongoDB

---

## 🛠 Stack technique

| Couche       | Technologie                        |
|--------------|------------------------------------|
| Serveur      | Node.js + Express 5                |
| Base de données | MongoDB + Mongoose              |
| Sessions     | express-session + connect-mongo    |
| Templates    | EJS                                |
| PDF          | Puppeteer + pdf-lib                |
| E-mail       | Nodemailer                         |
| Upload       | Multer                             |
| Auth         | bcrypt                             |

---

## 🚀 Installation

### 1. Cloner le projet

```bash
git clone <url-du-repo>
cd Invoice-gen-master
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

Créer un fichier **`.env`** à la racine du projet :

```dotenv
MONGO_URI=votre_uri_mongodb
SESSION_SECRET=unSecretBienLong123
PORT=3000

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre@gmail.com
SMTP_PASS=votre_mot_de_passe_application
```

> **⚠️ Ne commitez jamais ce fichier.** Il est déjà listé dans le `.gitignore`.

---

## 🔑 Comment obtenir chaque valeur

### `MONGO_URI` — URI de connexion MongoDB Atlas

1. Créez un compte sur [mongodb.com](https://www.mongodb.com/cloud/atlas)
2. Créez un **cluster gratuit** (M0 Free Tier)
3. Dans **Database Access**, ajoutez un utilisateur avec un mot de passe
4. Dans **Network Access**, autorisez votre IP (ou `0.0.0.0/0` pour tout autoriser)
5. Cliquez sur **Connect** → **Drivers** → copiez la chaîne de connexion
6. Remplacez `<password>` par le mot de passe de votre utilisateur

```
mongodb+srv://<user>:<password>@mycluster.xxxxx.mongodb.net/
```

---

### `SESSION_SECRET` — Clé secrète des sessions

Une chaîne longue et aléatoire de votre choix. Vous pouvez en générer une dans votre terminal :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### `SMTP_USER` et `SMTP_PASS` — Envoi d'e-mails via Gmail

L'application utilise un **mot de passe d'application** Gmail (et non votre vrai mot de passe).

1. Activez la **validation en deux étapes** sur votre compte Google : [myaccount.google.com/security](https://myaccount.google.com/security)
2. Allez dans **Mots de passe des applications** : [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Choisissez **Autre (nom personnalisé)**, nommez-le (ex: `invoice-app`)
4. Copiez le mot de passe généré (16 caractères, ex: `ybqd qygd zygl oxmk`)
5. Collez-le dans `SMTP_PASS`

> `SMTP_HOST`, `SMTP_PORT` et `SMTP_SECURE` n'ont pas besoin d'être modifiés si vous utilisez Gmail.

---

## ▶️ Lancement

```bash
npm start
```

L'application sera accessible sur [http://localhost:3000](http://localhost:3000)

---

## 📁 Structure du projet

```
Invoice-gen-master/
├── server.js          # Serveur Express, routes et logique métier
├── views/
│   └── index.ejs      # Interface utilisateur (template EJS)
├── public/
│   └── uploads/       # Justificatifs uploadés (généré automatiquement)
├── package.json
├── .env               # Variables d'environnement (à créer, ne pas commiter)
└── .gitignore
```

---

## 🔐 Routes principales

| Méthode | Route                      | Description                        |
|---------|----------------------------|------------------------------------|
| `POST`  | `/register`                | Créer un compte                    |
| `POST`  | `/login`                   | Se connecter                       |
| `GET`   | `/logout`                  | Se déconnecter                     |
| `POST`  | `/invoice`                 | Créer une note de frais            |
| `GET`   | `/my-invoices`             | Lister ses notes de frais          |
| `DELETE`| `/invoice/:id`             | Supprimer une note de frais        |
| `GET`   | `/invoice/:id/preview`     | Prévisualiser le PDF               |
| `GET`   | `/invoice/:id/download`    | Télécharger le PDF                 |

const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

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
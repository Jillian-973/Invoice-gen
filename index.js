const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setContent("<h1>Helloo PDF</h1>");

  await page.pdf({
    path: "test.pdf",
    format: "A4",
    printBackground: true
  });

  await browser.close();
})();
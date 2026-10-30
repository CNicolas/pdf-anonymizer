
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";

async function redactPDF(inputFile, outputFile, words) {
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Fichier introuvable : ${inputFile}`);
  }

  if (path.resolve(inputFile) === path.resolve(outputFile)) {
    throw new Error("Le fichier source et le fichier de sortie doivent être différents.");
  }

  const targets = words.filter(word => word.trim().length > 0);

  if (targets.length === 0) {
    throw new Error("Aucun mot à rechercher.");
  }

  console.log("Chargement du PDF...");

  const fileData = new Uint8Array(fs.readFileSync(inputFile));

  const document = mupdf.Document.openDocument(
      fileData,
      "application/pdf"
  );

  try {
    const pdfDocument = document.asPDF();
    const pageCount = pdfDocument.countPages();

    console.log(`Nombre de pages : ${pageCount}`);
    console.log(`Termes recherchés : ${targets.join(", ")}`);

    let totalRedactions = 0;

    for (let pageNumber = 0; pageNumber < pageCount; pageNumber++) {
      const page = pdfDocument.loadPage(pageNumber);

      try {
        console.log(
            `Traitement de la page ${pageNumber + 1}/${pageCount}...`
        );

        let pageRedactions = 0;

        for (const word of targets) {
          // Recherche insensible à la casse et aux accents
          const hits = page.search(
              word,
              "ignore-case,ignore-diacritics"
          );

          for (const hit of hits) {
            // Création d'une véritable annotation de caviardage
            const annotation = page.createAnnotation("Redact");

            // Position exacte de chaque caractère trouvé
            annotation.setQuadPoints(hit);

            annotation.update();

            pageRedactions++;
            totalRedactions++;
          }
        }

        if (pageRedactions > 0) {
          // Application définitive des caviardages
          page.applyRedactions(
              true,
              mupdf.PDFPage.REDACT_IMAGE_PIXELS,
              mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,
              mupdf.PDFPage.REDACT_TEXT_REMOVE
          );
        }

        console.log(
            `  ${pageRedactions} occurrence(s) caviardée(s)`
        );

      } finally {
        page.destroy();
      }
    }

    console.log("Enregistrement du PDF...");

    // Sauvegarde complète du document modifié
    const outputBuffer = pdfDocument.saveToBuffer("");

    fs.writeFileSync(
        outputFile,
        outputBuffer.asUint8Array()
    );

    console.log("\nTerminé !");
    console.log(`Occurrences caviardées : ${totalRedactions}`);
    console.log(`Fichier créé : ${outputFile}`);

  } finally {
    document.destroy();
  }
}

// Arguments de la ligne de commande
const [, , inputFile, outputFile, ...words] = process.argv;

if (!inputFile || !outputFile || words.length === 0) {
  console.log(`
Utilisation :

node redact.mjs entree.pdf sortie.pdf "Jean" "Dupont" "75000"
  `);

  process.exit(1);
}

redactPDF(inputFile, outputFile, words).catch(error => {
  console.error("Erreur :", error);
  process.exitCode = 1;
});

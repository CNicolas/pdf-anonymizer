import fs from "node:fs";
import path from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";

// Compatibilité PDF.js / Node.js
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

const SCALE = 2.5; // Résolution du PDF final
const BLACK = "#000000";

// Normalisation : ignore les accents et la casse
function normalize(value) {
  return value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("fr");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Vérifie si un élément contient un des termes recherchés
function containsTarget(text, targets) {
  const normalized = normalize(text);

  return targets.some(target => {
    const escaped = escapeRegex(target);

    // Frontières de mots : évite de trouver "Jean" dans "Jeanne"
    const regex = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
        "u"
    );

    return regex.test(normalized);
  });
}

async function redactPDF(inputFile, outputFile, words) {
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Fichier introuvable : ${inputFile}`);
  }

  if (path.resolve(inputFile) === path.resolve(outputFile)) {
    throw new Error("Le fichier source et le fichier de sortie doivent être différents.");
  }

  const targets = words.map(normalize).filter(Boolean);

  if (targets.length === 0) {
    throw new Error("Aucun mot à rechercher.");
  }

  console.log("Chargement du PDF...");

  const data = new Uint8Array(fs.readFileSync(inputFile));

  const loadingTask = pdfjsLib.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false
  });

  const pdf = await loadingTask.promise;

  console.log(`Nombre de pages : ${pdf.numPages}`);
  console.log(`Termes recherchés : ${words.join(", ")}`);

  // Nouveau PDF, sans aucune donnée textuelle d'origine
  const output = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: {
      Title: "Document anonymisé",
      Author: "Local PDF anonymizer"
    }
  });

  const outputStream = fs.createWriteStream(outputFile);
  output.pipe(outputStream);

  let totalRedactions = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    console.log(`Traitement de la page ${pageNumber}/${pdf.numPages}...`);

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: SCALE });

    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    // Fond blanc
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);

    // Rendu de la page
    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    // Extraction du texte et de ses positions
    const textContent = await page.getTextContent();

    let pageRedactions = 0;

    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;

      if (!containsTarget(item.str, targets)) continue;

      // Conversion des coordonnées PDF vers les coordonnées canvas
      const transform = pdfjsLib.Util.transform(
          viewport.transform,
          item.transform
      );

      const x = transform[4];
      const baseline = transform[5];
      const fontHeight = Math.hypot(transform[2], transform[3]);
      const itemWidth = item.width * SCALE;

      // Marge de sécurité autour du texte
      const margin = Math.max(2, fontHeight * 0.12);

      const rectX = x - margin;
      const rectY = baseline - fontHeight - margin;
      const rectWidth = itemWidth + margin * 2;
      const rectHeight = fontHeight + margin * 2;

      // Caviardage réel sur l'image
      context.fillStyle = BLACK;
      context.fillRect(
          rectX,
          rectY,
          rectWidth,
          rectHeight
      );

      pageRedactions++;
      totalRedactions++;
    }

    console.log(`  ${pageRedactions} élément(s) caviardé(s)`);

    // Conversion en image PNG
    const imageBuffer = canvas.toBuffer("image/png");

    // Ajout de la page sous forme d'image uniquement
    output.addPage({
      size: [width, height],
      margin: 0
    });

    output.image(imageBuffer, 0, 0, {
      width,
      height
    });

    page.cleanup();
  }

  output.end();

  await new Promise((resolve, reject) => {
    outputStream.on("finish", resolve);
    outputStream.on("error", reject);
  });

  await loadingTask.destroy();

  console.log("\nTerminé !");
  console.log(`Éléments caviardés : ${totalRedactions}`);
  console.log(`Fichier créé : ${outputFile}`);
}

const [, , inputFile, outputFile, ...words] = process.argv;

if (!inputFile || !outputFile || words.length === 0) {
  console.log(`
Utilisation :

node redact.mjs entree.pdf sortie.pdf "Jean" "Dupont" "75000"

Les termes sont recherchés sans distinction de casse ni d'accent.
  `);
  process.exit(1);
}

redactPDF(inputFile, outputFile, words).catch(error => {
  console.error("Erreur :", error);
  process.exit(1);
});
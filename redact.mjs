import fs from "node:fs";
import path from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";

// PDF.js / Node.js compatibility
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

const SCALE = 2.5; // Résolution du PDF final
const BLACK = "#000000";

// Normalisation: ignores diacritics and case
function normalize(value) {
  return value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("fr");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Checks whether an element contains any of the search terms
function containsTarget(text, targets) {
  const normalized = normalize(text);

  return targets.some(target => {
    const escaped = escapeRegex(target);

    // Word boundaries: prevents ‘Jean’ from being found in ‘Jeanne’
    const regex = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
        "u"
    );

    return regex.test(normalized);
  });
}

async function redactPDF(inputFile, outputFile, words) {
  if (!fs.existsSync(inputFile)) {
    throw new Error(`File not found: ${inputFile}`);
  }

  if (path.resolve(inputFile) === path.resolve(outputFile)) {
    throw new Error("The source file and the output file must be different.");
  }

  const targets = words.map(normalize).filter(Boolean);

  if (targets.length === 0) {
    throw new Error("No words to search for.");
  }

  console.log("Loading the PDF... ");

  const data = new Uint8Array(fs.readFileSync(inputFile));

  const loadingTask = pdfjsLib.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false
  });

  const pdf = await loadingTask.promise;

  console.log(`Number of pages: ${pdf.numPages}`);
  console.log(`Search terms: ${words.join(", ")}`);

  // New PDF, with no original text data
  const output = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: {
      Title: "Anonymized Document",
      Author: "Local PDF anonymizer"
    }
  });

  const outputStream = fs.createWriteStream(outputFile);
  output.pipe(outputStream);

  let totalRedactions = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    console.log(`Processing page ${pageNumber}/${pdf.numPages}...`);

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: SCALE });

    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    // White background
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);

    // Render the page
    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    // Extract text and its positions
    const textContent = await page.getTextContent();

    let pageRedactions = 0;

    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;

      if (!containsTarget(item.str, targets)) continue;

      // Convert PDF coordinates to canvas coordinates
      const transform = pdfjsLib.Util.transform(
          viewport.transform,
          item.transform
      );

      const x = transform[4];
      const baseline = transform[5];
      const fontHeight = Math.hypot(transform[2], transform[3]);
      const itemWidth = item.width * SCALE;

      // Safety margin around the text
      const margin = Math.max(2, fontHeight * 0.12);

      const rectX = x - margin;
      const rectY = baseline - fontHeight - margin;
      const rectWidth = itemWidth + margin * 2;
      const rectHeight = fontHeight + margin * 2;

      // Actual redaction on the image
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

    console.log(`  ${pageRedactions} redacted item(s)`);

    // Convert to PNG image
    const imageBuffer = canvas.toBuffer("image/png");

    // Add the page as an image only
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

  if (typeof loadingTask.destroy === "function") {
    await loadingTask.destroy();
  } else {
    pdf.destroy();
  }

  console.log("\nThe end !");
  console.log(`Redacted words : ${totalRedactions}`);
  console.log(`Created file : ${outputFile}`);
}

const [, , inputFile, outputFile, ...words] = process.argv;

if (!inputFile || !outputFile || words.length === 0) {
  console.log(`
Usage:

node redact.mjs input.pdf output.pdf “Jean” ‘Dupont’ “75000”

Terms are searched for without regard to case or accents.
  `);
  process.exit(1);
}

redactPDF(inputFile, outputFile, words).catch(error => {
  console.error("Error :", error);
  process.exit(1);
});
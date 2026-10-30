# PDF Anonymizer

A local JavaScript tool to redact specified words from PDF documents.

All PDF processing is performed locally on your computer. No document or personal information is uploaded to any external service.

## Installation

Install [Node.js](https://nodejs.org/) on your computer.

Then, open a terminal in the project folder and run:

```bash
npm install
```

## Usage

Place the PDF file in the same folder as `redact.mjs` and execute:

```bash
node redact.mjs document.pdf document_anonymise.pdf "Jean" "Dupont" "75000" "adresse@example.com"
```

### Parameters

- `document.pdf`: Name of the original PDF file.
- `document_anonymise.pdf`: Name of the output PDF file.
- `"Jean"`, `"Dupont"`, `"75000"`, etc.: Words or expressions to be removed from the PDF.

You can specify as many words or expressions as needed.

Search is case-insensitive and accent-insensitive.

## Output

The generated PDF contains the original pages as images, with matching text elements covered by black rectangles.

The original text layer is not preserved, making the redaction irreversible through ordinary PDF text extraction.

**Note:** Scanned documents and personal information embedded in images are not automatically detected. Always review the output PDF before sharing it.

## Privacy

- No external API is used.
- No PDF content is uploaded.
- All processing takes place locally on your computer.

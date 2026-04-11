---
name: pdf-reader
description: Extract and read text content from PDF files. Use when user needs to read PDF content, extract text from PDF, analyze PDF documents, or get information about PDF files. Supports page range selection and text output to file.
---

# PDF Reader

Extract text content from PDF files using pdfplumber.

## Quick Start

```bash
# Read entire PDF
python scripts/read_pdf.py /path/to/document.pdf

# Read specific pages
python scripts/read_pdf.py /path/to/document.pdf --pages 1-10

# Save to file
python scripts/read_pdf.py /path/to/document.pdf --output output.txt

# Get PDF info
python scripts/read_pdf.py /path/to/document.pdf --info
```

## Features

- Extract text from all pages or specific page range
- Preserve page structure with page markers
- Output to file or console
- Get PDF metadata (page count, author, title, etc.)

## Dependencies

```bash
pip install pdfplumber
```

## Notes

- Works best with text-based PDFs (not scanned images)
- For scanned PDFs, OCR would be needed (not included)
- Chinese and other languages are supported

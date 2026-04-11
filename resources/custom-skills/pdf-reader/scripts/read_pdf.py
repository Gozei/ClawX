#!/usr/bin/env python3
"""
PDF Reader Script
Extracts text content from PDF files

Usage:
    python read_pdf.py <pdf_file> [--pages <start>-<end>] [--output <file>]
    
Examples:
    python read_pdf.py document.pdf
    python read_pdf.py document.pdf --pages 1-10
    python read_pdf.py document.pdf --output output.txt
"""

import sys
import argparse

try:
    import pdfplumber
except ImportError:
    print("Error: pdfplumber not installed. Run: pip install pdfplumber")
    sys.exit(1)


def extract_text(pdf_path, pages=None, output_file=None):
    """Extract text from PDF file."""
    text_content = []
    
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        
        # Determine page range
        if pages:
            start, end = map(int, pages.split('-'))
            start = max(1, start) - 1  # Convert to 0-indexed
            end = min(total_pages, end)
            page_range = range(start, end)
        else:
            page_range = range(total_pages)
        
        for i in page_range:
            page = pdf.pages[i]
            text = page.extract_text()
            if text:
                text_content.append(f"--- Page {i + 1} ---\n{text}")
    
    result = "\n\n".join(text_content)
    
    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(result)
        print(f"Text extracted to: {output_file}")
    else:
        print(result)
    
    return result


def get_info(pdf_path):
    """Get PDF metadata and page count."""
    with pdfplumber.open(pdf_path) as pdf:
        info = {
            'pages': len(pdf.pages),
            'metadata': pdf.metadata
        }
        return info


def main():
    parser = argparse.ArgumentParser(description='Extract text from PDF files')
    parser.add_argument('pdf_file', help='Path to PDF file')
    parser.add_argument('--pages', help='Page range (e.g., 1-10)')
    parser.add_argument('--output', '-o', help='Output file path')
    parser.add_argument('--info', action='store_true', help='Show PDF info only')
    
    args = parser.parse_args()
    
    if args.info:
        info = get_info(args.pdf_file)
        print(f"Pages: {info['pages']}")
        if info['metadata']:
            for key, value in info['metadata'].items():
                if value:
                    print(f"{key}: {value}")
    else:
        extract_text(args.pdf_file, args.pages, args.output)


if __name__ == '__main__':
    main()

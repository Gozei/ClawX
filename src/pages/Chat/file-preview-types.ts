export type FilePreviewOutlineItem = {
  id: string;
  text: string;
  level: number;
  isBold?: boolean;
};

export type FilePreviewUnavailableReasonCode =
  | 'missingPath'
  | 'tooLarge'
  | 'legacyOffice'
  | 'unsupported';

export type PresentationRenderMode = 'html' | 'image';

export type FilePreviewPayload =
  | {
      kind: 'image';
      fileName: string;
      mimeType: string;
      fileSize: number;
      src: string;
    }
  | {
      kind: 'pdf';
      fileName: string;
      mimeType: string;
      fileSize: number;
      src: string;
    }
  | {
      kind: 'markdown';
      fileName: string;
      mimeType: string;
      fileSize: number;
      content: string;
      truncated: boolean;
    }
  | {
      kind: 'text';
      fileName: string;
      mimeType: string;
      fileSize: number;
      content: string;
      truncated: boolean;
    }
  | {
      kind: 'code';
      fileName: string;
      mimeType: string;
      fileSize: number;
      content: string;
      truncated: boolean;
      language?: string;
    }
  | {
      kind: 'docx';
      fileName: string;
      mimeType: string;
      fileSize: number;
      html: string;
      outline: FilePreviewOutlineItem[];
      warnings: string[];
    }
  | {
      kind: 'spreadsheet';
      fileName: string;
      mimeType: string;
      fileSize: number;
      sheets: Array<{
        name: string;
        rows: string[][];
        rowCount: number;
        columnCount: number;
        truncatedRows: boolean;
        truncatedColumns: boolean;
      }>;
      truncatedSheets: boolean;
    }
  | {
      kind: 'presentation';
      fileName: string;
      mimeType: string;
      fileSize: number;
      previewId?: string;
      renderMode?: PresentationRenderMode;
      slideWidth?: number;
      slideHeight?: number;
      slides: Array<{
        index: number;
        title: string;
        paragraphs: string[];
        truncatedParagraphs: boolean;
      }>;
      truncatedSlides: boolean;
    }
  | {
      kind: 'unavailable';
      fileName: string;
      mimeType: string;
      fileSize: number;
      reasonCode: FilePreviewUnavailableReasonCode;
    };

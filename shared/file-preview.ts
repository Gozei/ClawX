export type FilePreviewWindowRequest = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  filePath?: string;
  slideIndex?: number;
};

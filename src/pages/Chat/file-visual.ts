import { Music, FileArchive, File, FileText, FileImage } from 'lucide-react';

function getFileExtension(fileName?: string): string {
  const ext = fileName?.split('.').pop()?.trim();
  if (!ext) return 'FILE';
  return ext.slice(0, 4).toUpperCase();
}

export function getFileVisual(mimeType: string, fileName?: string): {
  ext: string;
  label: string;
  accentClassName: string;
  badgeClassName: string;
  Icon: typeof File;
} {
  const t = mimeType.toLowerCase();
  const n = (fileName || '').toLowerCase();
  const ext = getFileExtension(fileName);

  if (t.startsWith('image/') || t.startsWith('video/') || n.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm)$/i)) {
    return {
      ext,
      label: t.startsWith('video/') || n.match(/\.(mp4|mov|avi|webm)$/i) ? '视频文件' : '图片文件',
      accentClassName: 'bg-violet-500/12 text-violet-600 ring-violet-500/15 dark:text-violet-300',
      badgeClassName: 'bg-violet-500 text-white',
      Icon: FileImage,
    };
  }
  if (t.startsWith('audio/') || n.match(/\.(mp3|wav|ogg|m4a)$/i)) {
    return {
      ext,
      label: '音频文件',
      accentClassName: 'bg-amber-500/12 text-amber-600 ring-amber-500/15 dark:text-amber-300',
      badgeClassName: 'bg-amber-500 text-white',
      Icon: Music,
    };
  }
  if (t.includes('pdf') || n.endsWith('.pdf')) {
    return {
      ext: 'PDF',
      label: 'PDF 文档',
      accentClassName: 'bg-red-500/12 text-red-600 ring-red-500/15 dark:text-red-300',
      badgeClassName: 'bg-red-500 text-white',
      Icon: FileText,
    };
  }
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv') || n.match(/\.(xls|xlsx|csv)$/i)) {
    return {
      ext: n.endsWith('.csv') ? 'CSV' : 'XLS',
      label: '表格文件',
      accentClassName: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/15 dark:text-emerald-300',
      badgeClassName: 'bg-emerald-500 text-white',
      Icon: FileText,
    };
  }
  if (t.includes('presentation') || t.includes('powerpoint') || n.match(/\.(ppt|pptx)$/i)) {
    return {
      ext: 'PPT',
      label: '演示文件',
      accentClassName: 'bg-orange-500/12 text-orange-600 ring-orange-500/15 dark:text-orange-300',
      badgeClassName: 'bg-orange-500 text-white',
      Icon: FileText,
    };
  }
  if (t.includes('wordprocessing') || t.includes('msword') || t.includes('document') || n.match(/\.(doc|docx)$/i)) {
    return {
      ext: 'DOC',
      label: '文档文件',
      accentClassName: 'bg-sky-500/12 text-sky-600 ring-sky-500/15 dark:text-sky-300',
      badgeClassName: 'bg-sky-500 text-white',
      Icon: FileText,
    };
  }
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml' || n.match(/\.(txt|json|xml|md|csv|log)$/i)) {
    return {
      ext,
      label: ext === 'MD' ? 'Markdown 文件' : '文本文件',
      accentClassName: 'bg-slate-500/12 text-slate-600 ring-slate-500/15 dark:text-slate-300',
      badgeClassName: 'bg-slate-600 text-white dark:bg-slate-500',
      Icon: FileText,
    };
  }
  if (t.includes('zip') || t.includes('compressed') || t.includes('archive') || t.includes('tar') || t.includes('rar') || t.includes('7z') || n.match(/\.(zip|rar|7z|tar|gz)$/i)) {
    return {
      ext,
      label: '压缩文件',
      accentClassName: 'bg-pink-500/12 text-pink-600 ring-pink-500/15 dark:text-pink-300',
      badgeClassName: 'bg-pink-500 text-white',
      Icon: FileArchive,
    };
  }

  return {
    ext,
    label: '文件',
    accentClassName: 'bg-slate-400/12 text-slate-500 ring-slate-400/15 dark:text-slate-300',
    badgeClassName: 'bg-slate-500 text-white dark:bg-slate-400',
    Icon: File,
  };
}

import { MarkdownRenderer } from '@/pages/Chat/MarkdownRenderer';
import { useTranslation } from 'react-i18next';

type SkillDetailMarkdownContentProps = {
  content?: string;
};

function stripSkillFrontmatter(content?: string): string {
  const normalized = (content || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith('---\n')) {
    return normalized;
  }

  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return normalized;
  }

  const frontmatter = match[1];
  if (!/^\s*[A-Za-z][\w-]*\s*:/m.test(frontmatter)) {
    return normalized;
  }

  return match[2].trim();
}

export function SkillDetailMarkdownContent({ content }: SkillDetailMarkdownContentProps) {
  const { t } = useTranslation('skills');
  const normalizedContent = stripSkillFrontmatter(content);

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <div className="prose prose-slate prose-sm max-w-none break-words [overflow-wrap:anywhere] prose-headings:font-semibold dark:prose-invert dark:prose-p:text-white/70 [&_img]:max-w-full [&_img]:h-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden [&_code]:break-all [&_table]:w-full [&_table]:table-fixed [&_table]:overflow-x-hidden [&_td]:break-words [&_th]:break-words">
        <MarkdownRenderer content={normalizedContent || `*${t('detail.noDocumentation')}*`} />
      </div>
    </div>
  );
}

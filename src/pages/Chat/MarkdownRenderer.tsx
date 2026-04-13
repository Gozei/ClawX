import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentProps } from 'react';

type MarkdownComponents = NonNullable<ComponentProps<typeof ReactMarkdown>['components']>;

export function MarkdownRenderer({
  content,
  components,
}: {
  content: string;
  components?: MarkdownComponents;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

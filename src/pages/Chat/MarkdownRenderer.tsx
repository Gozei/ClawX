import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentProps } from 'react';

export type MarkdownComponents = NonNullable<ComponentProps<typeof ReactMarkdown>['components']>;

/** 仅封装 react-markdown；聊天区等场景的样式与 code/pre 行为由传入的 components 或外层 `.chat-markdown` CSS 负责。 */
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

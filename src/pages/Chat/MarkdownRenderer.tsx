import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentProps, MouseEvent } from 'react';
import { normalizeExternalHttpUrl } from './markdown-links';

export type MarkdownComponents = NonNullable<ComponentProps<typeof ReactMarkdown>['components']>;

const defaultMarkdownComponents: MarkdownComponents = {
  a({ href, children, node: _node, ...props }) {
    const externalHref = normalizeExternalHttpUrl(href) ?? undefined;

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (!externalHref) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      void window.electron?.openExternal?.(externalHref);
    };

    return (
      <a
        {...props}
        href={externalHref}
        target={externalHref ? '_blank' : undefined}
        rel={externalHref ? 'noopener noreferrer' : undefined}
        onClick={handleClick}
      >
        {children}
      </a>
    );
  },
};

/** 仅封装 react-markdown；聊天区等场景的样式与 code/pre 行为由传入的 components 或外层 `.chat-markdown` CSS 负责。 */
export function MarkdownRenderer({
  content,
  components,
}: {
  content: string;
  components?: MarkdownComponents;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => url}
      components={{ ...defaultMarkdownComponents, ...components }}
    >
      {content}
    </ReactMarkdown>
  );
}

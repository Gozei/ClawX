import { Fragment, memo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type StreamingMarkdownPreviewProps = {
  content: string;
  className?: string;
  trailingCursor?: boolean;
};

type ParsedLine =
  | { kind: 'blank' }
  | { kind: 'divider' }
  | { kind: 'code'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'unordered'; text: string }
  | { kind: 'ordered'; order: string; text: string }
  | { kind: 'paragraph'; text: string };

type RenderBlock =
  | { kind: 'blank'; key: string }
  | { kind: 'divider'; key: string }
  | { kind: 'code'; key: string; text: string }
  | { kind: 'heading'; key: string; level: number; text: string }
  | { kind: 'quote'; key: string; text: string }
  | { kind: 'paragraph'; key: string; text: string }
  | { kind: 'unordered-list'; key: string; items: string[] }
  | { kind: 'ordered-list'; key: string; items: Array<{ order: string; text: string }> };

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strike'; value: string }
  | { kind: 'link'; label: string };

function tokenizeInlineMarkdown(text: string): InlineToken[] {
  const normalized = text.trimEnd();
  const tokens: InlineToken[] = [];
  const pattern = /!\[([^\]]*)\]\([^)]+\)|\[([^\]]+)\]\([^)]+\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~/g;
  let lastIndex = 0;

  for (const match of normalized.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: 'text', value: normalized.slice(lastIndex, index) });
    }

    if (match[1] != null) {
      tokens.push({ kind: 'text', value: match[1] });
    } else if (match[2] != null) {
      tokens.push({ kind: 'link', label: match[2] });
    } else if (match[3] != null) {
      tokens.push({ kind: 'code', value: match[3] });
    } else if (match[4] != null || match[5] != null) {
      tokens.push({ kind: 'strong', value: match[4] ?? match[5] ?? '' });
    } else if (match[6] != null || match[7] != null) {
      tokens.push({ kind: 'em', value: match[6] ?? match[7] ?? '' });
    } else if (match[8] != null) {
      tokens.push({ kind: 'strike', value: match[8] });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < normalized.length) {
    tokens.push({ kind: 'text', value: normalized.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ kind: 'text', value: normalized }];
}

function parseStreamingMarkdown(content: string): ParsedLine[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const parsed: ParsedLine[] = [];
  let inCodeFence = false;
  let codeBuffer: string[] = [];

  const flushCodeBuffer = () => {
    if (codeBuffer.length === 0) return;
    parsed.push({ kind: 'code', text: codeBuffer.join('\n') });
    codeBuffer = [];
  };

  for (const line of lines) {
    const raw = line ?? '';
    const trimmed = raw.trim();

    if (/^\s*```/.test(raw)) {
      if (inCodeFence) {
        flushCodeBuffer();
      }
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      codeBuffer.push(raw);
      continue;
    }

    if (!trimmed) {
      parsed.push({ kind: 'blank' });
      continue;
    }

    if (/^\s*([-*_]\s*){3,}$/.test(trimmed)) {
      parsed.push({ kind: 'divider' });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      parsed.push({
        kind: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      parsed.push({ kind: 'quote', text: quoteMatch[1] });
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      parsed.push({
        kind: 'ordered',
        order: orderedMatch[1],
        text: orderedMatch[2],
      });
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      parsed.push({ kind: 'unordered', text: unorderedMatch[1] });
      continue;
    }

    parsed.push({ kind: 'paragraph', text: trimmed });
  }

  flushCodeBuffer();
  return parsed;
}

function groupRenderBlocks(lines: ParsedLine[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.kind === 'unordered') {
      const items: string[] = [];
      let cursor = index;
      while (cursor < lines.length && lines[cursor]?.kind === 'unordered') {
        items.push((lines[cursor] as Extract<ParsedLine, { kind: 'unordered' }>).text);
        cursor += 1;
      }
      blocks.push({ kind: 'unordered-list', key: `unordered-${index}`, items });
      index = cursor;
      continue;
    }

    if (line.kind === 'ordered') {
      const items: Array<{ order: string; text: string }> = [];
      let cursor = index;
      while (cursor < lines.length && lines[cursor]?.kind === 'ordered') {
        const ordered = lines[cursor] as Extract<ParsedLine, { kind: 'ordered' }>;
        items.push({ order: ordered.order, text: ordered.text });
        cursor += 1;
      }
      blocks.push({ kind: 'ordered-list', key: `ordered-${index}`, items });
      index = cursor;
      continue;
    }

    if (line.kind === 'blank') {
      blocks.push({ kind: 'blank', key: `blank-${index}` });
    } else if (line.kind === 'divider') {
      blocks.push({ kind: 'divider', key: `divider-${index}` });
    } else if (line.kind === 'code') {
      blocks.push({ kind: 'code', key: `code-${index}`, text: line.text });
    } else if (line.kind === 'heading') {
      blocks.push({ kind: 'heading', key: `heading-${index}`, level: line.level, text: line.text });
    } else if (line.kind === 'quote') {
      blocks.push({ kind: 'quote', key: `quote-${index}`, text: line.text });
    } else {
      blocks.push({ kind: 'paragraph', key: `paragraph-${index}`, text: line.text });
    }

    index += 1;
  }

  return blocks;
}

function renderInlineContent(text: string, trailingCursor = false): ReactNode[] {
  const tokens = tokenizeInlineMarkdown(text);

  return tokens.map((token, index) => {
    const key = `${token.kind}-${index}`;
    const isLast = index === tokens.length - 1;
    const cursor = trailingCursor && isLast
      ? <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-foreground/45 align-[-2px]" />
      : null;

    if (token.kind === 'strong') {
      return (
        <Fragment key={key}>
          <strong className="font-semibold text-foreground">{token.value}</strong>
          {cursor}
        </Fragment>
      );
    }

    if (token.kind === 'em') {
      return (
        <Fragment key={key}>
          <span className="italic text-foreground/88">{token.value}</span>
          {cursor}
        </Fragment>
      );
    }

    if (token.kind === 'code') {
      return (
        <Fragment key={key}>
          <code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 font-mono text-[0.92em] text-foreground/92 [overflow-wrap:anywhere] dark:bg-white/[0.07]">
            {token.value}
          </code>
          {cursor}
        </Fragment>
      );
    }

    if (token.kind === 'strike') {
      return (
        <Fragment key={key}>
          <span className="line-through text-foreground/55">{token.value}</span>
          {cursor}
        </Fragment>
      );
    }

    if (token.kind === 'link') {
      return (
        <Fragment key={key}>
          <span className="text-foreground/92 underline decoration-foreground/18 underline-offset-4">{token.label}</span>
          {cursor}
        </Fragment>
      );
    }

    return (
      <Fragment key={key}>
        {token.value}
        {cursor}
      </Fragment>
    );
  });
}

export const StreamingMarkdownPreview = memo(function StreamingMarkdownPreview({
  content,
  className,
  trailingCursor = false,
}: StreamingMarkdownPreviewProps) {
  const blocks = groupRenderBlocks(parseStreamingMarkdown(content));

  return (
    <div className={cn(
      'min-w-0 max-w-full space-y-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
      '[&_strong]:font-semibold [&_strong]:text-foreground',
      '[&_code]:font-mono',
      className,
    )}>
      {blocks.map((block, index) => {
        const showCursor = trailingCursor && index === blocks.length - 1;

        if (block.kind === 'blank') {
          return <div key={block.key} className="h-1.5" aria-hidden="true" />;
        }

        if (block.kind === 'divider') {
          return <div key={block.key} className="h-px w-full bg-black/10 dark:bg-white/12" aria-hidden="true" />;
        }

        if (block.kind === 'code') {
          return (
            <pre
              key={block.key}
              className="max-w-full overflow-x-auto rounded-2xl border border-black/5 bg-black/[0.025] px-3.5 py-3 text-[12px] leading-6 text-foreground/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] dark:border-white/7 dark:bg-white/[0.025]"
            >
              {block.text}
              {showCursor ? <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-foreground/45 align-[-2px]" /> : null}
            </pre>
          );
        }

        if (block.kind === 'heading') {
          return (
            <div key={block.key} className={cn(block.level <= 2 && 'pt-1', block.level === 3 && 'pt-0.5')}>
              <div
                className={cn(
                  'font-semibold tracking-[-0.015em] text-foreground',
                  block.level <= 2 && 'text-[19px] leading-8',
                  block.level === 3 && 'text-[16px] leading-7',
                  block.level >= 4 && 'text-[14.5px] leading-7 text-foreground/90',
                )}
              >
                {renderInlineContent(block.text, showCursor)}
              </div>
              {block.level <= 3 ? (
                <div className="mt-1.5 h-px w-12 rounded-full bg-black/10 dark:bg-white/12" aria-hidden="true" />
              ) : null}
            </div>
          );
        }

        if (block.kind === 'quote') {
          return (
            <div
              key={block.key}
              className="min-w-0 border-l-2 border-black/8 pl-3.5 text-[14px] leading-7 text-foreground/70 dark:border-white/10"
            >
              {renderInlineContent(block.text, showCursor)}
            </div>
          );
        }

        if (block.kind === 'unordered-list') {
          return (
            <div key={block.key} className="space-y-1.5 py-0.5">
              {block.items.map((item, itemIndex) => {
                const itemHasCursor = showCursor && itemIndex === block.items.length - 1;
                return (
                  <div key={`${block.key}-${itemIndex}`} className="flex min-w-0 items-start gap-3 text-[14px] leading-7 text-foreground">
                    <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/24" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-foreground/90">
                      {renderInlineContent(item, itemHasCursor)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        }

        if (block.kind === 'ordered-list') {
          return (
            <div key={block.key} className="space-y-1.5 py-0.5">
              {block.items.map((item, itemIndex) => {
                const itemHasCursor = showCursor && itemIndex === block.items.length - 1;
                return (
                  <div key={`${block.key}-${itemIndex}`} className="flex min-w-0 items-start gap-3 text-[14px] leading-7 text-foreground">
                    <span className="mt-[0.08rem] min-w-[1.5rem] shrink-0 text-[13px] text-foreground/42 tabular-nums">
                      {item.order}.
                    </span>
                    <span className="min-w-0 flex-1 text-foreground/90">
                      {renderInlineContent(item.text, itemHasCursor)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        }

        return (
          <div key={block.key} className="min-w-0 text-[14px] leading-7 text-foreground/86">
            {renderInlineContent(block.text, showCursor)}
          </div>
        );
      })}
    </div>
  );
});

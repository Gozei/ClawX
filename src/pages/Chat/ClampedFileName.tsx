import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const SECOND_LINE_META_GAP = 8;
const MIN_FADE_WIDTH = 40;

interface ClampedFileNameProps {
  text: string;
  metaText?: string;
  textClassName?: string;
  metaClassName?: string;
  containerClassName?: string;
  fadeTestId?: string;
  textTestId?: string;
}

interface SplitFileNameLinesInput {
  text: string;
  firstLineWidth: number;
  secondLineWidth: number;
  measureWidth: (value: string) => number;
}

interface SplitFileNameLinesResult {
  firstLine: string;
  secondLine: string;
  truncated: boolean;
}

interface FileNameLayoutState extends SplitFileNameLinesResult {
  metaWidth: number;
}

function fitCharacters(
  characters: string[],
  maxWidth: number,
  measureWidth: (value: string) => number,
  minCharacters: number,
): number {
  if (characters.length === 0) {
    return 0;
  }

  if (maxWidth <= 0) {
    return Math.min(characters.length, minCharacters);
  }

  let low = 0;
  let high = characters.length;

  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    const width = measureWidth(characters.slice(0, middle).join(''));
    if (width <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return Math.min(characters.length, Math.max(low, minCharacters));
}

export function splitFileNameLines({
  text,
  firstLineWidth,
  secondLineWidth,
  measureWidth,
}: SplitFileNameLinesInput): SplitFileNameLinesResult {
  const characters = Array.from(text);
  if (characters.length === 0) {
    return {
      firstLine: '',
      secondLine: '',
      truncated: false,
    };
  }

  const firstLineCount = fitCharacters(
    characters,
    Math.max(0, firstLineWidth),
    measureWidth,
    1,
  );
  const firstLine = characters.slice(0, firstLineCount).join('');

  if (firstLineCount >= characters.length) {
    return {
      firstLine,
      secondLine: '',
      truncated: false,
    };
  }

  const remainingCharacters = characters.slice(firstLineCount);
  const secondLineCount = fitCharacters(
    remainingCharacters,
    Math.max(0, secondLineWidth),
    measureWidth,
    0,
  );

  return {
    firstLine,
    secondLine: remainingCharacters.slice(0, secondLineCount).join(''),
    truncated: secondLineCount < remainingCharacters.length,
  };
}

export function ClampedFileName({
  text,
  metaText,
  textClassName,
  metaClassName,
  containerClassName,
  fadeTestId,
  textTestId,
}: ClampedFileNameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const metaRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [layout, setLayout] = useState<FileNameLayoutState>({
    firstLine: text,
    secondLine: '',
    truncated: false,
    metaWidth: 0,
  });

  useLayoutEffect(() => {
    const containerElement = containerRef.current;
    const measureElement = measureRef.current;
    if (!containerElement || !measureElement) {
      return;
    }

    let frameId = 0;
    const measureWidth = (value: string) => {
      measureElement.textContent = value || ' ';
      return measureElement.getBoundingClientRect().width;
    };

    const updateLayout = () => {
      frameId = 0;

      const containerWidth = Math.floor(containerElement.getBoundingClientRect().width);
      if (containerWidth <= 0) {
        return;
      }

      const metaWidth = metaText && metaRef.current
        ? Math.ceil(metaRef.current.getBoundingClientRect().width)
        : 0;
      const reservedSecondLineWidth = metaWidth > 0
        ? metaWidth + SECOND_LINE_META_GAP
        : 0;

      const nextLayout = splitFileNameLines({
        text,
        firstLineWidth: containerWidth,
        secondLineWidth: Math.max(0, containerWidth - reservedSecondLineWidth),
        measureWidth,
      });

      setLayout((current) => {
        if (
          current.firstLine === nextLayout.firstLine
          && current.secondLine === nextLayout.secondLine
          && current.truncated === nextLayout.truncated
          && current.metaWidth === metaWidth
        ) {
          return current;
        }

        return {
          ...nextLayout,
          metaWidth,
        };
      });
    };

    const scheduleMeasure = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(updateLayout);
    };

    scheduleMeasure();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });
      resizeObserver.observe(containerElement);
      if (metaRef.current) {
        resizeObserver.observe(metaRef.current);
      }
    }

    window.addEventListener('resize', scheduleMeasure);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [metaText, text]);

  const fadeWidth = Math.max(
    MIN_FADE_WIDTH,
    Math.min(72, layout.metaWidth > 0 ? layout.metaWidth + 18 : MIN_FADE_WIDTH),
  );

  return (
    <div
      ref={containerRef}
      data-testid={textTestId}
      className={cn('relative min-w-0 overflow-hidden', containerClassName)}
      title={text}
    >
      <span
        ref={measureRef}
        aria-hidden="true"
        className={cn(
          'pointer-events-none invisible absolute left-0 top-0 -z-10 whitespace-pre',
          textClassName,
        )}
      />
      <div className="flex h-full min-w-0 flex-col justify-between">
        <p
          data-testid={textTestId ? `${textTestId}-first-line` : undefined}
          className={cn(
            'min-w-0 overflow-hidden whitespace-nowrap text-ellipsis',
            textClassName,
          )}
        >
          {layout.firstLine}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <p
              data-testid={textTestId ? `${textTestId}-second-line` : undefined}
              className={cn(
                'min-w-0 overflow-hidden whitespace-nowrap text-ellipsis',
                textClassName,
              )}
            >
              {layout.secondLine}
            </p>
            {layout.truncated ? (
              <div
                aria-hidden="true"
                data-testid={fadeTestId}
                className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-white/95 via-white/78 to-transparent dark:from-slate-950/94 dark:via-slate-950/76"
                style={{ width: `${fadeWidth}px` }}
              />
            ) : null}
          </div>
          {metaText ? (
            <span
              ref={metaRef}
              data-testid={textTestId ? `${textTestId}-meta` : undefined}
              className={cn(
                'shrink-0 whitespace-nowrap text-muted-foreground',
                metaClassName,
              )}
            >
              {metaText}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared file icon component used by both ChatInput (pre-send preview)
 * and ChatMessage (post-send display) to ensure consistent appearance.
 */
import { cn } from '@/lib/utils';
import { getFileVisual } from './file-visual';

/**
 * Coloured rounded-square icon with a small file-type badge.
 * Used identically in ChatInput (pre-send) and ChatMessage (post-send).
 */
export function FileTypeIcon({
  mimeType,
  fileName,
  className,
}: {
  mimeType: string;
  fileName?: string;
  className?: string;
}) {
  const visual = getFileVisual(mimeType, fileName);
  const { Icon } = visual;

  return (
    <div
      data-testid="chat-file-icon"
      className={cn(
        'relative flex h-11 w-11 shrink-0 self-center -translate-y-[2px] items-center justify-center rounded-xl',
        visual.accentClassName,
      )}
    >
      <Icon data-testid="chat-file-icon-glyph" className={cn('h-[27px] w-[27px] -translate-y-[1px]', className)} />
      <span
        data-testid="chat-file-ext-badge"
        className={cn(
          'absolute bottom-[3px] rounded-[6px] px-1.5 py-[2px] text-[10px] font-bold leading-none',
          visual.badgeClassName,
        )}
      >
        {visual.ext}
      </span>
    </div>
  );
}

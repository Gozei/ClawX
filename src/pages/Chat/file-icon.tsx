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
        'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset shadow-[0_10px_18px_rgba(15,23,42,0.08)]',
        visual.accentClassName,
      )}
    >
      <Icon className={cn('h-5 w-5', className)} />
      <span
        data-testid="chat-file-ext-badge"
        className={cn(
          'absolute bottom-0 rounded-md px-1.5 py-[2px] text-[9px] font-bold leading-none shadow-sm',
          visual.badgeClassName,
        )}
      >
        {visual.ext}
      </span>
    </div>
  );
}

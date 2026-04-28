import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { modalOverlayClasses, modalCardClasses } from '@/components/ui/modal';
import { MarkdownRenderer } from '@/pages/Chat/MarkdownRenderer';
import changelogRaw from '../../../CHANGELOG.md?raw';

interface ChangelogDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ChangelogDialog({ open, onClose }: ChangelogDialogProps) {
  const { t } = useTranslation('settings');

  if (!open) return null;

  return (
    <div
      data-testid="settings-changelog-dialog"
      className={modalOverlayClasses}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-changelog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className={cn(
          modalCardClasses,
          'max-w-2xl rounded-2xl border bg-background shadow-xl'
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 id="settings-changelog-title" className="text-lg font-semibold">
            {t('updates.changelogTitle')}
          </h2>
          <button
            data-testid="settings-changelog-close"
            aria-label={t('updates.changelogTitle')}
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto max-h-[calc(100dvh-8rem)] px-6 py-4">
          <div className="text-sm">
            <MarkdownRenderer
              content={changelogRaw}
              components={{
                h2: ({ children }) => (
                  <h2 className="text-base font-semibold text-foreground mt-4 mb-2 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-medium text-foreground mt-3 mb-1.5">
                    {children}
                  </h3>
                ),
                ul: ({ children }) => (
                  <ul className="space-y-1 text-muted-foreground">{children}</ul>
                ),
                li: ({ children }) => (
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                    <span>{children}</span>
                  </li>
                ),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
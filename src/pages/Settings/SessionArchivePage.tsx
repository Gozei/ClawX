import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { useBranding } from '@/lib/branding';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';

type ArchivedSession = {
  key: string;
  label?: string;
  displayName?: string;
  archivedAt?: number;
  createdAt?: number;
};

function formatDateTime(value: number | undefined, locale: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export function SessionArchivePage() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const branding = useBranding();
  const restoreSession = useChatStore((state) => state.restoreSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<ArchivedSession[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const result = await hostApiFetch<{
          success: boolean;
          sessions?: ArchivedSession[];
        }>('/api/sessions/archived');

        if (!cancelled) {
          setSessions(Array.isArray(result?.sessions) ? result.sessions : []);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(String(error));
          setSessions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSessions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return sessions;
    }

    return sessions.filter((session) => {
      const label = (session.label ?? session.displayName ?? '').toLowerCase();
      return label.includes(keyword) || session.key.toLowerCase().includes(keyword);
    });
  }, [query, sessions]);

  const archiveGridClassName = 'grid grid-cols-[minmax(0,2.25fr)_minmax(220px,1.35fr)_160px_168px] gap-x-4';

  return (
    <div
      data-testid="session-archive-page"
      className="flex flex-col dark:bg-background overflow-hidden -m-6 h-[calc(100vh-2.5rem)]"
    >
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        <PageHeader
          title={t('sessionArchive.title')}
          subtitle={t('sessionArchive.subtitle', {
            appName: branding.productName,
          })}
          titleTestId="session-archive-page-title"
          subtitleTestId="session-archive-page-subtitle"
        />

        <div className="mt-8 flex items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="session-archive-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('sessionArchive.searchPlaceholder')}
              className="h-11 rounded-2xl border-black/10 bg-white pl-10 dark:border-white/10 dark:bg-card"
            />
          </div>
          <div
            data-testid="session-archive-count"
            className="rounded-full border border-black/10 px-3 py-2 text-[12px] text-muted-foreground dark:border-white/10"
          >
            {t('sessionArchive.count', { count: filteredSessions.length })}
          </div>
        </div>

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-8">
          <div className="overflow-hidden rounded-[24px] border border-black/8 bg-white dark:border-white/10 dark:bg-card">
            <div className={cn(archiveGridClassName, 'border-b border-black/6 px-6 py-4 text-[12px] font-medium text-muted-foreground dark:border-white/10')}>
              <span className="min-w-0 justify-self-center text-center">{t('sessionArchive.columns.title')}</span>
              <span className="min-w-0 justify-self-center text-center">{t('sessionArchive.columns.sessionId')}</span>
              <span className="min-w-0 justify-self-center whitespace-nowrap text-center">{t('sessionArchive.columns.createdAt')}</span>
              <span className="min-w-0 justify-self-center text-center">{t('sessionArchive.columns.actions')}</span>
            </div>

            {loading ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground" data-testid="session-archive-loading">
                {t('common:status.loading')}
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground" data-testid="session-archive-empty">
                {query.trim() ? t('sessionArchive.emptyFiltered') : t('sessionArchive.empty')}
              </div>
            ) : (
              <div data-testid="session-archive-list">
                {filteredSessions.map((session) => {
                  const title = session.label ?? session.displayName ?? session.key;
                  return (
                    <div
                      key={session.key}
                      data-testid={`session-archive-row-${session.key}`}
                      className={cn(archiveGridClassName, 'items-center border-b border-black/6 px-6 py-4 last:border-b-0 dark:border-white/10')}
                    >
                      <div className="min-w-0">
                        <div
                          data-testid={`session-archive-title-${session.key}`}
                          className="truncate text-[14px] font-medium text-foreground"
                          title={title}
                        >
                          {title}
                        </div>
                        <div className="mt-1 text-[12px] text-muted-foreground">
                          {formatDateTime(session.archivedAt, i18n.resolvedLanguage || 'zh-CN')}
                        </div>
                      </div>
                      <div
                        className="min-w-0 truncate text-[13px] text-muted-foreground"
                        title={session.key}
                      >
                        {session.key}
                      </div>
                      <div className="min-w-0 justify-self-center whitespace-nowrap text-center text-[13px] text-muted-foreground">
                        {formatDateTime(session.createdAt, i18n.resolvedLanguage || 'zh-CN')}
                      </div>
                      <div className="flex min-w-0 items-center justify-end gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`session-archive-restore-${session.key}`}
                          onClick={async () => {
                            await restoreSession(session.key);
                            toast.success(t('sessionArchive.unarchiveSuccess'));
                            navigate('/');
                          }}
                          className="h-auto rounded-none p-0 text-[13px] font-medium text-foreground/78 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
                        >
                          <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                          {t('sessionArchive.actions.restore')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`session-archive-delete-${session.key}`}
                          onClick={() => setDeleteTarget(session)}
                          className={cn('h-auto rounded-none p-0 text-[13px] text-destructive hover:bg-transparent hover:text-destructive dark:hover:bg-transparent')}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          {t('sessionArchive.actions.delete')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common:actions.confirm')}
        message={t('sessionArchive.deleteConfirm', {
          label: deleteTarget?.label ?? deleteTarget?.displayName ?? deleteTarget?.key ?? '',
        })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteSession(deleteTarget.key);
          setSessions((current) => current.filter((session) => session.key !== deleteTarget.key));
          setDeleteTarget(null);
          toast.success(t('sessionArchive.deleteSuccess'));
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default SessionArchivePage;

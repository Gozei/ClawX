import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';

export type LibreOfficeRuntimeStatusPayload = {
  available: boolean;
  supported: boolean;
  targetId?: string;
  targetLabel?: string;
  status: 'idle' | 'downloading' | 'extracting' | 'complete' | 'cancelled' | 'error';
  jobId?: string;
  receivedBytes?: number;
  totalBytes?: number | null;
  percent?: number | null;
  error?: string;
};

function formatProgressPercent(percent: number | null | undefined): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return '';
  }
  return percent % 1 === 0 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
}

function isLibreOfficeRuntimeBusy(status: LibreOfficeRuntimeStatusPayload | null): boolean {
  return status?.status === 'downloading' || status?.status === 'extracting';
}

export function LibreOfficeDownloadDialog({
  onCancel,
  onComplete,
  variant = 'inline',
}: {
  onCancel: () => void;
  onComplete: () => void;
  variant?: 'inline' | 'global';
}) {
  const { t } = useTranslation('chat');
  const [runtimeStatus, setRuntimeStatus] = useState<LibreOfficeRuntimeStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const completedRef = useRef(false);
  const jobId = runtimeStatus?.jobId;
  const percent = runtimeStatus?.percent ?? null;
  const busy = isLibreOfficeRuntimeBusy(runtimeStatus);
  const isExtracting = runtimeStatus?.status === 'extracting';

  const finishDownload = useCallback(() => {
    if (completedRef.current) {
      return;
    }
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  const refreshRuntimeStatus = useCallback(async (nextJobId?: string) => {
    const query = nextJobId ? `?jobId=${encodeURIComponent(nextJobId)}` : '';
    const nextStatus = await hostApiFetch<LibreOfficeRuntimeStatusPayload>(
      `/api/files/libreoffice-runtime/status${query}`,
    );
    setRuntimeStatus(nextStatus);

    if (nextStatus.available || nextStatus.status === 'complete') {
      finishDownload();
      return;
    }

    if (nextStatus.status === 'error') {
      setError(nextStatus.error ?? t('filePreview.libreOfficeDownload.failed'));
    }
  }, [finishDownload, t]);

  const handleDownload = useCallback(() => {
    setError(null);
    setDownloadRequested(true);
    void hostApiFetch<LibreOfficeRuntimeStatusPayload>('/api/files/libreoffice-runtime/download', {
      method: 'POST',
    })
      .then((nextStatus) => {
        setRuntimeStatus(nextStatus);
        if (nextStatus.available || nextStatus.status === 'complete') {
          finishDownload();
          return;
        }
        if (!nextStatus.supported || nextStatus.status === 'error') {
          setDownloadRequested(false);
          setError(nextStatus.error ?? t('filePreview.libreOfficeDownload.unsupported'));
        }
      })
      .catch((downloadError) => {
        setDownloadRequested(false);
        setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
      });
  }, [finishDownload, t]);

  const handleCancel = useCallback(() => {
    const activeJobId = runtimeStatus?.jobId;
    if (downloadRequested || isLibreOfficeRuntimeBusy(runtimeStatus)) {
      void hostApiFetch<LibreOfficeRuntimeStatusPayload>('/api/files/libreoffice-runtime/cancel', {
        method: 'POST',
        body: JSON.stringify(activeJobId ? { jobId: activeJobId } : {}),
      }).catch(() => undefined);
    }
    onCancel();
  }, [downloadRequested, onCancel, runtimeStatus]);

  useEffect(() => {
    void refreshRuntimeStatus().catch(() => undefined);
  }, [refreshRuntimeStatus]);

  useEffect(() => {
    if (!jobId || !busy) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshRuntimeStatus(jobId).catch((statusError) => {
        setError(statusError instanceof Error ? statusError.message : String(statusError));
      });
    }, 800);
    return () => {
      window.clearInterval(timer);
    };
  }, [busy, jobId, refreshRuntimeStatus]);

  const progressWidth = typeof percent === 'number' && Number.isFinite(percent)
    ? `${Math.max(2, Math.min(100, percent))}%`
    : busy
      ? '45%'
      : '0%';

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="libreoffice-download-title"
      data-testid="chat-file-preview-libreoffice-dialog"
      className="w-full max-w-[420px] rounded-2xl border border-black/8 bg-white px-6 py-5 text-left shadow-[0_24px_80px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-slate-950"
    >
      <h3 id="libreoffice-download-title" className="text-[15px] font-semibold text-foreground">
        {t('filePreview.libreOfficeDownload.title')}
      </h3>
      <p className="mt-3 text-[14px] leading-7 text-foreground/70">
        {t('filePreview.libreOfficeDownload.message')}
      </p>

      {runtimeStatus?.targetLabel ? (
        <p className="mt-2 text-[12px] text-foreground/46">
          {t('filePreview.libreOfficeDownload.platform', { platform: runtimeStatus.targetLabel })}
        </p>
      ) : null}

      {busy ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-[12px] text-foreground/56">
            <span>
              {isExtracting
                ? t('filePreview.libreOfficeDownload.extracting')
                : t('filePreview.libreOfficeDownload.downloading')}
            </span>
            <span>{formatProgressPercent(percent)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={cn(
                'h-full rounded-full bg-blue-500 transition-all duration-300',
                typeof percent === 'number' ? '' : 'animate-pulse',
              )}
              style={{ width: progressWidth }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-600 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={handleCancel}
          data-testid="chat-file-preview-libreoffice-cancel"
        >
          {t('filePreview.libreOfficeDownload.cancel')}
        </Button>
        <Button
          type="button"
          onClick={handleDownload}
          disabled={busy}
          data-testid="chat-file-preview-libreoffice-download"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {busy
            ? isExtracting
              ? t('filePreview.libreOfficeDownload.installBusy')
              : t('filePreview.libreOfficeDownload.downloadBusy')
            : t('filePreview.libreOfficeDownload.download')}
        </Button>
      </div>
    </div>
  );

  if (variant === 'global') {
    return (
      <div
        data-testid="chat-libreoffice-global-dialog"
        className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/20 px-6 py-8 backdrop-blur-[2px]"
      >
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex min-h-[320px] flex-1 items-center justify-center px-6 py-8">
      {dialog}
    </div>
  );
}

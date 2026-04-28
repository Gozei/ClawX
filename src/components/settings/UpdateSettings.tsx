/**
 * Update Settings Component
 * Displays update status and allows manual update checking/installation
 */
import { useEffect, useCallback, useState } from 'react';
import { Download, RefreshCw, Loader2, Rocket, XCircle, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useUpdateStore } from '@/stores/update';
import { useTranslation } from 'react-i18next';
import { ChangelogDialog } from '@/components/settings/ChangelogDialog';
import { MarkdownRenderer } from '@/pages/Chat/MarkdownRenderer';
import changelogRaw from '../../../CHANGELOG.md?raw';

// Extract the version summary from CHANGELOG.md (first non-heading line after version)
function getVersionSummary(): string {
  const lines = changelogRaw.split('\n');
  const versionIdx = lines.findIndex((l) => l.startsWith('## v'));
  if (versionIdx === -1) return '';
  for (let i = versionIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#') && !line.startsWith('##') && !line.startsWith('###')) {
      return line.replace(/^\*\*/, '').replace(/\*\*$/, '');
    }
  }
  return '';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function UpdateSettings() {
  const { t } = useTranslation('settings');
  const {
    status,
    currentVersion,
    updateInfo,
    progress,
    error,
    isInitialized,
    autoInstallCountdown,
    init,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    cancelAutoInstall,
    clearError,
  } = useUpdateStore();

  const [changelogOpen, setChangelogOpen] = useState(false);

  // Initialize on mount
  useEffect(() => {
    init();
  }, [init]);

  const handleCheckForUpdates = useCallback(async () => {
    clearError();
    await checkForUpdates();
  }, [checkForUpdates, clearError]);

  const renderStatusIcon = () => {
    switch (status) {
      case 'checking':
      case 'downloading':
      case 'installing':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'available':
        return <Download className="h-4 w-4 text-primary" />;
      case 'downloaded':
        return <Rocket className="h-4 w-4 text-primary" />;
      case 'error':
        return <RefreshCw className="h-4 w-4 text-destructive" />;
      default:
        return <RefreshCw className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const renderStatusText = () => {
    if (status === 'downloaded' && autoInstallCountdown != null && autoInstallCountdown >= 0) {
      return t('updates.status.autoInstalling', { seconds: autoInstallCountdown });
    }
    switch (status) {
      case 'checking':
        return t('updates.status.checking');
      case 'downloading':
        return t('updates.status.downloading');
      case 'available':
        return t('updates.status.available', { version: updateInfo?.version });
      case 'downloaded':
        return t('updates.status.downloaded', { version: updateInfo?.version });
      case 'installing':
        return t('updates.status.installing');
      case 'error':
        return error || t('updates.status.failed');
      case 'not-available':
        return t('updates.status.latest');
      default:
        return t('updates.status.check');
    }
  };

  const renderAction = () => {
    switch (status) {
      case 'checking':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.checking')}
          </Button>
        );
      case 'downloading':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.downloading')}
          </Button>
        );
      case 'installing':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.installing')}
          </Button>
        );
      case 'available':
        return (
          <Button onClick={() => { void downloadUpdate(); }} size="sm">
            <Download className="h-4 w-4 mr-2" />
            {t('updates.action.download')}
          </Button>
        );
      case 'downloaded':
        if (autoInstallCountdown != null && autoInstallCountdown >= 0) {
          return (
            <Button onClick={cancelAutoInstall} size="sm" variant="outline">
              <XCircle className="h-4 w-4 mr-2" />
              {t('updates.action.cancelAutoInstall')}
            </Button>
          );
        }
        return (
          <Button onClick={() => { void installUpdate(); }} size="sm" variant="default">
            <Rocket className="h-4 w-4 mr-2" />
            {t('updates.action.install')}
          </Button>
        );
      case 'error':
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('updates.action.retry')}
          </Button>
        );
      default:
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('updates.action.check')}
          </Button>
        );
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-4">
      {/* Current Version */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('updates.currentVersion')}</p>
          <p className="text-2xl font-bold">v{currentVersion}</p>
          {getVersionSummary() && (
            <p className="text-sm text-muted-foreground">{getVersionSummary()}</p>
          )}
        </div>
        {renderStatusIcon()}
      </div>

      {/* Changelog Entry */}
      <Button
        data-testid="settings-changelog-button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground -ml-2"
        onClick={() => setChangelogOpen(true)}
      >
        <ScrollText className="h-4 w-4 mr-1.5" />
        {t('updates.changelog')}
      </Button>

      {/* Status */}
      <div className="flex items-center justify-between py-3 border-t border-b">
        <p className="text-sm text-muted-foreground">{renderStatusText()}</p>
        {renderAction()}
      </div>

      {/* Download Progress */}
      {status === 'downloading' && progress && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
            </span>
            <span>{formatBytes(progress.bytesPerSecond)}/s</span>
          </div>
          <Progress value={progress.percent} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            {Math.round(progress.percent)}% complete
          </p>
        </div>
      )}

      {/* Update Info */}
      {updateInfo && (status === 'available' || status === 'downloaded') && (
        <div className="rounded-lg bg-muted p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">Version {updateInfo.version}</p>
            {updateInfo.releaseDate && (
              <p className="text-sm text-muted-foreground">
                {new Date(updateInfo.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>
          {updateInfo.releaseNotes && (
            <div className="text-sm text-muted-foreground prose prose-sm max-w-none dark:prose-invert">
              <p className="font-medium text-foreground mb-1">{t('updates.whatsNew')}</p>
              <MarkdownRenderer content={typeof updateInfo.releaseNotes === 'string' ? updateInfo.releaseNotes : ''} />
            </div>
          )}
        </div>
      )}

      {/* Error Details */}
      {error && (status === 'error' || status === 'downloaded') && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/10 p-4 text-red-600 dark:text-red-400 text-sm">
          <p className="font-medium mb-1">{t('updates.errorDetails')}</p>
          <p>{error}</p>
        </div>
      )}

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        {t('updates.help')}
      </p>

      </div>

      <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}

export default UpdateSettings;

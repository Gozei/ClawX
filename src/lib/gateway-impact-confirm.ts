import i18n from '@/i18n';

export type GatewayImpactMode = 'restart' | 'refresh';

export type GatewayImpactConfirmOptions = {
  mode: GatewayImpactMode;
  willApplyChanges?: boolean;
  confirmLabel?: string;
};

export type GatewayImpactDialogRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

type GatewayImpactPresenter = (request: GatewayImpactDialogRequest) => Promise<boolean>;

let presenter: GatewayImpactPresenter | null = null;

export function registerGatewayImpactPresenter(nextPresenter: GatewayImpactPresenter | null): void {
  presenter = nextPresenter;
}

function buildGatewayImpactDialogRequest(options: GatewayImpactConfirmOptions): GatewayImpactDialogRequest {
  const willApplyChanges = options.willApplyChanges !== false;
  const title = options.mode === 'restart'
    ? i18n.t('common:gatewayImpact.titleRestart', 'This action will restart the Gateway')
    : i18n.t('common:gatewayImpact.titleRefresh', 'This action will refresh the Gateway');
  const message = options.mode === 'restart'
    ? (
      willApplyChanges
        ? i18n.t(
          'common:gatewayImpact.messageRestartWithChanges',
          'If you continue, ClawX will apply this change and restart the OpenClaw Gateway. Ongoing chats, channel connections, or scheduled tasks may be briefly interrupted.',
        )
        : i18n.t(
          'common:gatewayImpact.messageRestartOnly',
          'If you continue, ClawX will restart the OpenClaw Gateway. Ongoing chats, channel connections, or scheduled tasks may be briefly interrupted.',
        )
    )
    : (
      willApplyChanges
        ? i18n.t(
          'common:gatewayImpact.messageRefreshWithChanges',
          'If you continue, ClawX will apply this change and refresh the OpenClaw Gateway configuration. On some platforms or when in-place reload is unavailable, the Gateway may restart instead.',
        )
        : i18n.t(
          'common:gatewayImpact.messageRefreshOnly',
          'If you continue, ClawX will refresh the OpenClaw Gateway configuration. On some platforms or when in-place reload is unavailable, the Gateway may restart instead.',
        )
    );
  const confirmLabel = options.confirmLabel || (
    options.mode === 'restart'
      ? (
        willApplyChanges
          ? i18n.t('common:gatewayImpact.confirmRestartWithChanges', 'Apply and Restart')
          : i18n.t('common:gatewayImpact.confirmRestartOnly', 'Restart')
      )
      : (
        willApplyChanges
          ? i18n.t('common:gatewayImpact.confirmRefreshWithChanges', 'Apply Changes')
          : i18n.t('common:gatewayImpact.confirmRefreshOnly', 'Continue')
      )
  );

  return {
    title,
    message,
    confirmLabel,
    cancelLabel: i18n.t('common:actions.cancel', 'Cancel'),
  };
}

export async function confirmGatewayImpact(options: GatewayImpactConfirmOptions): Promise<boolean> {
  if (!presenter) {
    return true;
  }
  return await presenter(buildGatewayImpactDialogRequest(options));
}

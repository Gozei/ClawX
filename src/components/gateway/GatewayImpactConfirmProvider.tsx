import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  registerGatewayImpactPresenter,
  type GatewayImpactDialogRequest,
} from '@/lib/gateway-impact-confirm';

type GatewayImpactConfirmProviderProps = {
  children: ReactNode;
};

type PendingGatewayImpactRequest = GatewayImpactDialogRequest & {
  resolve: (confirmed: boolean) => void;
};

export function GatewayImpactConfirmProvider({ children }: GatewayImpactConfirmProviderProps) {
  const [pendingRequest, setPendingRequest] = useState<PendingGatewayImpactRequest | null>(null);

  const presenter = useMemo(() => {
    return async (request: GatewayImpactDialogRequest) => {
      return await new Promise<boolean>((resolve) => {
        setPendingRequest({
          ...request,
          resolve,
        });
      });
    };
  }, []);

  useEffect(() => {
    registerGatewayImpactPresenter(presenter);
    return () => {
      registerGatewayImpactPresenter(null);
      setPendingRequest((current) => {
        current?.resolve(false);
        return null;
      });
    };
  }, [presenter]);

  const closeDialog = (confirmed: boolean) => {
    setPendingRequest((current) => {
      current?.resolve(confirmed);
      return null;
    });
  };

  return (
    <>
      {children}
      <ConfirmDialog
        open={!!pendingRequest}
        title={pendingRequest?.title || ''}
        message={pendingRequest?.message || ''}
        confirmLabel={pendingRequest?.confirmLabel}
        cancelLabel={pendingRequest?.cancelLabel}
        onConfirm={() => closeDialog(true)}
        onCancel={() => closeDialog(false)}
        testId="gateway-impact-confirm-dialog"
      />
    </>
  );
}

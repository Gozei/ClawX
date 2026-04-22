import { useLocation } from 'react-router-dom';
import { AppSettingsContent } from '@/components/settings/AppSettingsContent';
import { SessionArchivePage } from './SessionArchivePage';

export function Settings() {
  const location = useLocation();

  if (location.pathname.startsWith('/settings/archives')) {
    return <SessionArchivePage />;
  }

  return <AppSettingsContent />;
}

export default Settings;

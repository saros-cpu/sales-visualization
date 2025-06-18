export {};
declare global {
  interface UpdateStatus {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    version?: string;
    releaseDate?: string;
    percent?: number;
    message?: string;
  }
  interface Window {
    electronAPI?: { platform: string };
    updater?: {
      onStatusChange: (callback: (status: UpdateStatus) => void) => () => void;
      checkForUpdates: () => void;
      downloadUpdate: () => void;
      restartApp: () => void;
    };
  }
}

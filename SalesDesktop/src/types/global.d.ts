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
    electronAPI?: {
      platform: string;
      downloadFile: (url: string, filename: string) => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
    };
    updater?: {
      onStatusChange: (callback: (status: UpdateStatus) => void) => () => void;
      checkForUpdates: () => void;
      downloadUpdate: () => void;
      restartApp: () => void;
    };
  }
}

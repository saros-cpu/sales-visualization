export {};
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
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
      downloadFile: (url: string, filename: string, token?: string) => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      minimize?: () => void;
      maximize?: () => void;
      close?: () => void;
    };
    updater?: {
      onStatusChange: (callback: (status: UpdateStatus) => void) => () => void;
      checkForUpdates: () => void;
      downloadUpdate: () => void;
      restartApp: () => void;
    };
  }
}

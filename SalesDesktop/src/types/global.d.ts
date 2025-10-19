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
    __SALES_API_HOST__?: string;
    SALES_RUNTIME_CONFIG?: {
      apiHost?: string;
      updateUrl?: string;
      allowedHosts?: string[];
    };
    electronAPI?: {
      platform: string;
      downloadFile: (url: string, filename: string, token?: string) => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      minimize?: () => void | Promise<boolean>;
      maximize?: () => void | Promise<boolean>;
      close?: () => void | Promise<boolean>;
      setDevToolsAccess?: (enabled: boolean) => void;
      onDevToolsOpened?: (callback: () => void) => () => void;
    };
    updater?: {
      onStatusChange: (callback: (status: UpdateStatus) => void) => () => void;
      checkForUpdates: () => void;
      downloadUpdate: () => void;
      restartApp: () => void;
    };
  }
}

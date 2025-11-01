export {};
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
declare global {
  type AppCloseAction = 'minimize' | 'quit' | 'cancel';

  interface WindowEventMap {
    'sales-app-close-requested': CustomEvent<void>;
  }

  interface UpdateStatus {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported';
    version?: string;
    releaseDate?: string;
    percent?: number;
    message?: string;
    autoCheck?: boolean;
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
      resolveAppClose?: (action: AppCloseAction) => Promise<boolean>;
      onAppCloseRequested?: (callback: () => void) => () => void;
      minimize?: () => void | Promise<boolean>;
      maximize?: () => void | Promise<boolean>;
      close?: () => void | Promise<boolean>;
      setDevToolsAccess?: (enabled: boolean) => void;
      onDevToolsOpened?: (callback: () => void) => () => void;
    };
    updater?: {
      onStatusChange: (callback: (status: UpdateStatus) => void) => () => void;
      getStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<unknown>;
      downloadUpdate: () => Promise<unknown>;
      restartApp: () => Promise<unknown>;
    };
  }
}

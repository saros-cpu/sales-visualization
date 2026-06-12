export {};
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
declare global {
  type AppCloseAction = 'minimize' | 'quit' | 'cancel';
  type UpdateInstallAction = 'later' | 'restart';

  interface UpdateInstallInfo {
    version?: string;
  }

  interface WindowEventMap {
    'sales-app-close-requested': CustomEvent<void>;
  }

  interface UpdateStatus {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported';
    version?: string;
    releaseDate?: string;
    percent?: number;
    transferred?: number;
    total?: number;
    bytesPerSecond?: number;
    message?: string;
    autoCheck?: boolean;
  }
  interface Window {
    __SALES_API_HOST__?: string;
    SALES_RUNTIME_CONFIG?: {
      apiHost?: string;
      updateUrl?: string;
      wallpaperToken?: string;
      allowedHosts?: string[];
      safeArea?: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
      };
      lively?: {
        packageId?: string;
        packageVersion?: string;
        updateManifestUrl?: string;
        refreshSeconds?: number;
        vpnApiHost?: string;
      };
    };
    SALES_WALLPAPER_KEY_READY?: Promise<void>;
	    SALES_WALLPAPER_KEY_STATUS?: {
	      state?: 'missing' | 'loaded' | 'invalid' | 'vpn';
	      message?: string;
	      source?: string;
	      apiHost?: string;
	      loadedAt?: string;
	      tokenLength?: number;
	      tokenFingerprint?: string;
	    };
    SALES_WALLPAPER_AUTH_STATUS?: {
      method?: 'public' | 'header' | 'query' | 'vpn';
      checkedAt?: string;
      sensitiveData?: boolean;
      fallbackReason?: string;
      error?: string;
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
      resolveInstallPrompt?: (action: UpdateInstallAction) => Promise<boolean>;
      onInstallPrompt?: (callback: (info: UpdateInstallInfo) => void) => () => void;
    };
    wallpaperAPI?: {
      setInteractive: (enabled: boolean, durationMs?: number) => Promise<boolean>;
      reload: () => Promise<boolean>;
      ready?: () => Promise<boolean>;
    };
  }
}

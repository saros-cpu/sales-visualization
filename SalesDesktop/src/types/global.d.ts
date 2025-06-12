export {};
declare global {
  interface Window {
    electronAPI?: { platform: string };
  }
}

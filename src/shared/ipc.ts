export const ipcChannels = {
  getRuntimeInfo: 'writellm:runtime-info'
} as const;

export type RuntimeInfo = {
  appName: string;
  appVersion: string;
  platform: string;
  isPackaged: boolean;
};

export type WriteLLMIpc = {
  getRuntimeInfo(): Promise<RuntimeInfo>;
};

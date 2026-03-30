/**
 * Shared types for vitest-react-native-runtime node-side modules.
 */

export type Platform = 'android' | 'ios';

export type PoolMode = 'dev' | 'run';

export interface NativePoolOptions {
  port: number;
  metroPort: number;
  platform: Platform;
  bundleId: string;
  appDir: string;
  deviceId?: string;
  skipIfUnavailable: boolean;
  headless: boolean;
  shutdownEmulator: boolean;
  verbose: boolean;
  mode: PoolMode;
  testInclude: string[];
}

export interface NativePluginOptions {
  platform?: Platform;
  bundleId?: string;
  appDir?: string;
  port?: number;
  metroPort?: number;
  deviceId?: string;
  headless?: boolean;
  shutdownEmulator?: boolean;
  skipIfUnavailable?: boolean;
  verbose?: boolean;
}

export interface DeviceOptions {
  wsPort?: number;
  metroPort?: number;
  deviceId?: string;
  headless?: boolean;
}

export interface EnvironmentCheck {
  ok: boolean;
  message: string;
  fix?: string;
  detail?: string;
  autoFixable?: boolean;
}

export interface NamedCheck extends EnvironmentCheck {
  name: string;
}

export interface EnvironmentResult {
  ok: boolean;
  checks: NamedCheck[];
  issues: NamedCheck[];
}

export interface AllEnvironmentsResult {
  android: NamedCheck[];
  ios: NamedCheck[];
  general: NamedCheck[];
}

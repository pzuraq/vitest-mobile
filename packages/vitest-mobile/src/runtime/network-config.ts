interface RuntimeNetworkConfig {
  wsHost: string;
  wsPort: number;
  metroHost: string;
  metroPort: number;
}

const config: RuntimeNetworkConfig = {
  wsHost: '127.0.0.1',
  wsPort: 7878,
  metroHost: '127.0.0.1',
  metroPort: 8081,
};

export function configureRuntimeNetwork(partial: Partial<RuntimeNetworkConfig>): void {
  Object.assign(config, partial);
}

export function getRuntimeNetwork(): RuntimeNetworkConfig {
  return { ...config };
}

export function getMetroBaseUrl(): string {
  return `http://${config.metroHost}:${config.metroPort}`;
}

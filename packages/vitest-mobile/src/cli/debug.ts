/**
 * Debug utilities — open the debugger via Metro's HTTP API,
 * or evaluate JS in the running app via CDP.
 */

import WebSocket from 'ws';

async function getDebuggerUrl(metroPort: number): Promise<string> {
  const listUrl = `http://localhost:${metroPort}/json`;
  const res = await fetch(listUrl);
  const targets = (await res.json()) as Array<{ webSocketDebuggerUrl?: string; title?: string }>;
  const target = targets.find(t => t.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('No debuggable target found. Is the app running?');
  }
  return target.webSocketDebuggerUrl;
}

async function cdpEval(expression: string, metroPort: number): Promise<string> {
  const wsUrl = await getDebuggerUrl(metroPort);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP eval timed out (5s)'));
    }, 5000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      );
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1) {
          clearTimeout(timeout);
          ws.close();
          if (msg.result?.result?.value !== undefined) {
            resolve(String(msg.result.result.value));
          } else if (msg.result?.exceptionDetails) {
            reject(new Error(msg.result.exceptionDetails.text ?? 'Evaluation error'));
          } else {
            resolve('');
          }
        }
      } catch {
        /* ignore */
      }
    });

    ws.on('error', err => {
      clearTimeout(timeout);
      reject(new Error(`CDP connection failed: ${err.message}`));
    });
  });
}

export async function debugOpen(metroPort = 18081): Promise<void> {
  console.log('Opening debugger...');
  try {
    // Use Metro's /open-debugger endpoint — the same thing the "j" key does
    const res = await fetch(`http://localhost:${metroPort}/open-debugger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      console.log('Debugger opened.');
    } else {
      const text = await res.text();
      console.error(`Metro responded with ${res.status}: ${text}`);
    }
  } catch (err: unknown) {
    console.error(`Failed to contact Metro: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`Make sure Metro is running on port ${metroPort}.`);
    process.exit(1);
  }
}

export async function debugEval(expression: string, metroPort = 18081): Promise<void> {
  try {
    const result = await cdpEval(expression, metroPort);
    if (result) console.log(result);
  } catch (err: unknown) {
    console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

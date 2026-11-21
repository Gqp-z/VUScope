import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server.js';

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) {
    appPromise = createApp();
  }
  const { app } = await appPromise;
  return app(req as any, res as any);
}

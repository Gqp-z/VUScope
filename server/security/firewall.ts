import type { NextFunction, Request, Response } from 'express';

export const ALLOWED_EXTERNAL_HOSTS = [
  'myvariant.info',
  'mygene.info',
  'eutils.ncbi.nlm.nih.gov',
  'search.clinicalgenome.org',
  'storage.googleapis.com',
] as const;

const ALLOWED_HOST_SET = new Set<string>(ALLOWED_EXTERNAL_HOSTS);

export interface FirewallBlockEvent {
  timestamp: string;
  method: string;
  path: string;
  reason: string;
}

export interface FirewallTelemetry {
  active: boolean;
  inspectedRequests: number;
  blockedRequests: number;
  rateLimitedRequests: number;
  allowedEgressHosts: string[];
  recentBlocks: FirewallBlockEvent[];
}

const firewallState: {
  inspectedRequests: number;
  blockedRequests: number;
  rateLimitedRequests: number;
  recentBlocks: FirewallBlockEvent[];
} = {
  inspectedRequests: 0,
  blockedRequests: 0,
  rateLimitedRequests: 0,
  recentBlocks: [],
};

function recordBlock(req: Request, reason: string) {
  firewallState.blockedRequests += 1;
  firewallState.recentBlocks.unshift({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    reason,
  });
  if (firewallState.recentBlocks.length > 20) {
    firewallState.recentBlocks.length = 20;
  }
}

export function getFirewallTelemetry(): FirewallTelemetry {
  return {
    active: true,
    inspectedRequests: firewallState.inspectedRequests,
    blockedRequests: firewallState.blockedRequests,
    rateLimitedRequests: firewallState.rateLimitedRequests,
    allowedEgressHosts: [...ALLOWED_EXTERNAL_HOSTS],
    recentBlocks: [...firewallState.recentBlocks],
  };
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DANGEROUS_NOSQL_KEY_RE = /^\$(?:gt|gte|lt|lte|ne|in|nin|or|and|not|nor|where|regex|expr|function)$/i;
const XSS_PATTERN = /<\s*script\b|javascript\s*:|on(?:error|load|click|mouseover)\s*=/i;
const PATH_TRAVERSAL_PATTERN = /(?:\.\.[/\\]|%2e%2e|%252e%252e|\0)/i;
const SHELL_PROBE_PATTERN = /(?:;\s*(?:cat|ls|rm|curl|wget|bash|sh|nc|python)\b|\$\([^)]+\)|`[^`]+`)/i;

export function inspectPayloadForThreats(value: unknown, depth = 0): string | null {
  if (depth > 12) {
    return 'Payload nesting depth exceeded';
  }
  if (typeof value === 'string') {
    if (XSS_PATTERN.test(value)) {
      return 'Script injection signature detected in request payload';
    }
    if (SHELL_PROBE_PATTERN.test(value)) {
      return 'Command injection signature detected in request payload';
    }
    if (value.includes('\0')) {
      return 'Null byte detected in request payload';
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const reason = inspectPayloadForThreats(value[i], depth + 1);
      if (reason) return reason;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return `Prototype pollution key "${key}" rejected`;
      }
      if (DANGEROUS_NOSQL_KEY_RE.test(key)) {
        return `Disallowed query operator "${key}" rejected`;
      }
      const reason = inspectPayloadForThreats(obj[key], depth + 1);
      if (reason) return reason;
    }
  }
  return null;
}

export function checkRequestUrlAndQuery(
  rawUrl: string,
  queryObj: Record<string, unknown>,
): string | null {
  let decodedUrl = rawUrl;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {
    return 'Malformed URL encoding rejected';
  }

  if (PATH_TRAVERSAL_PATTERN.test(rawUrl) || PATH_TRAVERSAL_PATTERN.test(decodedUrl)) {
    return 'Path traversal or null-byte probe blocked';
  }
  if (XSS_PATTERN.test(decodedUrl)) {
    return 'XSS probe in URL/query blocked';
  }
  if (SHELL_PROBE_PATTERN.test(decodedUrl)) {
    return 'Command probe in URL/query blocked';
  }

  return inspectPayloadForThreats(queryObj);
}

const ALLOWED_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST']);

export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Keep iframe compatibility for AI Studio preview while restricting script/connect origins
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://myvariant.info https://mygene.info https://eutils.ncbi.nlm.nih.gov https://search.clinicalgenome.org https://storage.googleapis.com",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  );

  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }

  next();
}

export function wafInspectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  firewallState.inspectedRequests += 1;

  if (!ALLOWED_HTTP_METHODS.has(req.method.toUpperCase())) {
    recordBlock(req, `HTTP method ${req.method} disallowed`);
    res.status(405).json({ error: 'Method not allowed by application firewall.' });
    return;
  }

  const urlThreat = checkRequestUrlAndQuery(
    req.originalUrl || req.url,
    req.query as Record<string, unknown>,
  );
  if (urlThreat) {
    recordBlock(req, urlThreat);
    res.status(403).json({ error: `Blocked by application firewall: ${urlThreat}` });
    return;
  }

  if (req.body !== undefined) {
    const bodyThreat = inspectPayloadForThreats(req.body);
    if (bodyThreat) {
      recordBlock(req, bodyThreat);
      res.status(400).json({ error: `Blocked by application firewall: ${bodyThreat}` });
      return;
    }
  }

  next();
}

export function createRateLimitMiddleware(options: {
  windowMs: number;
  maxRequests: number;
  label: string;
}) {
  const buckets = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : '') ||
      req.ip ||
      'unknown';

    const key = `${options.label}:${clientIp}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const recent = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= options.maxRequests) {
      firewallState.rateLimitedRequests += 1;
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({
        error: 'Rate limit exceeded. Please wait briefly before retrying.',
      });
      return;
    }

    recent.push(now);
    buckets.set(key, recent);

    if (buckets.size > 2000) {
      for (const [k, stamps] of buckets.entries()) {
        if (stamps.every((ts) => ts <= cutoff)) {
          buckets.delete(k);
        }
      }
    }

    next();
  };
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export function validateExternalHttpsUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Blocked invalid external URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`SSRF firewall blocked non-HTTPS protocol "${parsed.protocol}".`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('SSRF firewall blocked URL credentials.');
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(host)) {
    throw new Error(`SSRF firewall blocked private/loopback target "${host}".`);
  }
  if (!ALLOWED_HOST_SET.has(host)) {
    throw new Error(`SSRF firewall blocked unallowlisted egress host "${host}".`);
  }
  return parsed;
}

export async function safeExternalFetch(
  rawUrl: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<globalThis.Response> {
  const validated = validateExternalHttpsUrl(rawUrl);
  const { timeoutMs = 10000, ...restInit } = init;
  return fetch(validated.toString(), {
    ...restInit,
    redirect: 'error',
    signal: restInit.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

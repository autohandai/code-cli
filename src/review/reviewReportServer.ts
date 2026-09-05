/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MAX_REVIEW_REPORT_BYTES = 8 * 1024 * 1024;
export const REVIEW_REPORT_HOST = '127.0.0.1' as const;

interface ReviewReportPayload {
  format: 'markdown' | 'json';
  name: string;
  content: string;
}

interface StaticAsset {
  content: Buffer;
  contentType: string;
}

export interface ReviewReportServerOptions {
  reportPath?: string;
  port?: number;
  open?: boolean;
  assetRoot?: string;
  openUrl?: (url: string) => Promise<void>;
}

export interface ReviewReportServerHandle {
  host: typeof REVIEW_REPORT_HOST;
  port: number;
  url: string;
  close(): Promise<void>;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const STATIC_ROUTES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/fonts/AutohandMono-Regular.woff2': ['fonts/AutohandMono-Regular.woff2', 'font/woff2'],
  '/fonts/AutohandSans-Regular.woff2': ['fonts/AutohandSans-Regular.woff2', 'font/woff2'],
} as const;

type StaticRoute = keyof typeof STATIC_ROUTES;

function setSecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

function send(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  content: Buffer,
  headOnly: boolean,
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(content.byteLength));
  response.end(headOnly ? undefined : content);
}

function plainText(response: ServerResponse, statusCode: number, message: string, headOnly: boolean): void {
  send(response, statusCode, 'text/plain; charset=utf-8', Buffer.from(message), headOnly);
}

function isStaticRoute(pathname: string): pathname is StaticRoute {
  return Object.hasOwn(STATIC_ROUTES, pathname);
}

async function loadStaticAssets(assetRoot: string): Promise<Map<StaticRoute, StaticAsset>> {
  const entries = await Promise.all(
    Object.entries(STATIC_ROUTES).map(async ([route, [relativePath, contentType]]) => {
      const content = await readFile(path.join(assetRoot, relativePath));
      return [route as StaticRoute, { content, contentType }] as const;
    }),
  );
  return new Map(entries);
}

async function loadReport(reportPath: string | undefined): Promise<ReviewReportPayload> {
  if (!reportPath) {
    return {
      format: 'markdown',
      name: 'No report selected',
      content: '# No report selected\n\nRun `autohand review`, save its output, then pass that file to `autohand review serve`.',
    };
  }

  const absolutePath = path.resolve(reportPath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Review report must be a regular file: ${absolutePath}`);
  }
  if (fileStat.size > MAX_REVIEW_REPORT_BYTES) {
    throw new Error(`Review report is too large. Maximum size is ${MAX_REVIEW_REPORT_BYTES} bytes.`);
  }

  const content = await readFile(absolutePath);
  if (content.byteLength > MAX_REVIEW_REPORT_BYTES) {
    throw new Error(`Review report is too large. Maximum size is ${MAX_REVIEW_REPORT_BYTES} bytes.`);
  }

  return {
    format: path.extname(absolutePath).toLowerCase() === '.json' ? 'json' : 'markdown',
    name: path.basename(absolutePath),
    content: content.toString('utf8'),
  };
}

async function resolveAssetRoot(explicitRoot: string | undefined): Promise<string> {
  if (explicitRoot) return path.resolve(explicitRoot);

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDirectory, 'assets', 'review'),
    path.resolve(moduleDirectory, '..', '..', 'assets', 'review'),
    path.resolve(process.cwd(), 'assets', 'review'),
  ];

  for (const candidate of candidates) {
    try {
      const indexStat = await stat(path.join(candidate, 'index.html'));
      if (indexStat.isFile()) return candidate;
    } catch {
      // Try the next source-tree or packaged-asset location.
    }
  }

  throw new Error('Autohand Review viewer assets are missing. Reinstall or rebuild the CLI.');
}

async function defaultOpenUrl(url: string): Promise<void> {
  const open = await import('open').then((module) => module.default);
  await open(url);
}

export async function startReviewReportServer(
  options: ReviewReportServerOptions,
): Promise<ReviewReportServerHandle> {
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Review server port must be an integer from 0 to 65535.');
  }

  const [assetRoot, report] = await Promise.all([
    resolveAssetRoot(options.assetRoot),
    loadReport(options.reportPath),
  ]);
  const assets = await loadStaticAssets(assetRoot);
  const reportBody = Buffer.from(JSON.stringify(report));

  const server = createServer((request, response) => {
    setSecurityHeaders(response);
    const method = request.method ?? 'GET';
    const headOnly = method === 'HEAD';
    if (method !== 'GET' && !headOnly) {
      response.setHeader('Allow', 'GET, HEAD');
      plainText(response, 405, 'Method not allowed', false);
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', `http://${REVIEW_REPORT_HOST}`).pathname;
    } catch {
      plainText(response, 400, 'Bad request', headOnly);
      return;
    }

    if (pathname === '/report') {
      send(response, 200, 'application/json; charset=utf-8', reportBody, headOnly);
      return;
    }

    if (!isStaticRoute(pathname)) {
      plainText(response, 404, 'Not found', headOnly);
      return;
    }

    const asset = assets.get(pathname);
    if (!asset) {
      plainText(response, 500, 'Viewer asset unavailable', headOnly);
      return;
    }
    send(response, 200, asset.contentType, asset.content, headOnly);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, REVIEW_REPORT_HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Autohand Review server did not expose a TCP address.');
  }

  let closed = false;
  const handle: ReviewReportServerHandle = {
    host: REVIEW_REPORT_HOST,
    port: address.port,
    url: `http://${REVIEW_REPORT_HOST}:${address.port}/`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };

  if (options.open) {
    try {
      await (options.openUrl ?? defaultOpenUrl)(handle.url);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  return handle;
}

export async function serveReviewReport(options: ReviewReportServerOptions): Promise<void> {
  const handle = await startReviewReportServer(options);
  process.stdout.write(`Autohand Review report: ${handle.url}\nPress Ctrl+C to stop.\n`);

  await new Promise<void>((resolve, reject) => {
    const shutdown = (): void => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      void handle.close().then(resolve, reject);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

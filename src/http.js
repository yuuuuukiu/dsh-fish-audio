import http from 'node:http';
import https from 'node:https';
import { getProxyUrl } from './config.js';

/**
 * Perform an HTTP or HTTPS request, routing through proxy if configured.
 *
 * @param {string} urlStr - Target URL
 * @param {object} options - method, headers, body, timeoutMs, proxyUrl
 * @returns {Promise<{ status: number, headers: object, body: Buffer, text: () => string, json: () => any }>}
 */
export function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(urlStr);
    const isHttps = targetUrl.protocol === 'https:';
    const proxyUrl = options.proxyUrl !== undefined ? options.proxyUrl : getProxyUrl();

    let finished = false;
    const timeoutMs = options.timeoutMs || 45000;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error(`HTTP request timed out after ${timeoutMs}ms for ${urlStr}`));
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      finished = true;
    }

    if (isHttps && proxyUrl) {
      let pUrl;
      try {
        pUrl = new URL(proxyUrl);
      } catch {
        pUrl = new URL('http://127.0.0.1:7892');
      }

      const proxyReq = http.request({
        host: pUrl.hostname,
        port: pUrl.port || 80,
        method: 'CONNECT',
        path: `${targetUrl.hostname}:${targetUrl.port || 443}`,
        headers: {
          Host: `${targetUrl.hostname}:${targetUrl.port || 443}`,
        },
      });

      proxyReq.on('connect', (res, socket) => {
        if (finished) {
          socket.destroy();
          return;
        }
        if (res.statusCode !== 200) {
          cleanup();
          socket.destroy();
          return reject(new Error(`Proxy CONNECT failed: HTTP ${res.statusCode} ${res.statusMessage}`));
        }

        const req = https.request({
          host: targetUrl.hostname,
          port: targetUrl.port || 443,
          path: targetUrl.pathname + targetUrl.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          socket,
          agent: false,
        }, (resp) => {
          const chunks = [];
          resp.on('data', c => chunks.push(c));
          resp.on('end', () => {
            cleanup();
            const buf = Buffer.concat(chunks);
            resolve({
              status: resp.statusCode,
              headers: resp.headers,
              body: buf,
              text: () => buf.toString('utf8'),
              json: () => JSON.parse(buf.toString('utf8')),
            });
          });
        });

        req.on('error', (err) => {
          if (!finished) {
            cleanup();
            reject(err);
          }
        });

        if (options.body) {
          if (Buffer.isBuffer(options.body) || typeof options.body === 'string') {
            req.write(options.body);
          } else {
            req.write(JSON.stringify(options.body));
          }
        }
        req.end();
      });

      proxyReq.on('error', (_err) => {
        // Fallback to direct request if proxy fails
        if (!finished) {
          directRequest(targetUrl, options).then(
            (res) => { cleanup(); resolve(res); },
            (err) => { cleanup(); reject(err); }
          );
        }
      });

      proxyReq.end();
    } else {
      directRequest(targetUrl, options).then(
        (res) => { cleanup(); resolve(res); },
        (err) => { cleanup(); reject(err); }
      );
    }
  });
}

function directRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request({
      host: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: resp.statusCode,
          headers: resp.headers,
          body: buf,
          text: () => buf.toString('utf8'),
          json: () => JSON.parse(buf.toString('utf8')),
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      if (Buffer.isBuffer(options.body) || typeof options.body === 'string') {
        req.write(options.body);
      } else {
        req.write(JSON.stringify(options.body));
      }
    }
    req.end();
  });
}

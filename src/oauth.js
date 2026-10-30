import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname } from 'node:path';
import { CREDENTIALS_DIR, CREDENTIALS_FILE, OAUTH_CONFIG } from './config.js';
import { httpRequest } from './http.js';

/**
 * Load saved OAuth credentials.
 * @returns {object|null}
 */
export function loadTokens() {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null;
    const content = readFileSync(CREDENTIALS_FILE, 'utf8');
    const data = JSON.parse(content);
    if (!data.access_token) return null;
    return data;
  } catch (_err) {
    return null;
  }
}

/**
 * Save OAuth credentials to disk.
 * @param {object} tokens
 */
export function saveTokens(tokens) {
  try {
    if (!existsSync(CREDENTIALS_DIR)) {
      mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
    }
    const current = loadTokens() || {};
    const merged = {
      ...current,
      ...tokens,
      updated_at: Date.now(),
    };
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(merged, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    return merged;
  } catch (err) {
    console.error('[fish-audio-oauth] Failed to save tokens:', err);
    throw err;
  }
}

/**
 * Clear saved OAuth credentials.
 */
export function clearTokens() {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      rmSync(CREDENTIALS_FILE, { force: true });
    }
  } catch (err) {
    console.error('[fish-audio-oauth] Failed to clear tokens:', err);
  }
}

/**
 * Check if the current tokens are still valid.
 * @param {object|null} tokens
 * @param {number} [bufferSeconds=60]
 * @returns {boolean}
 */
export function isTokenValid(tokens, bufferSeconds = 60) {
  if (!tokens || !tokens.access_token) return false;
  if (!tokens.expires_at) return true; // No expiration indicated
  return Date.now() < tokens.expires_at - bufferSeconds * 1000;
}

/**
 * Register dynamic client if not already registered.
 * @param {string[]} redirectUris
 * @returns {Promise<string>} client_id
 */
export async function getOrRegisterClientId(redirectUris) {
  const tokens = loadTokens();
  if (tokens?.client_id) {
    return tokens.client_id;
  }

  const payload = {
    client_name: OAUTH_CONFIG.clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };

  const res = await httpRequest(OAUTH_CONFIG.registerEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Dynamic Client Registration failed (HTTP ${res.status}): ${res.text()}`);
  }

  const json = res.json();
  if (!json.client_id) {
    throw new Error(`Dynamic Client Registration did not return client_id: ${res.text()}`);
  }

  saveTokens({ client_id: json.client_id });
  return json.client_id;
}

/**
 * Refresh access token using refresh_token.
 * @param {object} tokens
 * @returns {Promise<object>} updated tokens
 */
export async function refreshAccessToken(tokens) {
  if (!tokens?.refresh_token) {
    throw new Error('No refresh_token available for token refresh.');
  }

  const allRedirectUris = OAUTH_CONFIG.callbackPorts.map(p => `http://127.0.0.1:${p}${OAUTH_CONFIG.callbackPath}`);
  const clientId = tokens.client_id || (await getOrRegisterClientId(allRedirectUris));
  const bodyParams = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });

  const res = await httpRequest(OAUTH_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: bodyParams.toString(),
  });

  if (res.status !== 200) {
    throw new Error(`Token refresh failed (HTTP ${res.status}): ${res.text()}`);
  }

  const json = res.json();
  const expiresIn = json.expires_in || 3600;
  const updated = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (expiresIn - 60) * 1000,
    token_type: json.token_type || 'Bearer',
    scope: json.scope || tokens.scope,
  };

  return saveTokens(updated);
}

/**
 * Open URL in the user's default browser window.
 * @param {string} url
 */
function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    execFile('open', [url], (err) => {
      if (err) console.error('[fish-audio-oauth] Failed to open browser:', err);
    });
  } else if (platform === 'win32') {
    execFile('cmd', ['/c', 'start', '""', url], (err) => {
      if (err) console.error('[fish-audio-oauth] Failed to open browser:', err);
    });
  } else {
    execFile('xdg-open', [url], (err) => {
      if (err) console.error('[fish-audio-oauth] Failed to open browser:', err);
    });
  }
}

/**
 * Set an access token manually (e.g. from browser localStorage or direct input).
 * @param {string} accessToken
 * @param {object} [options]
 * @returns {object} saved tokens
 */
export function setManualToken(accessToken, options = {}) {
  const cleanToken = accessToken.trim().replace(/^Bearer\s+/i, '');
  const expiresIn = options.expiresIn || 86400 * 30; // 30 days
  return saveTokens({
    client_id: options.clientId || 'manual_client',
    access_token: cleanToken,
    refresh_token: options.refreshToken || null,
    expires_at: Date.now() + expiresIn * 1000,
    token_type: 'Bearer',
    scope: 'mcp',
    manual: true,
  });
}

/**
 * Trigger OAuth 2.0 PKCE login by starting a local callback server
 * and opening the authorization URL in a browser window.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs=300000] 5 minutes timeout
 * @param {(url: string) => void} [options.onAuthUrl]
 * @returns {Promise<object>} tokens
 */
export async function loginViaBrowser(options = {}) {
  const timeoutMs = options.timeoutMs || 300000;

  // 1. Generate PKCE verifier and challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  // 2. Select port and start HTTP server
  let server;
  let activePort;
  const ports = OAUTH_CONFIG.callbackPorts;

  for (const port of ports) {
    try {
      await new Promise((resolve, reject) => {
        const s = http.createServer();
        s.once('error', reject);
        s.listen(port, '127.0.0.1', () => {
          server = s;
          activePort = port;
          resolve();
        });
      });
      break;
    } catch (_err) {
      // Try next port
    }
  }

  if (!server) {
    throw new Error(`Failed to bind local callback server on any port in [${ports.join(', ')}]`);
  }

  const redirectUri = `http://127.0.0.1:${activePort}${OAUTH_CONFIG.callbackPath}`;
  const allRedirectUris = ports.map(p => `http://127.0.0.1:${p}${OAUTH_CONFIG.callbackPath}`);

  // 3. Get or register client ID
  const clientId = await getOrRegisterClientId(allRedirectUris);

  // 4. Build authorize URL
  const authUrlObj = new URL(OAUTH_CONFIG.authorizeEndpoint);
  authUrlObj.searchParams.set('client_id', clientId);
  authUrlObj.searchParams.set('response_type', 'code');
  authUrlObj.searchParams.set('redirect_uri', redirectUri);
  authUrlObj.searchParams.set('code_challenge', codeChallenge);
  authUrlObj.searchParams.set('code_challenge_method', 'S256');
  authUrlObj.searchParams.set('scope', OAUTH_CONFIG.scopes.join(' '));
  authUrlObj.searchParams.set('state', state);

  const authUrl = authUrlObj.toString();

  // 5. Open browser window
  if (options.onAuthUrl) {
    options.onAuthUrl(authUrl);
  } else {
    process.stderr.write(`\n🔗 [Fish Audio OAuth] 正在弹出浏览器进行授权...\n🔗 授权地址: ${authUrl}\n\n`);
  }
  openBrowser(authUrl);

  // 6. Wait for callback
  return new Promise((resolve, reject) => {
    let handled = false;

    const timer = setTimeout(() => {
      if (!handled) {
        handled = true;
        server.close();
        reject(new Error(`OAuth authorization timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    server.on('request', async (req, res) => {
      if (handled) return;

      const reqUrl = new URL(req.url, `http://127.0.0.1:${activePort}`);
      if (reqUrl.pathname !== OAUTH_CONFIG.callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const receivedState = reqUrl.searchParams.get('state');
      const error = reqUrl.searchParams.get('error');
      const errorDescription = reqUrl.searchParams.get('error_description');
      const code = reqUrl.searchParams.get('code');

      if (error) {
        handled = true;
        clearTimeout(timer);
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderErrorHtml(error, errorDescription));
        server.close();
        return reject(new Error(`OAuth error from server: ${error} (${errorDescription || ''})`));
      }

      if (!code || receivedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderErrorHtml('Invalid Request', 'State validation failed or authorization code missing.'));
        return;
      }

      // Success callback!
      handled = true;
      clearTimeout(timer);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderSuccessHtml());
      server.close();

      try {
        // Exchange code for tokens
        const bodyParams = new URLSearchParams({
          client_id: clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        });

        const tokenRes = await httpRequest(OAUTH_CONFIG.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: bodyParams.toString(),
        });

        if (tokenRes.status !== 200) {
          throw new Error(`Token exchange failed (HTTP ${tokenRes.status}): ${tokenRes.text()}`);
        }

        const tokenJson = tokenRes.json();
        const expiresIn = tokenJson.expires_in || 3600;
        const saved = saveTokens({
          client_id: clientId,
          access_token: tokenJson.access_token,
          refresh_token: tokenJson.refresh_token,
          expires_at: Date.now() + (expiresIn - 60) * 1000,
          token_type: tokenJson.token_type || 'Bearer',
          scope: tokenJson.scope || 'mcp',
        });

        process.stderr.write(`✨ [Fish Audio OAuth] 授权成功！Token 已保存至 ~/.fish-audio/oauth.json\n`);
        resolve(saved);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Ensure valid authentication tokens exist.
 * If expired, automatically refresh.
 * If not logged in, only open browser when autoPopup is explicitly allowed and not disabled.
 *
 * @param {object} [options]
 * @param {boolean} [options.autoPopup=false] Whether to automatically open browser window
 * @returns {Promise<string>} access_token
 */
export async function ensureAuth(options = {}) {
  let tokens = loadTokens();

  if (tokens && isTokenValid(tokens)) {
    return tokens.access_token;
  }

  // Try refreshing token if available
  if (tokens?.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(tokens);
      if (refreshed?.access_token) {
        return refreshed.access_token;
      }
    } catch (_err) {
      // Refresh failed
    }
  }

  // Check if popup is disabled via environment or config
  const disablePopup = process.env.FISH_AUDIO_DISABLE_POPUP === '1' || process.env.FISH_AUDIO_DISABLE_POPUP === 'true';

  if (!options.autoPopup || disablePopup) {
    throw new Error('Fish Audio OAuth 未登录。请使用 `fish-audio-mcp login` 登录或使用 API Key。');
  }

  // Explicitly requested auto-popup browser window
  process.stderr.write(`\n🔔 [Fish Audio MCP] 检测到未登录或凭据失效，正在弹出窗口进行 OAuth 登录...\n`);
  const newTokens = await loginViaBrowser();
  return newTokens.access_token;
}

function renderSuccessHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fish Audio 授权成功</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
      background: #09090b; color: #f4f4f5;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 12px 36px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 22px;
      color: #38bdf8;
      font-weight: 600;
    }
    p {
      margin: 0 0 24px;
      color: #a1a1aa;
      font-size: 15px;
      line-height: 1.6;
    }
    .badge {
      display: inline-block;
      background: #27272a;
      color: #4ade80;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🐟✨</div>
    <h1>Fish Audio 授权成功！</h1>
    <p>MCP 服务已顺利连接您的 Fish Audio 账户。<br>您可以安全关闭此标签页，返回终端或助手继续使用。</p>
    <div class="badge">● 已连接 / OAuth Connected</div>
  </div>
</body>
</html>`;
}

function renderErrorHtml(error, description) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fish Audio 授权失败</title>
  <style>
    body {
      margin: 0; padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
      background: #09090b; color: #f4f4f5;
    }
    .card {
      background: #18181b;
      border: 1px solid #7f1d1d;
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      max-width: 440px;
      width: 100%;
    }
    h1 { color: #f87171; margin: 0 0 12px; font-size: 22px; }
    p { color: #a1a1aa; font-size: 14px; line-height: 1.6; }
    code { background: #27272a; padding: 2px 6px; border-radius: 4px; color: #fb7185; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px;">❌</div>
    <h1>授权遇到问题</h1>
    <p><code>${error}</code></p>
    <p>${description || '用户取消授权或授权链接失效，请返回终端重新触发登录。'}</p>
  </div>
</body>
</html>`;
}

import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export const CREDENTIALS_DIR = path.join(os.homedir(), '.fish-audio');
export const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'oauth.json');
export const CONFIG_FILE = path.join(CREDENTIALS_DIR, 'config.json');

export const OAUTH_CONFIG = {
  issuer: 'https://api.fish.audio',
  authorizeEndpoint: 'https://fish.audio/oauth/authorize',
  tokenEndpoint: 'https://api.fish.audio/oauth/token',
  registerEndpoint: 'https://api.fish.audio/oauth/register',
  clientName: 'Fish Audio MCP (Antigravity & DSH)',
  scopes: ['mcp'],
  callbackPorts: [18999, 18998, 18997],
  callbackPath: '/callback',
};

export const MCP_ENDPOINT = 'https://api.fish.audio/mcp';
export const REST_API_ENDPOINT = 'https://api.fish.audio/v1';

export function getProxyUrl() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    loadUserConfig().proxy_url ||
    ''
  );
}

/**
 * Load global user configuration (apiKey, default voice, options)
 */
export function loadUserConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_e) {
    return {};
  }
}

/**
 * Save global user configuration
 */
export function saveUserConfig(config) {
  try {
    if (!existsSync(CREDENTIALS_DIR)) {
      mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
    }
    const current = loadUserConfig();
    const merged = { ...current, ...config };
    writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    return merged;
  } catch (err) {
    console.error('[fish-audio-config] Failed to save config:', err.message);
    throw err;
  }
}

/**
 * Get configured API Key from env or config file
 */
export function getEffectiveApiKey() {
  return (
    process.env.FISH_AUDIO_API_KEY ||
    loadUserConfig().api_key ||
    ''
  );
}

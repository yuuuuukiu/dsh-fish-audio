import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { getEffectiveApiKey, loadUserConfig, saveUserConfig } from './config.js';
import { httpRequest } from './http.js';

export const DEFAULT_VOICE_ID = '568fe6a62f294908936212ce81e201e2'; // 雌小鬼音色
export const DEFAULT_MODEL_ID = 's2.1-pro-free'; // 官方免费无限引擎模型

/**
 * 基础默认模型目录（当离线或首次启动时使用）
 */
export const INITIAL_MODELS = [
  {
    id: 's2.1-pro-free',
    type: 'tts',
    name: 'Fish Audio S2.1-Pro Free',
    pricing: '免费 ($0，无限使用)',
    description: '官方推荐免费模型，具备与 S2.1-Pro 完全相同的顶级音质，支持 83 种语言与自然语言情感微调。',
    default: true,
  },
  {
    id: 'drama-3',
    type: 'tts',
    name: 'Fish Audio Drama 3',
    pricing: '付费点播 (按字数扣除账户 API 积分)',
    description: 'Drama 3 旗舰短剧与情感表现力模型，支持复杂情绪转换与自然语言表演控制。',
  },
  {
    id: 's2.1-pro',
    type: 'tts',
    name: 'Fish Audio S2.1-Pro',
    pricing: '付费点播 (按字数扣除账户 API 积分)',
    description: '旗舰级商业生产环境 TTS 模型，极速响应，支持商业级高并发。',
  },
  {
    id: 's2-pro',
    type: 'tts',
    name: 'Fish Audio S2-Pro',
    pricing: '经典通道',
    description: '经典成熟架构语音合成模型，适合长文本与长篇朗读。',
  },
  {
    id: 'transcribe-1-pro',
    type: 'asr',
    name: 'Fish Audio Transcribe 1 Pro',
    pricing: '付费点播 (按音频秒数扣费)',
    description: '官方高精度语音识别模型，支持说话人分离与环境音过滤。',
  },
  {
    id: 'transcribe-1',
    type: 'asr',
    name: 'Fish Audio Transcribe 1 Flash',
    pricing: '低费率点播',
    description: '轻量极速语音识别转写模型。',
  },
];

export let OFFICIAL_MODELS = [...INITIAL_MODELS];

let cachedModels = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 300_000; // 5分钟动态缓存

/**
 * 从 Fish Audio 官方 OpenAPI 实时拉取最新支持的底层模型枚举清单
 */
export async function fetchRemoteModels(options = {}) {
  const now = Date.now();
  if (!options.force && cachedModels && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedModels;
  }
  try {
    const proxyUrl = options.proxyUrl;
    const res = await httpRequest('https://api.fish.audio/openapi.json', {
      method: 'GET',
      proxyUrl,
      timeoutMs: options.timeoutMs || 8000,
    });
    if (res.status === 200) {
      const spec = JSON.parse(res.text());
      const ttsParam = spec.paths?.['/v1/tts']?.post?.parameters?.find((p) => p.name === 'model');
      const asrParam = spec.paths?.['/v1/asr']?.post?.parameters?.find((p) => p.name === 'model');
      const ttsEnums = ttsParam?.schema?.enum || [];
      const asrEnums = asrParam?.schema?.enum || [];

      const models = [];
      for (const id of ttsEnums) {
        const isFree = id.includes('free');
        models.push({
          id,
          type: 'tts',
          name: id === 's2.1-pro-free' ? 'Fish Audio S2.1-Pro Free' : `Fish Audio ${id}`,
          pricing: isFree ? '免费 ($0，无限使用)' : '付费点播 (按字数扣除账户 API 积分)',
          description: isFree
            ? '官方推荐免费模型，具备与 S2.1-Pro 完全相同的顶级音质，支持 83 种语言与自然语言情感微调。'
            : id.includes('drama')
              ? 'Drama 3 旗舰短剧与情感表现力模型，支持复杂情绪转换与自然语言表演控制。'
              : `Fish Audio 官方商业 TTS 引擎模型 (${id})。`,
          default: isFree,
        });
      }
      for (const id of asrEnums) {
        models.push({
          id,
          type: 'asr',
          name: `Fish Audio ${id}`,
          pricing: id.includes('pro') ? '高精度付费点播 (按音频秒数扣费)' : '低费率点播',
          description: `Fish Audio 官方 ASR 语音识别转写模型 (${id})。`,
        });
      }
      if (models.length > 0) {
        cachedModels = models;
        OFFICIAL_MODELS = models;
        lastFetchTime = now;
        return models;
      }
    }
  } catch (_e) {
    // 降级使用当前缓存或基础模型
  }
  return cachedModels || OFFICIAL_MODELS;
}

// ──────────────────────────────────────────────
// 1. 底层引擎模型 (Engine Model) 管理
// ──────────────────────────────────────────────

export function listOfficialModels(type = null) {
  const current = cachedModels || OFFICIAL_MODELS;
  if (type) {
    return current.filter((m) => m.type === type);
  }
  return current;
}

export async function listOfficialModelsAsync(type = null, options = {}) {
  const models = await fetchRemoteModels(options);
  if (type) {
    return models.filter((m) => m.type === type);
  }
  return models;
}

export function getActiveModel() {
  const cfg = loadUserConfig();
  return cfg.default_model || DEFAULT_MODEL_ID;
}

export async function setActiveModelAsync(modelName, options = {}) {
  const clean = modelName.trim().toLowerCase();
  const models = await fetchRemoteModels(options);
  const matched = models.find((m) => m.id.toLowerCase() === clean);
  saveUserConfig({ default_model: clean });
  return matched || { id: clean, name: `Fish Audio ${clean}`, pricing: '点播/自定义模型' };
}

export function setActiveModel(modelName) {
  const clean = modelName.trim().toLowerCase();
  const models = cachedModels || OFFICIAL_MODELS;
  const matched = models.find((m) => m.id.toLowerCase() === clean);
  // 不再抛出“未知模型”异常阻断，允许用户或模型设置任何官方新发布的或者实验性模型 ID
  saveUserConfig({ default_model: clean });
  return matched || { id: clean, name: `Fish Audio ${clean}`, pricing: '点播/自定义模型' };
}

// ──────────────────────────────────────────────
// 2. 角色音色 (Voice / Reference ID) 管理
// ──────────────────────────────────────────────

export function getActiveVoice() {
  const cfg = loadUserConfig();
  return cfg.default_voice || cfg.default_model_id || DEFAULT_VOICE_ID;
}

export async function setActiveVoice(voiceId) {
  const cleanId = voiceId.trim();
  const info = await getVoice(cleanId);
  saveUserConfig({ default_voice: cleanId });
  return info;
}

export async function getVoice(voiceId) {
  const cleanId = voiceId.trim();
  const apiKey = getEffectiveApiKey();
  const res = await httpRequest(`https://api.fish.audio/model/${cleanId}`, {
    method: 'GET',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });

  if (res.status !== 200) {
    throw new Error(`未找到 ID 为 "${cleanId}" 的音色 (HTTP ${res.status})。请检查 32 位音色 ID 是否正确。`);
  }

  return res.json();
}

// 兼容性别名
export const getModel = getVoice;
export const getActiveVoiceModel = getActiveVoice;
export const setActiveVoiceModel = setActiveVoice;

export async function searchVoices(query = '', options = {}) {
  const apiKey = getEffectiveApiKey();
  const searchUrl = new URL('https://api.fish.audio/model');
  if (query) {
    searchUrl.searchParams.set('title', query);
  }
  searchUrl.searchParams.set('page_size', String(options.page_size || 15));
  if (options.page_number) {
    searchUrl.searchParams.set('page_number', String(options.page_number));
  }

  const res = await httpRequest(searchUrl.toString(), {
    method: 'GET',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });

  if (res.status !== 200) {
    throw new Error(`Failed to search voices: HTTP ${res.status}`);
  }

  const data = res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const text = items.length > 0
    ? items.map((m, idx) => {
        const langs = m.languages?.join(', ') || '多语言';
        const author = m.author?.nickname ? `by ${m.author.nickname}` : '';
        const tags = m.tags?.slice(0, 4).join(', ') || '';
        return `${idx + 1}. [${m._id}] ${m.title || '无标题'} (${langs}) ${author}\n   音色标签: ${tags || '无'}`;
      }).join('\n\n')
    : `未找到与 "${query}" 匹配的音色。`;

  return {
    content: [{ type: 'text', text }],
    items,
    total: data.total,
  };
}

// ──────────────────────────────────────────────
// 3. 语音合成 (TTS)
// ──────────────────────────────────────────────

export async function textToSpeech(text, options = {}) {
  const cleanText = text?.trim();
  if (!cleanText) {
    throw new Error('textToSpeech: `text` parameter must be non-empty.');
  }

  const apiKey = options.apiKey || getEffectiveApiKey();
  if (!apiKey) {
    throw new Error('Fish Audio API Key 未配置。请运行 `fish-audio-mcp apikey <sk-fish-...>` 设置。');
  }

  // 音色选择：入参 > 配置的 default_voice > 默认雌小鬼
  const voice = options.voice || options.reference_id || getActiveVoice();
  // 底层引擎模型选择：入参 > 配置的 default_model > s2.1-pro-free
  const model = options.model || options.modelTier || getActiveModel();

  const format = options.format || 'mp3';
  const outDir = options.outputDir
    || (process.env.FISH_AUDIO_OUTPUT_DIR ? resolve(process.env.FISH_AUDIO_OUTPUT_DIR) : resolve(process.cwd(), 'voice'));

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  let filePath = options.outputPath;
  if (filePath) {
    filePath = isAbsolute(filePath) ? filePath : resolve(outDir, filePath);
    const parent = dirname(filePath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  } else {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    filePath = resolve(outDir, `tts_${timestamp}_${rand}.${format}`);
  }

  const payload = {
    text: cleanText,
    reference_id: voice,
    format,
    normalize: true,
    latency: 'normal',
  };

  if (options.speed !== undefined || options.volume !== undefined) {
    payload.prosody = {
      speed: options.speed ?? 1.0,
      volume: options.volume ?? 0,
      normalize_loudness: true,
    };
  }

  const res = await httpRequest('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      model,
    },
    body: JSON.stringify(payload),
  });

  if (res.status !== 200) {
    let errMsg = `Fish Audio TTS HTTP ${res.status}`;
    try {
      const errJson = JSON.parse(res.text());
      if (errJson.message) errMsg += `: ${errJson.message}`;
    } catch {}
    if (res.status === 402) {
      errMsg += ` (当前使用的引擎模型 "${model}" 属于付费点播模型，由于账户余额为 0 或不足导致扣费失败。请使用免费无限额度的 "s2.1-pro-free" 引擎模型)`;
    }
    throw new Error(errMsg);
  }

  writeFileSync(filePath, res.body);

  return {
    text: cleanText,
    localPath: filePath,
    filePath,
    fileSize: res.body.length,
    format,
    voice,
    model,
  };
}

// ──────────────────────────────────────────────
// 4. 账户额度与语音识别
// ──────────────────────────────────────────────

export async function getCreditBalance(customApiKey) {
  const apiKey = customApiKey || getEffectiveApiKey();
  if (!apiKey) {
    throw new Error('Fish Audio API Key 未配置。');
  }

  const res = await httpRequest('https://api.fish.audio/wallet/self/api-credit', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (res.status !== 200) {
    throw new Error(`Failed to query credit balance: HTTP ${res.status}`);
  }

  const data = res.json();
  let pkgInfo = '';
  let pkgData = null;
  try {
    const pkgRes = await httpRequest('https://api.fish.audio/wallet/self/package', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (pkgRes.status === 200) {
      pkgData = pkgRes.json();
      const typeStr = pkgData.type ? pkgData.type.toUpperCase() : 'FREE';
      const periodStr = pkgData.billing_period === 'year' ? '年度订阅' : '月度订阅';
      pkgInfo = `\n- 会员订阅状态: ${typeStr} (${periodStr})\n- 网页端功能积分: ${pkgData.balance ?? 0} / ${pkgData.total ?? 0}`;
    }
  } catch {}

  return {
    content: [
      {
        type: 'text',
        text: `Fish Audio 账户状态 (API Key):\n- 用户 ID: ${data.user_id}${pkgInfo}\n- 开发者 API 余额: $${data.credit}\n- 免费无限引擎: s2.1-pro-free (无限畅享)`,
      },
    ],
    data: {
      ...data,
      package: pkgData,
    },
  };
}

export async function speechToText(audioInput, options = {}) {
  const apiKey = options.apiKey || getEffectiveApiKey();
  if (!apiKey) {
    throw new Error('Fish Audio API Key 未配置。');
  }

  let audioBuffer;
  if (existsSync(audioInput)) {
    audioBuffer = readFileSync(audioInput);
  } else if (/^https?:\/\//i.test(audioInput)) {
    const downloadRes = await httpRequest(audioInput, { method: 'GET' });
    if (downloadRes.status !== 200) {
      throw new Error(`Failed to download audio from ${audioInput}: HTTP ${downloadRes.status}`);
    }
    audioBuffer = downloadRes.body;
  } else {
    throw new Error(`Audio file not found: ${audioInput}`);
  }

  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`,
    audioBuffer,
    `\r\n--${boundary}--\r\n`,
  ];
  const body = Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));

  const res = await httpRequest('https://api.fish.audio/v1/asr', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (res.status === 200) {
    const data = res.json();
    return data.text || JSON.stringify(data);
  }

  if (res.status === 402) {
    return '（Fish Audio ASR 语音识别需账户积分，当前积分余额为 0。TTS 语音合成可使用 s2.1-pro-free 免费畅用。）';
  }

  throw new Error(`ASR API HTTP ${res.status}: ${res.text()}`);
}

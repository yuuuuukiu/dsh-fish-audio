import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { getEffectiveApiKey, loadUserConfig, saveUserConfig } from './config.js';
import { httpRequest } from './http.js';

export const DEFAULT_VOICE_ID = '568fe6a62f294908936212ce81e201e2'; // 雌小鬼音色
export const DEFAULT_MODEL_ID = 's2.1-pro-free'; // 官方免费无限引擎模型

/**
 * 官方引擎模型目录（TTS 合成模型与 ASR 识别模型）
 */
export const OFFICIAL_MODELS = [
  {
    id: 's2.1-pro-free',
    type: 'tts',
    name: 'Fish Audio S2.1-Pro Free',
    pricing: '免费 ($0，无限使用)',
    description: '官方推荐免费模型，具备与 S2.1-Pro 完全相同的顶级音质，支持 83 种语言与自然语言情感微调。',
    default: true,
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

// ──────────────────────────────────────────────
// 1. 底层引擎模型 (Engine Model) 管理
// ──────────────────────────────────────────────

export function listOfficialModels(type = null) {
  if (type) {
    return OFFICIAL_MODELS.filter((m) => m.type === type);
  }
  return OFFICIAL_MODELS;
}

export function getActiveModel() {
  const cfg = loadUserConfig();
  return cfg.default_model || DEFAULT_MODEL_ID;
}

export function setActiveModel(modelName) {
  const clean = modelName.trim().toLowerCase();
  const matched = OFFICIAL_MODELS.find((m) => m.id.toLowerCase() === clean);
  if (!matched && !clean.startsWith('s2') && !clean.startsWith('transcribe')) {
    throw new Error(`未知模型名称 "${modelName}"。请运行 \`fish-audio-mcp model list\` 查看可用模型清单。`);
  }
  saveUserConfig({ default_model: clean });
  return matched || { id: clean, name: clean };
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
  return {
    content: [
      {
        type: 'text',
        text: `Fish Audio 账户状态 (API Key):\n- 用户 ID: ${data.user_id}\n- API 积分/额度: ${data.credit}\n- 累计充值: ${data.cumulative_top_up}\n- 免费引擎模型: s2.1-pro-free (无限畅享)`,
      },
    ],
    data,
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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import {
  textToSpeech,
  speechToText,
  getCreditBalance,
  searchVoices,
  getVoice,
  setActiveVoice,
  getActiveVoice,
  listOfficialModels,
  getActiveModel,
  setActiveModel,
} from './src/index.js';

export const name = 'dsh-fish-audio';
export const inject = ['tools'];

export const Config = z.object({
  apiKey: z.string().role('secret').description('Fish Audio API Key (sk-fish-...)').default(process.env.FISH_AUDIO_API_KEY || ''),
  defaultModelId: z.string().description('默认角色音色 ID (Reference ID，如 568fe6a62f294908936212ce81e201e2 雌小鬼)').default('568fe6a62f294908936212ce81e201e2'),
  modelTier: z.union(['s2.1-pro-free', 's2.1-pro', 's2-pro']).description('底层 TTS 引擎模型 (免费无限请选 s2.1-pro-free)').default('s2.1-pro-free'),
  outputDir: z.string().description('本地音频文件落盘存储目录 (相对路径将基于工作区自动解析)').default('voice'),
  proxyUrl: z.string().description('网络代理地址 (可选，留空则使用系统代理或直连)').default(process.env.HTTP_PROXY || process.env.http_proxy || ''),
});

export function apply(ctx, config) {
  const logger = ctx.logger ?? console;
  const tools = ctx.get('tools') || ctx.tools;
  if (!tools?.register) {
    logger.warn('dsh-fish-audio: tools service unavailable, tool not registered');
    return;
  }

  // ── 1. fish_audio_tts: 语音合成工具 ──
  const ttsTool = {
    name: 'fish_audio_tts',
    description: 'Convert text to speech audio file using Fish Audio. '
      + 'Supports singing via [singing] tag, pitch controls [pitch up]/[pitch down], and emotion tags [whispering], [laughing], [shouting], etc. '
      + 'Returns the local audio file path (MP3) on disk. You MUST then use qqbot_send_file to deliver the voice message.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to synthesize into speech. Can include singing tags [singing], pitch controls [pitch up]/[pitch down], emotion tags [whispering], [laughing], etc.',
        },
        reference_id: {
          type: 'string',
          description: 'Optional Fish Audio character voice ID (Reference ID, e.g. 568fe6a62f294908936212ce81e201e2). If omitted, uses current active voice.',
        },
        voice: {
          type: 'string',
          description: 'Alias for reference_id (character voice ID).',
        },
        model: {
          type: 'string',
          description: 'Underlying engine model (e.g. s2.1-pro-free, s2.1-pro). Defaults to s2.1-pro-free (free tier).',
        },
        speed: {
          type: 'number',
          description: 'Speaking rate multiplier (0.5 to 2.0, default: 1.0).',
        },
        volume: {
          type: 'number',
          description: 'Volume adjustment in dB (-10 to 10, default: 0).',
        },
        format: {
          type: 'string',
          enum: ['mp3', 'wav', 'opus'],
          description: 'Audio format (default: mp3).',
        },
        output_path: {
          type: 'string',
          description: 'Optional custom destination path for the audio file. Defaults to auto-generated file in workspace voice directory.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          fileSize: { type: 'integer' },
          format: { type: 'string' },
          text: { type: 'string' },
          voice: { type: 'string' },
          model: { type: 'string' },
        },
        required: ['filePath', 'fileSize', 'format', 'text'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        return [{
          type: 'text',
          text: `[Fish Audio TTS] 语音已生成: "${value.text}" (${value.fileSize} 字节, 音色: ${value.voice || '默认'}, 模型: ${value.model || 's2.1-pro-free'}) -> ${value.filePath}`,
        }];
      },
    },
    async execute(args, _exec) {
      const text = args.text?.trim();
      if (!text) {
        throw new Error('fish_audio_tts: `text` parameter must be non-empty.');
      }

      const voice = args.voice || args.reference_id || getActiveVoice() || config.defaultModelId;
      const model = args.model || getActiveModel() || config.modelTier || 's2.1-pro-free';
      const format = args.format || 'mp3';

      const baseDir = (ctx.config?.cwd) || process.cwd();
      const outDir = config.outputDir
        ? (isAbsolute(config.outputDir) ? config.outputDir : resolve(baseDir, config.outputDir))
        : resolve(baseDir, 'voice');

      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }

      let filePath = args.output_path;
      if (filePath) {
        filePath = isAbsolute(filePath) ? filePath : resolve(outDir, filePath);
        const parent = dirname(filePath);
        if (!existsSync(parent)) {
          mkdirSync(parent, { recursive: true });
        }
      } else {
        const timestamp = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        filePath = resolve(outDir, `tts_${timestamp}_${rand}.${format}`);
      }

      logger.info?.(`dsh-fish-audio: synthesizing voice for "${text.slice(0, 30)}..." [Voice: ${voice}, Model: ${model}]`);

      try {
        const res = await textToSpeech(text, {
          voice,
          model,
          outputPath: filePath,
          format,
          speed: args.speed,
          volume: args.volume,
          apiKey: config.apiKey,
          proxyUrl: config.proxyUrl,
        });

        logger.info?.(`dsh-fish-audio: generated ${res.fileSize || 0} bytes to ${filePath}`);
        return {
          filePath: res.localPath || filePath,
          fileSize: res.fileSize || 0,
          format,
          text,
          voice: res.voice,
          model: res.model,
        };
      } catch (err) {
        logger.error?.(`dsh-fish-audio: TTS synthesis failed: ${err.message}`);
        throw err;
      }
    },
  };

  // ── 2. fish_audio_models: 查看底层引擎模型列表 ──
  const modelsTool = {
    name: 'fish_audio_models',
    description: 'List official Fish Audio engine models (e.g. s2.1-pro-free, s2.1-pro, transcribe-1-pro) with their features and billing tier.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['tts', 'asr'],
          description: 'Filter models by type: tts (Speech Synthesis) or asr (Speech Recognition).',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          currentModel: { type: 'string' },
          result: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    async execute(args) {
      const models = listOfficialModels(args.type);
      const current = getActiveModel();
      const lines = [
        `🧠 Fish Audio 官方底层引擎模型清单 (当前使用: ${current}):`,
        ...models.map((m, idx) => {
          const mark = m.id === current ? ' ⭐ [当前活跃]' : '';
          return `${idx + 1}. [${m.id}] ${m.name}${mark}\n   类型: ${m.type} | 资费: ${m.pricing}\n   说明: ${m.description}`;
        }),
      ];
      return {
        currentModel: current,
        result: lines.join('\n\n'),
      };
    },
  };

  // ── 3. fish_audio_set_model: 切换底层引擎模型 ──
  const setModelTool = {
    name: 'fish_audio_set_model',
    description: 'Switch the active underlying engine model (e.g. "s2.1-pro-free" for free tier or "s2.1-pro" for paid tier).',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model ID to switch to, e.g. "s2.1-pro-free", "s2.1-pro", "s2-pro".',
        },
      },
      required: ['model'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const updated = setActiveModel(args.model);
      const msg = `🎉 底层引擎模型已切换为: ${updated.id} (${updated.name || updated.id})！资费: ${updated.pricing || '自定义'}`;
      return {
        model: updated.id,
        message: msg,
      };
    },
  };

  // ── 4. fish_audio_voices: 搜索角色音色 ──
  const voicesTool = {
    name: 'fish_audio_voices',
    description: 'Search available character voices / timbres in Fish Audio library by keyword (e.g. 纳西妲, 派蒙, 雌小鬼, 萝莉, 御姐).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword for voice name, character, style, or language tags.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    async execute(args) {
      const res = await searchVoices(args.query || '', { proxyUrl: config.proxyUrl });
      const text = Array.isArray(res?.content)
        ? res.content.map(c => c.text).join('\n')
        : JSON.stringify(res, null, 2);
      return { result: text };
    },
  };

  // ── 5. fish_audio_set_voice: 切换角色音色 ──
  const setVoiceTool = {
    name: 'fish_audio_set_voice',
    description: 'Switch the active character voice (reference_id) using a 32-character voice ID from search results.',
    parameters: {
      type: 'object',
      properties: {
        voice_id: {
          type: 'string',
          description: 'The 32-character hexadecimal voice reference ID.',
        },
      },
      required: ['voice_id'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          voice_id: { type: 'string' },
          title: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const info = await setActiveVoice(args.voice_id);
      const msg = `🎉 角色音色已切换为: [${info._id}] ${info.title} (${info.languages?.join(', ') || '多语言'})！`;
      return {
        voice_id: info._id,
        title: info.title,
        message: msg,
      };
    },
  };

  // ── 6. fish_audio_stt: 语音识别转写工具 ──
  const sttTool = {
    name: 'fish_audio_stt',
    description: 'Transcribe an audio file (local path or HTTPS URL) to text using Fish Audio speech recognition.',
    parameters: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          description: 'Local audio file path or direct HTTPS audio URL to transcribe.',
        },
        language: {
          type: 'string',
          description: 'Optional language hint (e.g. zh, en, ja).',
        },
      },
      required: ['audio'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `[Fish Audio STT] 识别结果: "${value.text}"` }],
    },
    async execute(args) {
      const res = await speechToText(args.audio, {
        language: args.language,
        apiKey: config.apiKey,
        proxyUrl: config.proxyUrl,
      });
      return { text: res };
    },
  };

  // ── 7. fish_audio_balance: 账户余额查询工具 ──
  const balanceTool = {
    name: 'fish_audio_balance',
    description: 'Check your current Fish Audio account plan, remaining credits, and usage limits.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    async execute() {
      const balance = await getCreditBalance({ apiKey: config.apiKey, proxyUrl: config.proxyUrl });
      const text = Array.isArray(balance?.content)
        ? balance.content.map(c => c.text).join('\n')
        : JSON.stringify(balance, null, 2);
      return { result: text };
    },
  };

  tools.register(ttsTool);
  tools.register(modelsTool);
  tools.register(setModelTool);
  tools.register(voicesTool);
  tools.register(setVoiceTool);
  tools.register(sttTool);
  tools.register(balanceTool);

  logger.info?.('dsh-fish-audio: registered tools [fish_audio_tts, fish_audio_models, fish_audio_set_model, fish_audio_voices, fish_audio_set_voice, fish_audio_stt, fish_audio_balance]');
}

// ── Re-export SDK modules for direct programmatic usage ──
export * from './src/index.js';

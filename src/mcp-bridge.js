import readline from 'node:readline';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { getEffectiveApiKey } from './config.js';
import { httpRequest } from './http.js';
import {
  textToSpeech,
  speechToText,
  getCreditBalance,
  searchVoices,
  getVoice,
  getActiveVoice,
  setActiveVoice,
  listOfficialModels,
  getActiveModel,
  setActiveModel,
} from './api.js';

export const BUILTIN_TOOLS = [
  {
    name: 'text_to_speech',
    description: 'Convert text to speech audio file using Fish Audio TTS API. Returns local MP3 file path on disk for immediate delivery via qqbot_send_file.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to synthesize into speech. Can include conversational remarks and emotion tags [whispering], [laughing], etc.',
        },
        voice: {
          type: 'string',
          description: 'Voice ID / character reference ID (e.g. 568fe6a62f294908936212ce81e201e2). If omitted, uses active default voice.',
        },
        reference_id: {
          type: 'string',
          description: 'Alias for voice ID.',
        },
        model: {
          type: 'string',
          description: 'Underlying engine model (e.g. s2.1-pro-free for free unlimited tier, or s2.1-pro). Defaults to s2.1-pro-free.',
        },
        speed: {
          type: 'number',
          description: 'Speaking speed multiplier (0.5 to 2.0, default: 1.0).',
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
          description: 'Optional destination path for the saved audio file.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'speech_to_text',
    description: 'Transcribes audio from a local file path or direct HTTPS URL using Fish Audio ASR.',
    inputSchema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          description: 'Local audio file path or direct HTTPS audio URL.',
        },
        language: {
          type: 'string',
          description: 'Optional language code hint (e.g. zh, en, ja).',
        },
      },
      required: ['audio'],
    },
  },
  {
    name: 'list_models',
    description: 'List official Fish Audio underlying engine models (e.g. s2.1-pro-free, s2.1-pro, transcribe-1-pro) with capabilities and pricing.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['tts', 'asr'],
          description: 'Filter models by type: tts or asr.',
        },
      },
    },
  },
  {
    name: 'set_model',
    description: 'Switch the default underlying engine model (e.g. s2.1-pro-free for free tier or s2.1-pro for paid tier).',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model ID to switch to, e.g. "s2.1-pro-free", "s2.1-pro".',
        },
      },
      required: ['model'],
    },
  },
  {
    name: 'search_voices',
    description: 'Search public and community character voices in Fish Audio voice library.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search voice name, character, style, or language tags.',
        },
        page_size: {
          type: 'number',
          description: 'Number of results to return (default: 15).',
        },
      },
    },
  },
  {
    name: 'get_voice',
    description: 'Get details about a specific character voice using its 32-character ID.',
    inputSchema: {
      type: 'object',
      properties: {
        voice_id: {
          type: 'string',
          description: 'The 32-character hexadecimal voice reference ID.',
        },
      },
      required: ['voice_id'],
    },
  },
  {
    name: 'set_voice',
    description: 'Switch the default character voice persona using a 32-character voice reference ID.',
    inputSchema: {
      type: 'object',
      properties: {
        voice_id: {
          type: 'string',
          description: 'The 32-character hexadecimal voice reference ID.',
        },
      },
      required: ['voice_id'],
    },
  },
  {
    name: 'get_credit_balance',
    description: 'Check current Fish Audio API credit balance, user ID, and recharge quota.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Start the self-contained MCP Stdio Server (API Key Mode)
 */
export async function startMcpBridge() {
  let pendingCount = 0;
  let isClosed = false;

  const maybeExit = () => {
    if (isClosed && pendingCount === 0) {
      process.exit(0);
    }
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  process.stderr.write('[fish-audio-mcp] Stdio MCP Server running in API Key mode (zero browser popup).\n');

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    pendingCount++;
    try {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        process.stderr.write(`[fish-audio-mcp] Invalid JSON: ${err.message}\n`);
        return;
      }

      const isNotification = parsed.id === undefined || parsed.id === null;

      // ── 1. Protocol Handshake ──
      if (parsed.method === 'initialize') {
        sendJsonRpcResult(parsed.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            logging: {},
          },
          serverInfo: {
            name: 'fish-audio-mcp',
            version: '1.0.0',
          },
        });
        return;
      }

      if (parsed.method === 'notifications/initialized') return;
      if (parsed.method === 'ping') {
        sendJsonRpcResult(parsed.id, {});
        return;
      }
      if (parsed.method === 'resources/list') {
        sendJsonRpcResult(parsed.id, { resources: [] });
        return;
      }
      if (parsed.method === 'prompts/list') {
        sendJsonRpcResult(parsed.id, { prompts: [] });
        return;
      }

      // ── 2. Tools List ──
      if (parsed.method === 'tools/list') {
        sendJsonRpcResult(parsed.id, { tools: BUILTIN_TOOLS });
        return;
      }

      // ── 3. Tool Execution via API Key ──
      if (parsed.method === 'tools/call') {
        const toolName = parsed.params?.name;
        const toolArgs = parsed.params?.arguments || {};
        const apiKey = getEffectiveApiKey();

        if (!apiKey) {
          sendJsonRpcError(parsed.id, -32001, 'Fish Audio API Key 未配置。请运行 `fish-audio-mcp apikey <sk-fish-...>` 设置。');
          return;
        }

        try {
          let result;
          switch (toolName) {
            case 'text_to_speech': {
              const res = await textToSpeech(toolArgs.text, {
                voice: toolArgs.voice || toolArgs.reference_id,
                model: toolArgs.model,
                speed: toolArgs.speed,
                volume: toolArgs.volume,
                format: toolArgs.format,
                outputPath: toolArgs.output_path,
                apiKey,
              });
              result = {
                content: [
                  {
                    type: 'text',
                    text: `[Fish Audio TTS] 语音已生成: "${toolArgs.text}" (${res.fileSize} 字节, 音色: ${res.voice}, 模型: ${res.model}) -> ${res.filePath}`,
                  },
                ],
                ...res,
              };
              break;
            }
            case 'speech_to_text': {
              const txt = await speechToText(toolArgs.audio, {
                language: toolArgs.language,
                apiKey,
              });
              result = {
                content: [{ type: 'text', text: txt }],
                text: txt,
              };
              break;
            }
            case 'list_models': {
              const models = listOfficialModels(toolArgs.type);
              const current = getActiveModel();
              const lines = models.map((m, idx) => {
                const mark = m.id === current ? ' ⭐ [当前正在使用]' : '';
                return `${idx + 1}. [${m.id}] ${m.name}${mark}\n   类型: ${m.type} | 资费: ${m.pricing}\n   说明: ${m.description}`;
              });
              result = {
                content: [{ type: 'text', text: lines.join('\n\n') }],
                currentModel: current,
                models,
              };
              break;
            }
            case 'set_model': {
              const updated = setActiveModel(toolArgs.model);
              const msg = `🎉 底层引擎模型已切换为: ${updated.id} (${updated.name || updated.id})！资费: ${updated.pricing || '自定义'}`;
              result = {
                content: [{ type: 'text', text: msg }],
                model: updated.id,
              };
              break;
            }
            case 'search_voices': {
              const res = await searchVoices(toolArgs.query || '', {
                page_size: toolArgs.page_size,
              });
              result = res;
              break;
            }
            case 'get_voice': {
              const info = await getVoice(toolArgs.voice_id);
              result = {
                content: [
                  {
                    type: 'text',
                    text: `音色详情:\n- 名称: ${info.title}\n- ID: ${info._id}\n- 语言: ${info.languages?.join(', ') || '多语言'}\n- 标签: ${info.tags?.join(', ') || '无'}\n- 简介: ${info.description || '无'}`,
                  },
                ],
                info,
              };
              break;
            }
            case 'set_voice': {
              const info = await setActiveVoice(toolArgs.voice_id);
              const msg = `🎉 角色音色已成功切换为: [${info._id}] ${info.title} (${info.languages?.join(', ') || '多语言'})！`;
              result = {
                content: [{ type: 'text', text: msg }],
                voice_id: info._id,
                title: info.title,
              };
              break;
            }
            case 'get_credit_balance': {
              const bal = await getCreditBalance(apiKey);
              result = bal;
              break;
            }
            default: {
              sendJsonRpcError(parsed.id, -32601, `Unknown tool: ${toolName}`);
              return;
            }
          }
          sendJsonRpcResult(parsed.id, result);
        } catch (err) {
          process.stderr.write(`[fish-audio-mcp] Tool ${toolName} error: ${err.message}\n`);
          sendJsonRpcError(parsed.id, -32603, err.message);
        }
        return;
      }

      // Unknown method
      if (!isNotification) {
        sendJsonRpcError(parsed.id, -32601, `Method not found: ${parsed.method}`);
      }
    } finally {
      pendingCount--;
      maybeExit();
    }
  });

  rl.on('close', () => {
    isClosed = true;
    maybeExit();
  });
}

function sendJsonRpcResult(id, result) {
  const payload = {
    jsonrpc: '2.0',
    id,
    result,
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function sendJsonRpcError(id, code, message) {
  const payload = {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

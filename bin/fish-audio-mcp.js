#!/usr/bin/env node

import {
  saveUserConfig,
  loadUserConfig,
  getEffectiveApiKey,
  getProxyUrl,
} from '../src/config.js';
import { startMcpBridge } from '../src/mcp-bridge.js';
import {
  getCreditBalance,
  textToSpeech,
  speechToText,
  searchVoices,
  getVoice,
  getActiveVoice,
  setActiveVoice,
  listOfficialModels,
  getActiveModel,
  setActiveModel,
} from '../src/api.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'apikey': {
      const keyVal = args[1];
      if (keyVal) {
        saveUserConfig({ api_key: keyVal.trim() });
        console.log('✅ Fish Audio API Key 已成功保存至 ~/.fish-audio/config.json');
      } else {
        const key = getEffectiveApiKey();
        if (key) {
          const masked = key.slice(0, 10) + '...' + key.slice(-4);
          console.log(`🔑 当前有效 API Key: ${masked}`);
        } else {
          console.log('⚠️ 当前未配置 API Key。可通过 `fish-audio-mcp apikey <sk-fish-...>` 设置。');
        }
      }
      break;
    }

    case 'status': {
      const apiKey = getEffectiveApiKey();
      const proxy = getProxyUrl();
      const currentModel = getActiveModel();
      const currentVoiceId = getActiveVoice();

      console.log('====================================');
      console.log('🐟 Fish Audio MCP 运行状态');
      console.log('====================================');
      console.log(`🌐 网络代理: ${proxy || '(直连)'}`);

      if (apiKey) {
        const masked = apiKey.slice(0, 10) + '...' + apiKey.slice(-4);
        console.log(`🔑 API Key: ✅ 已配置 (${masked})`);
      } else {
        console.log('🔑 API Key: ⚠️ 未配置。请运行 `fish-audio-mcp apikey <key>` 设置。');
        process.exit(0);
      }

      console.log(`\n🧠 当前底层引擎模型 (Engine Model):`);
      const matchedModel = listOfficialModels().find((m) => m.id === currentModel);
      if (matchedModel) {
        console.log(`- 模型标识: ${matchedModel.id} (${matchedModel.name})`);
        console.log(`- 计费方式: ${matchedModel.pricing}`);
        console.log(`- 模型说明: ${matchedModel.description}`);
      } else {
        console.log(`- 模型标识: ${currentModel}`);
      }

      console.log(`\n🎙️ 当前角色音色 (Voice / Reference ID):`);
      try {
        const voiceInfo = await getVoice(currentVoiceId);
        console.log(`- 音色名称: ${voiceInfo.title}`);
        console.log(`- 音色 ID : ${voiceInfo._id}`);
        console.log(`- 支持语言: ${voiceInfo.languages?.join(', ') || '多语言'}`);
        if (voiceInfo.author?.nickname) {
          console.log(`- 创作者  : ${voiceInfo.author.nickname}`);
        }
        if (voiceInfo.tags?.length) {
          console.log(`- 标签    : ${voiceInfo.tags.slice(0, 6).join(', ')}`);
        }
      } catch {
        console.log(`- 音色 ID : ${currentVoiceId}`);
      }

      try {
        console.log('\n📊 账户详情与额度:');
        const balance = await getCreditBalance();
        if (balance?.content) {
          console.log(balance.content.map((c) => c.text).join('\n'));
        }
      } catch (err) {
        console.log(`- 获取余额失败: ${err.message}`);
      }
      break;
    }

    // ──────────────────────────────────────────────
    // 1. 底层引擎模型管理 (Engine Model: s2.1-pro-free, s2.1-pro, transcribe...)
    // ──────────────────────────────────────────────
    case 'model': {
      const sub = args[1];

      if (sub === 'list' || sub === 'ls') {
        printModelsList();
        break;
      }

      if (sub === 'set') {
        const targetModel = args[2];
        if (!targetModel) {
          console.error('用法: fish-audio-mcp model set <模型名称> (如 s2.1-pro-free 或 s2.1-pro)');
          process.exit(1);
        }
        try {
          const updated = setActiveModel(targetModel);
          console.log(`🎉 默认底层模型切换成功！`);
          console.log(`- 当前引擎模型: ${updated.id} (${updated.name || updated.id})`);
          if (updated.pricing) console.log(`- 计费方式: ${updated.pricing}`);
          if (updated.description) console.log(`- 模型说明: ${updated.description}`);
          console.log(`- 已持久化至 ~/.fish-audio/config.json，全局自动生效！`);
        } catch (err) {
          console.error(`❌ 模型切换失败: ${err.message}`);
          process.exit(1);
        }
        break;
      }

      // 默认查看当前底层引擎模型
      const active = getActiveModel();
      const info = listOfficialModels().find((m) => m.id === active);
      console.log('====================================');
      console.log('🧠 当前底层引擎模型 (Engine Model)');
      console.log('====================================');
      if (info) {
        console.log(`- 模型标识: ${info.id} (${info.name})`);
        console.log(`- 计费特性: ${info.pricing}`);
        console.log(`- 模型类型: ${info.type === 'tts' ? '语音合成 (TTS)' : '语音识别 (ASR)'}`);
        console.log(`- 模型说明: ${info.description}`);
      } else {
        console.log(`- 模型标识: ${active}`);
      }
      console.log('\n💡 提示:');
      console.log('  查看所有官方模型: fish-audio-mcp model list');
      console.log('  切换底层引擎模型: fish-audio-mcp model set s2.1-pro-free');
      break;
    }

    case 'models': {
      printModelsList();
      break;
    }

    // ──────────────────────────────────────────────
    // 2. 角色音色管理 (Voice / Reference ID: 雌小鬼, 纳西妲, 派蒙...)
    // ──────────────────────────────────────────────
    case 'voice': {
      const sub = args[1];

      if (sub === 'list' || sub === 'ls' || sub === 'search') {
        const query = args[2] || '';
        await handleListVoices(query);
        break;
      }

      if (sub === 'set') {
        const targetVoiceId = args[2];
        if (!targetVoiceId) {
          console.error('用法: fish-audio-mcp voice set <32位音色ID>');
          process.exit(1);
        }
        console.log(`⏳ 正在验证并切换角色音色 ID: ${targetVoiceId}...`);
        try {
          const info = await setActiveVoice(targetVoiceId);
          console.log(`🎉 角色音色切换成功！`);
          console.log(`- 音色名称: ${info.title}`);
          console.log(`- 音色 ID : ${info._id}`);
          console.log(`- 支持语言: ${info.languages?.join(', ') || '多语言'}`);
          if (info.tags?.length) {
            console.log(`- 音色标签: ${info.tags.slice(0, 6).join(', ')}`);
          }
          console.log(`- 已持久化至 ~/.fish-audio/config.json，QQBot 和 CLI 将立即使用此音色！`);
        } catch (err) {
          console.error(`❌ 音色切换失败: ${err.message}`);
          process.exit(1);
        }
        break;
      }

      // 默认查看当前角色音色
      const activeVoiceId = getActiveVoice();
      console.log(`🔍 正在查询当前角色音色详情: ${activeVoiceId}...`);
      try {
        const info = await getVoice(activeVoiceId);
        console.log('====================================');
        console.log(`🎙️ 当前角色音色: ${info.title}`);
        console.log('====================================');
        console.log(`- 音色 ID (Reference ID): ${info._id}`);
        console.log(`- 语言: ${info.languages?.join(', ') || '多语言'}`);
        if (info.author?.nickname) {
          console.log(`- 创作者: ${info.author.nickname}`);
        }
        if (info.tags?.length) {
          console.log(`- 标签: ${info.tags.join(', ')}`);
        }
        if (info.description) {
          console.log(`- 简介: ${info.description}`);
        }
        if (info.samples?.[0]?.text) {
          console.log(`- 预览台词: "${info.samples[0].text.slice(0, 60)}..."`);
        }
        console.log('\n💡 提示:');
        console.log('  搜索角色音色: fish-audio-mcp voice list <关键词>');
        console.log('  切换角色音色: fish-audio-mcp voice set <32位音色ID>');
      } catch (err) {
        console.log(`- 当前角色音色 ID: ${activeVoiceId} (${err.message})`);
      }
      break;
    }

    case 'voices': {
      const query = args[1] || '';
      await handleListVoices(query);
      break;
    }

    // ──────────────────────────────────────────────
    // 3. 语音合成 (TTS)
    // ──────────────────────────────────────────────
    case 'tts': {
      const text = args[1];
      if (!text) {
        console.error('用法: fish-audio-mcp tts <要合成的文本> [-o output.mp3] [--voice <id>] [--model <model>] [--format <mp3|wav|opus>] [--speed <0.5-2.0>] [--vol <dB>]');
        process.exit(1);
      }

      let outputPath = 'output.mp3';
      let voice = undefined;
      let model = undefined;
      let format = 'mp3';
      let speed = undefined;
      let volume = undefined;

      for (let i = 2; i < args.length; i++) {
        if (args[i] === '-o' && args[i + 1]) {
          outputPath = args[++i];
        } else if (args[i] === '--voice' && args[i + 1]) {
          voice = args[++i];
        } else if (args[i] === '--model' && args[i + 1]) {
          model = args[++i];
        } else if (args[i] === '--format' && args[i + 1]) {
          format = args[++i];
        } else if (args[i] === '--speed' && args[i + 1]) {
          speed = parseFloat(args[++i]);
        } else if (args[i] === '--vol' && args[i + 1]) {
          volume = parseFloat(args[++i]);
        }
      }

      console.log(`🎙️ 正在合成: "${text}"...`);
      try {
        const res = await textToSpeech(text, {
          outputPath,
          voice,
          model,
          format,
          speed,
          volume,
        });
        console.log('✅ 合成成功！');
        console.log(`- 底层模型: ${res.model}`);
        console.log(`- 角色音色: ${res.voice}`);
        console.log(`- 本地音频文件: ${res.localPath} (${res.fileSize} 字节)`);
      } catch (err) {
        console.error('❌ 合成失败:', err.message);
        process.exit(1);
      }
      break;
    }

    // ──────────────────────────────────────────────
    // 4. 语音识别 (STT)
    // ──────────────────────────────────────────────
    case 'stt': {
      const input = args[1];
      if (!input) {
        console.error('用法: fish-audio-mcp stt <音频URL或本地文件路径> [--lang <zh|en|ja>]');
        process.exit(1);
      }

      let language = undefined;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--lang' && args[i + 1]) {
          language = args[++i];
        }
      }

      console.log(`🎧 正在识别音频: ${input}...`);
      try {
        const text = await speechToText(input, { language });
        console.log('✅ 识别结果:\n', text);
      } catch (err) {
        console.error('❌ 语音识别失败:', err.message);
        process.exit(1);
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      printHelp();
      break;
    }

    case 'serve':
    default: {
      if (command && command.startsWith('-')) {
        printHelp();
        process.exit(1);
      }
      await startMcpBridge();
      break;
    }
  }
}

function printModelsList() {
  const models = listOfficialModels();
  const current = getActiveModel();
  console.log('====================================');
  console.log('🧠 Fish Audio 官方底层引擎模型清单');
  console.log('====================================');
  console.log('【底层模型决定 AI 推理网络架构、多语言能力与计费规则，通过 Header: model 传递】\n');
  models.forEach((m, idx) => {
    const isCurrent = m.id === current ? ' ⭐ [当前正在使用]' : '';
    console.log(`${idx + 1}. ${m.id} (${m.name})${isCurrent}`);
    console.log(`   类型: ${m.type === 'tts' ? '语音合成 (TTS)' : '语音识别 (ASR)'} | 资费: ${m.pricing}`);
    console.log(`   说明: ${m.description}\n`);
  });
  console.log('💡 切换命令: fish-audio-mcp model set <模型ID> (例如: fish-audio-mcp model set s2.1-pro-free)');
}

async function handleListVoices(query) {
  console.log(`🔍 正在从 Fish Audio 角色音色库检索 ${query ? `"${query}"` : '(推荐热门)'}...`);
  try {
    const res = await searchVoices(query, { page_size: 15 });
    if (res?.content) {
      console.log('\n' + res.content.map((c) => c.text).join('\n'));
      console.log('\n💡 切换音色命令: fish-audio-mcp voice set <上面的32位音色ID>');
    }
  } catch (err) {
    console.error('❌ 音色检索失败:', err.message);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Fish Audio MCP CLI & Server
----------------------------
用法:
  fish-audio-mcp [command]

【1. 底层引擎模型管理 (Engine Model)】
  model                  查看当前正在使用的底层引擎模型与资费
  model list             列出官方引擎模型清单 (s2.1-pro-free, s2.1-pro, transcribe-1-pro 等)
  model set <模型ID>     切换全局底层引擎模型 (例如切换到免费模型 s2.1-pro-free)

【2. 角色音色管理 (Voice / Reference ID)】
  voice                  查看当前使用的角色音色 (声线/Persona) 详情
  voice list [关键词]    搜索/拉取官方音色库列表 (简写: voices <关键词>)
  voice set <音色ID>     切换全局默认角色音色 (32位 ID，QQBot 与 CLI 立即生效)

【3. 语音合成与识别】
  tts <文本> [选项]      通过官方 API 快速合成语音并下载为本地 MP3 文件
                         选项: --voice <id> | --model <id> | -o <path> | --speed <0.5-2.0> | --vol <dB>
  stt <音频文件或URL>    将语音文件转写为文本 (Speech-to-Text)

【4. 系统与 MCP 服务】
  serve (默认)           启动 MCP Stdio 协议服务 (供 Antigravity、Claude Code、Cursor 等调用)
  apikey [sk-fish-...]   查看或设置 Fish Audio API Key
  status                 查看当前运行环境、代理、活跃引擎模型、角色音色与账户额度
  help                   显示本帮助信息
`);
}

main().catch((err) => {
  console.error('[fish-audio-mcp] Fatal error:', err);
  process.exit(1);
});

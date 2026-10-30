# dsh-fish-audio

> **Fish Audio S2.1 专属 DeepSeek Harness (DSH) 插件、Model Context Protocol (MCP) 服务端与 CLI 命令行工具。**  
> 原生支持 **S2.1-Pro 官方无限免费版**、海量角色音色库关键词检索与持久化动态切换、**歌唱合成 (`[singing]`)** 与 **自然语言音调/情感修饰**。

[![npm version](https://img.shields.io/npm/v/dsh-fish-audio.svg?style=flat-square)](https://www.npmjs.com/package/dsh-fish-audio)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/yuuuuukiu/dsh-fish-audio.svg?style=flat-square)](https://github.com/yuuuuukiu/dsh-fish-audio)

---

## ✨ 核心特性

- 🆓 **官方无限制免费通道**：默认采用 `s2.1-pro-free` 底层模型，音质与商业旗舰版 S2.1-Pro 一致，不扣字数额度，畅享高速生成。
- 🎶 **自由唱歌与旋律**：文本前嵌入 `[singing]` 标签，配合音符 `♪`、波浪线 `~` 与延音长横 `——`，即可引导音频模型唱出旋律节奏。
- 🎚️ **自然语言音调调控**：无需复杂的 SSML，直接在文本中嵌入自然语言指令：
  - `[pitch up]` / `[high pitch]`：高音萌系声线
  - `[pitch down]` / `[low pitch]`：低沉御姐/低音炮
  - `[whispering]`：耳语气声悄悄话
  - `[shouting]` / `[screaming]`：大喊炸毛尖叫
- 🎙️ **海量角色音色库**：支持关键词全文搜索（如纳西妲、初音未来、雌小鬼、派蒙、歌姬等），获取 32 位 ID 一键切换全局音色。
- 🔄 **底层引擎模型管理**：可自由查询并切换 `s2.1-pro-free`、`s2.1-pro`、`s2-pro` 或语音识别模型。
- 🎧 **语音识别转写 (ASR)**：内置 `fish_audio_stt`，支持本地文件与网络音频的高精度文字识别。
- 🌐 **原生网络代理支持**：纯 Node.js 实现 HTTP CONNECT 隧道代理转发，免安装任何第三方重量级网络库，稳定适配 `http://127.0.0.1:7892` 等本地代理环境。
- 🔌 **三合一无缝架构**：
  1. **DeepSeek Harness (Cordis)** 插件：自带图形化 Schema 配置界面，自动向 Agent 注册工具集。
  2. **Model Context Protocol (MCP)** 服务：无缝接入 Claude Desktop、Antigravity、Cursor、Cline。
  3. **CLI 命令行**：随时可在终端通过 `fish-audio-mcp` 调试与批量生成。

---

## 🚀 快速开始

### 1. 安装

```bash
# 全局安装 (用于 CLI 与 MCP 服务)
npm install -g dsh-fish-audio

# 或在 DeepSeek Harness 工作区中安装
pnpm add dsh-fish-audio
```

### 2. 配置 API Key

通过 CLI 命令保存密钥（保存在 `~/.fish-audio/config.json`，权限为 0600）：

```bash
fish-audio-mcp apikey sk-fish-xxxxxxxxxxxxxxxxxxxx
```

或者通过环境变量指定：

```bash
export FISH_AUDIO_API_KEY="sk-fish-xxxxxxxxxxxxxxxxxxxx"
```

---

## 🛠️ 使用方式

### 方式一：作为 DeepSeek Harness (Cordis) 插件

在 `cordis.patch.yml` 中配置，或在 DeepSeek Harness 桌面端设置页直接图形化配置：

```yaml
- insert:
    - id: dsh-fish-audio
      name: dsh-fish-audio
      config:
        apiKey: '' # 留空则自动读取 ~/.fish-audio/config.json 或环境变量
        defaultModelId: 568fe6a62f294908936212ce81e201e2 # 默认角色音色 ID
        modelTier: s2.1-pro-free # 默认底层模型 (推荐免费版)
        outputDir: voice # 生成音频保存目录 (相对工作区)
        proxyUrl: '' # 代理地址，例如 http://127.0.0.1:7892 (可选)
```

#### 注册给 AI Agent 的工具列表：
- `fish_audio_tts`：语音/唱歌合成（支持歌唱与音调标签，返回落盘文件路径，配合 `qqbot_send_file` 即可直接以语音条发出）
- `fish_audio_voices`：音色库检索（按角色、风格搜索）
- `fish_audio_set_voice`：切换当前生效的角色音色
- `fish_audio_models`：查看底层模型列表与资费特性
- `fish_audio_set_model`：切换底层模型
- `fish_audio_stt`：语音识别文字转写
- `fish_audio_balance`：查询账户余额与调用配额

---

### 方式二：作为 Model Context Protocol (MCP) 服务

兼容 **Claude Desktop**, **Antigravity**, **Cursor**, **Cline**。

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "fish-audio": {
      "command": "npx",
      "args": ["-y", "dsh-fish-audio", "serve"],
      "env": {
        "FISH_AUDIO_API_KEY": "sk-fish-xxxxxxxxxxxxxxxxxxxx",
        "HTTPS_PROXY": "http://127.0.0.1:7892"
      }
    }
  }
}
```

---

### 方式三：CLI 命令行工具

```bash
# 1. 基础语音合成
fish-audio-mcp tts "你好，这是测试语音！" -o test.mp3

# 2. 唱歌合成
fish-audio-mcp tts "[singing] 祝你生日快乐~ 祝你生日快乐~ ♪" -o sing.mp3

# 3. 升调与耳语气声
fish-audio-mcp tts "[pitch up] 哇！大叔你看本小姐的高音厉不厉害~♡ [whispering] 悄悄告诉你哦..." -o pitch.mp3

# 4. 检索并切换音色
fish-audio-mcp voice list "初音未来"
fish-audio-mcp voice set 14d9940607fc477b8115a40b60a29b0b

# 5. 查看并切换底层模型
fish-audio-mcp model list
fish-audio-mcp model set s2.1-pro-free

# 6. 音频识别 (STT)
fish-audio-mcp stt ./voice.mp3 --lang zh

# 7. 查看当前运行状态与余额
fish-audio-mcp status
```

---

### 方式四：Node.js SDK 调用

```javascript
import { textToSpeech, searchVoices, setActiveVoice } from 'dsh-fish-audio';

// 搜索音色
const voices = await searchVoices('派蒙');

// 合成语音
const res = await textToSpeech('[singing] 朋友的情谊呀~ 比天还高—— 比地还辽阔♪', {
  voice: '568fe6a62f294908936212ce81e201e2',
  model: 's2.1-pro-free',
  outputPath: './friends_wine.mp3',
});

console.log(`生成成功: ${res.localPath} (${res.fileSize} 字节)`);
```

---

## 🎵 唱歌与音调控制秘籍

Fish Audio S2.1 原生理解方括号 `[tag]` 标签：

| 标签 | 作用 | 示例 |
| :--- | :--- | :--- |
| `[singing]` | 歌唱旋律模式 | `[singing] 朋友的情谊呀~ 比天还高—— 比地还辽阔♪` |
| `[pitch up]` / `[high pitch]` | 提升音调（萌系/高音） | `[pitch up] 哇！你看我这个调子起得高不高~` |
| `[pitch down]` / `[low pitch]`| 降低音调（低沉/低音炮） | `[pitch down] 肃静。这才是深海主宰的声音。` |
| `[whispering]` | 耳语/轻声细语 | `[whispering] 悄悄告诉你一个小秘密哦...` |
| `[shouting]` | 大喊/情绪高昂 | `[shouting] 呜哇！不准拔本小姐的网线！` |

> **唱歌技巧**：歌词中适当多用 `♪`（节拍音符）、`~`（颤音与尾音延展）以及 `——`（长音拖拍），神经网络在感知到这些字符时会自动拉长发音并产生抑扬顿挫的旋律波形。

---

## 📄 开源许可证

[MIT License](./LICENSE) © [Yuki-U](https://github.com/yuuuuukiu)

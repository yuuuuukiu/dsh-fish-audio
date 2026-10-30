# dsh-fish-audio

> **Fish Audio S2.1 plugin for DeepSeek Harness (DSH), Model Context Protocol (MCP) Server, and CLI tool.**  
> Native support for **Free Unlimited S2.1-Pro**, character voice library search & dynamic switching, **singing generation (`[singing]`)**, and **natural language pitch/emotion modulation**.

[![npm version](https://img.shields.io/npm/v/dsh-fish-audio.svg?style=flat-square)](https://www.npmjs.com/package/dsh-fish-audio)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/yuuuuukiu/dsh-fish-audio.svg?style=flat-square)](https://github.com/yuuuuukiu/dsh-fish-audio)

[中文说明文档 (README_CN.md)](./README_CN.md)

---

## ✨ Features

- 🆓 **Official Unlimited Free Tier**: Defaults to `s2.1-pro-free`, providing high-quality S2.1 neural TTS without token deductions.
- 🎶 **Singing & Melody**: Instruct the model to sing using inline `[singing]` tags and melody markers (`♪`, `~`, `——`).
- 🎚️ **Pitch & Emotion Modulation**: Supports open-ended natural language prosody tags:
  - `[pitch up]` / `[high pitch]`: Raise vocal pitch (cute / anime voice).
  - `[pitch down]` / `[low pitch]`: Lower vocal pitch (deep / authoritative voice).
  - `[whispering]`: Intimate breathy whisper.
  - `[shouting]` / `[screaming]`: Emotional exclamation.
- 🎙️ **Rich Voice Library**: Search thousands of community and official character voices (e.g. anime characters, singers) by keyword and switch dynamically with persistent memory.
- 🔄 **Model & Engine Management**: Query and switch between `s2.1-pro-free`, `s2.1-pro`, `s2-pro`, and ASR models.
- 🎧 **Speech-to-Text (ASR)**: High-accuracy audio transcription via `transcribe-1` / `transcribe-1-pro`.
- 🌐 **Built-in Proxy Support**: Supports HTTP/HTTPS forward proxies (`http://127.0.0.1:7892` etc.) using native Node.js HTTP CONNECT tunneling with zero external dependencies.
- 🔌 **3-in-1 Architecture**:
  1. **DeepSeek Harness (Cordis)** Native Plugin with GUI Schema settings.
  2. **Model Context Protocol (MCP)** Stdio Server for Claude Desktop, Antigravity, Cursor, and Cline.
  3. **CLI Command-line Tool** (`fish-audio-mcp` / `dsh-fish-audio`).

---

## 🚀 Quick Start

### 1. Installation

```bash
# Global install for CLI & MCP
npm install -g dsh-fish-audio

# Or inside DeepSeek Harness profile
pnpm add dsh-fish-audio
```

### 2. Configure API Key

Set your Fish Audio API key (`sk-fish-...`) via CLI or environment variable:

```bash
# Via CLI (saved to ~/.fish-audio/config.json with 0600 permissions)
fish-audio-mcp apikey sk-fish-xxxxxxxxxxxxxxxxxxxx

# Or via environment variable
export FISH_AUDIO_API_KEY="sk-fish-xxxxxxxxxxxxxxxxxxxx"
```

---

## 🛠️ Usage

### Mode A: DeepSeek Harness (Cordis Plugin)

Add `dsh-fish-audio` to your `cordis.patch.yml` or configure it via the DeepSeek Harness desktop GUI:

```yaml
- insert:
    - id: dsh-fish-audio
      name: dsh-fish-audio
      config:
        apiKey: '' # Leave blank to use ~/.fish-audio/config.json or env
        defaultModelId: 568fe6a62f294908936212ce81e201e2 # Default character voice ID
        modelTier: s2.1-pro-free # Default engine model
        outputDir: voice # Relative or absolute audio output directory
        proxyUrl: '' # e.g. http://127.0.0.1:7892 (optional)
```

#### Available Agent Tools Registered:
- `fish_audio_tts`: Synthesize speech or singing into an audio file.
- `fish_audio_voices`: Search character voice library by keyword.
- `fish_audio_set_voice`: Switch active character voice ID.
- `fish_audio_models`: List available official engine models and pricing.
- `fish_audio_set_model`: Switch active engine model.
- `fish_audio_stt`: Transcribe audio file or URL to text.
- `fish_audio_balance`: Query Fish Audio account credits and limits.

---

### Mode B: Model Context Protocol (MCP) Server

Works with **Claude Desktop**, **Antigravity**, **Cursor**, and **Cline**.

Add to your `claude_desktop_config.json`:

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

### Mode C: Command Line Interface (CLI)

```bash
# 1. Synthesize Speech
fish-audio-mcp tts "Hello world, this is a test!" -o test.mp3

# 2. Singing Generation
fish-audio-mcp tts "[singing] Happy birthday to you~ Happy birthday to you~ ♪" -o sing.mp3

# 3. Pitch & Prosody Modulation
fish-audio-mcp tts "[pitch up] Look at how high my voice can reach! [whispering] Secret..." -o pitch.mp3

# 4. Search and Switch Voices
fish-audio-mcp voice list "初音未来"
fish-audio-mcp voice set 14d9940607fc477b8115a40b60a29b0b

# 5. List and Switch Underlying Engine Models
fish-audio-mcp model list
fish-audio-mcp model set s2.1-pro-free

# 6. Audio Transcription (STT)
fish-audio-mcp stt ./audio.mp3 --lang zh

# 7. Check Status & Account Balance
fish-audio-mcp status
```

---

### Mode D: Node.js Programmatic SDK

```javascript
import { textToSpeech, searchVoices, setActiveVoice } from 'dsh-fish-audio';

// Search voices
const results = await searchVoices('萝莉');

// Generate TTS
const audio = await textToSpeech('[singing] 祝你生日快乐~ ♪', {
  voice: '568fe6a62f294908936212ce81e201e2',
  model: 's2.1-pro-free',
  outputPath: './output.mp3',
});

console.log(`Audio saved to: ${audio.localPath} (${audio.fileSize} bytes)`);
```

---

## 🎵 Singing & Pitch Modulation Guide

Fish Audio S2.1 natively follows descriptive instructions embedded in square brackets `[tag]`:

| Tag | Purpose | Example |
| :--- | :--- | :--- |
| `[singing]` | Melodic vocal delivery | `[singing] 朋友的情谊呀~ 比天还高—— 比地还辽阔♪` |
| `[pitch up]` / `[high pitch]` | Raise vocal register | `[pitch up] 哇！大叔你看本小姐的高音厉不厉害~♡` |
| `[pitch down]` / `[low pitch]`| Lower vocal register | `[pitch down] 肃静。这才是深海主宰的声音。` |
| `[whispering]` | Breathy / secret voice | `[whispering] 悄悄告诉你一个小秘密哦...` |
| `[shouting]` | Screaming / high energy | `[shouting] 呜哇！不准拔本小姐的网线！` |

> **Tip for Singing**: Combine `[singing]` with musical symbols like `♪` (melody markers), `~` (vocal vibrato/extension), and `——` (sustained notes) to give the neural network clear rhythmic cadence.

---

## 📄 License

[MIT](./LICENSE) © [Yuki-U](https://github.com/yuuuuukiu)

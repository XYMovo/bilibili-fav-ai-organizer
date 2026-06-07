# BiliFav AI Organizer

[中文文档](docs/GUIDE.zh-CN.md) | [English](#)

> 用 AI 自动整理 B 站收藏夹的浏览器用户脚本 | Tampermonkey userscript for auto-organizing Bilibili favorites with AI
>
> **原作者：[某不知名的根号三](https://www.kamiwzw.site/posts/bilibili-favorites-ai-organizer-userscript/)**（V8.1）· 本版由 [XYM](https://github.com/XYMovo) 适配改进

---

## What it does

一键将混乱的 B 站收藏夹按内容智能分类：
- 自动读取收藏夹中所有视频
- 调用 DeepSeek AI 进行语义理解与分类
- 优先匹配已有的收藏夹名称
- 自动创建新收藏夹并移动视频

<p align="center">
  <img src="https://img.shields.io/badge/platform-Tampermonkey-orange" alt="Tampermonkey">
  <img src="https://img.shields.io/badge/AI-DeepSeek%20V4%20Flash-blue" alt="DeepSeek">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

---

## Quick Start

### 1. Install Tampermonkey
- [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) | [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) | [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)

### 2. Get DeepSeek API Key
1. Register at [platform.deepseek.com](https://platform.deepseek.com/)
2. Create an API Key (starts with `sk-`)

### 3. Install Script
1. Tampermonkey → Dashboard → Create New Script
2. Copy the entire content of [`bilibili-fav-organizer.user.js`](bilibili-fav-organizer.user.js)
3. Replace `apiKey` on line 22 with your own key, or fill it in the popup UI
4. Save (Ctrl+S)

### 4. Use
1. Open any Bilibili favorites folder page (URL contains `?fid=xxx`)
2. Click the `🤖 AI整理` floating button at bottom-left
3. Click `👁 仅预览` to preview AI results first
4. Click `🚀 开始整理` to execute the organization

---

## Features

| Feature | Description |
|---------|-------------|
| 🔍 Smart Classification | Semantic understanding of video content, not just keyword matching |
| 📁 Priority Matching | Reuses existing folder names to avoid creating duplicates |
| 👁 Preview Mode | Review AI's classification before executing moves |
| 📦 Batch Processing | 20 videos per batch for stability, handles 200+ videos |
| 🔐 Private Folders | New folders are created as private by default |
| 🎨 Clean UI | Popup panel with progress logging and category preview |
| 🔗 Multi-API | Compatible with any OpenAI-format API (DeepSeek, OpenAI, etc.) |

---

## How It Works

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌────────────┐
│  Fetch all   │ -> │  AI classify │ -> │  Create/move │ -> │   Done!    │
│  favorites   │    │  in batches  │    │   favorites  │    │            │
└─────────────┘    └─────────────┘    └──────────────┘    └────────────┘
```

### API Endpoints Used
- `x/v3/fav/folder/created/list-all` — Get existing folders
- `x/v3/fav/resource/list` — Fetch videos (paginated)
- `x/v3/fav/folder/add` — Create new folder
- `x/v3/fav/resource/move` — Move videos between folders

---

## Configuration

Edit the `CONFIG` object in the script:

```javascript
const CONFIG = {
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: 'sk-your-key-here',
    model: 'deepseek-v4-flash',
    temperature: 0.1,
};
```

**Supported models via compatible APIs:**
- DeepSeek: `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-chat`
- OpenAI: `gpt-4o`, `gpt-4o-mini`
- Any OpenAI-compatible API provider

---

## Safety

- **Read-only by default** — use Preview mode first
- **No deletion** — script never deletes videos or folders
- **CSRF protection** — all API calls require CSRF token from cookies
- **Domain lock** — only runs on `space.bilibili.com`

---

## Changelog

See [commits](https://github.com/XYMovo/bilibili-fav-ai-organizer/commits/main) for full history.

### v9.0 (2026-06-07)
- Adapt to DeepSeek V4 Flash
- Add batch processing (20 videos per batch)
- Add preview-only mode
- In-panel API Key input with persistence
- Improved error handling and logging
- Skip moving videos already in target folder

---

## Credits

- **原作者：[某不知名的根号三](https://www.kamiwzw.site/)** — [博客原文：用油猴脚本+AI自动整理B站收藏夹](https://www.kamiwzw.site/posts/bilibili-favorites-ai-organizer-userscript/)（V8.1，CC BY-NC-SA 4.0）
- **本版（V9.0）** 由 [XYM](https://github.com/XYMovo) 适配改进：DeepSeek V4 Flash、分批处理、预览模式、多API兼容
- AI powered by [DeepSeek](https://platform.deepseek.com/)

---

## License

MIT — see [LICENSE](LICENSE) file

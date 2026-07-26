# 词源卡导入助手

一款 Chrome 浏览器扩展，利用 DeepSeek AI 为英语单词生成丰富的词源卡片，并一键导入到 Anki 中。

## 功能特性

- **AI 驱动词源拆解**：DeepSeek 大模型自动生成单词的词源结构、语义演变、同源近亲词、常见短语和记忆技巧
- **多种取词方式**：
  - 在弹窗中直接输入单词（支持批量）
  - 网页中选中单词 → 右键菜单导入
  - 快捷键 `Ctrl+Shift+D`（Mac：`MacCtrl+Shift+D`）导入选中单词
  - 开启"复制即导入"后，复制英文单词自动触发导入
- **一键导入 Anki**：通过 [AnkiConnect](https://foosoft.net/projects/anki-connect/) 直接写入 Anki，自动创建"词源卡"笔记类型
- **真人发音音频**：优先从剑桥词典抓取美式发音，失败时自动用有道发音兜底
- **批量并发处理**：支持一次导入多个单词，可配置并发数（1–8）
- **侧边栏面板**：点击扩展图标即可打开侧边栏，随时查看导入进度和当前单词状态
- **本地剪贴板监听**（可选）：通过 Native Messaging 监听系统剪贴板，自动识别并导入复制的英文单词

## 工作流程

```
输入单词 → 查询词典发音 → DeepSeek 生成词源卡 (JSON) → AnkiConnect 写入 Anki
```

1. **输入**：通过弹窗输入、右键菜单、快捷键或剪贴板获取单词
2. **发音**：从 Cambridge Dictionary 抓取真人发音（失败则走有道 TTS 兜底）
3. **AI 生成**：DeepSeek API 返回结构化的词源 JSON，包含词源拆解、语义演变阶段、用法分析和记忆技巧
4. **导入**：通过 AnkiConnect（`localhost:8765`）创建或更新 Anki 笔记

## 安装

### 前置条件

- 安装 [Anki](https://apps.ankiweb.net/) 并添加 [AnkiConnect](https://foosoft.net/projects/anki-connect/) 插件（插件代码：`2055492159`）
- 注册 [DeepSeek](https://platform.deepseek.com/) 并获取 API Key

### 扩展安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本项目文件夹
4. 点击扩展图标 → **配置设置** → 填入 DeepSeek API Key 并选择目标牌组
5. 点击 **保存设置**

### 可选：本地剪贴板监听（macOS）

```bash
cd distribution/source/native-host
./install_native_host.sh <你的扩展ID>
```

然后在 `chrome://extensions/` 中重新加载扩展。Native Host 会监听系统剪贴板，自动将复制的英文单词发送给扩展。

## 使用方法

| 方式 | 操作 |
|------|------|
| **弹窗导入** | 点击扩展图标，输入单词（一行一个），点击"生成并导入 Anki" |
| **右键导入** | 在任意网页选中单词 → 右键 → "导入到 Anki 词源卡" |
| **快捷键** | 选中单词 → `Ctrl+Shift+D`（Mac：`MacCtrl+Shift+D`） |
| **复制导入** | 在设置中开启"在网页复制单词即自动导入"，复制英文单词即可 |
| **侧边栏** | 点击扩展图标打开侧边栏，查看状态或手动导入 |

## 配置说明

所有设置保存在 Chrome 本地存储中，通过弹窗配置：

| 设置项 | 说明 |
|--------|------|
| DeepSeek API Key | API 密钥（以 `sk-` 开头） |
| 模型 | DeepSeek 模型名称，默认 `deepseek-chat` |
| 导入牌组 | 目标 Anki 牌组，点击刷新获取最新列表 |
| 导入时同步写入音频 | 开启后自动抓取单词发音并存入 Anki 媒体库 |
| Cambridge 失败时用有道兜底 | 剑桥词典无发音时自动使用有道 TTS |
| 允许重复导入同名单词 | 开启后不检查牌组中是否已存在同名笔记 |
| 复制单词即自动导入 | 开启后，在网页中复制英文单词自动触发导入 |
| 批量并发数 | 同时处理的单词数量（1–8），默认 3 |

## 卡片字段

每张词源卡包含 8 个字段：

1. **Word** — 单词本身
2. **Part_of_Speech** — 词性（如 "verb/noun"）
3. **Pronunciation** — IPA 音标
4. **Example_Sentence** — 核心例句（含中文翻译）
5. **Etymology_Breakdown** — 词源拆解（前缀/词根/后缀及其历史来源）
6. **Semantic_Evolution** — 语义演变（3–5 个阶段，展示从具体义到抽象义的发展）
7. **Memory_Tip** — 基于词源的中文记忆技巧

## 项目结构

```
├── README.md                   # 项目说明（本文件）
├── .gitignore                  # Git 忽略规则（API 密钥 / 数据文件不上传）
├── distribution/               # Chrome 扩展根目录（在 Chrome 中加载此文件夹）
│   ├── manifest.json           # Chrome 扩展清单 (Manifest V3)
│   ├── icon-128.png            # 扩展图标
│   └── source/                 # 扩展源代码
│       ├── background.js       # Service Worker：右键菜单、快捷键、导入调度
│       ├── common.js           # 公共逻辑：AnkiConnect 桥接、DeepSeek API、音频抓取
│       ├── content.js          # 内容脚本：划词检测、复制触发自动导入
│       ├── popup.html          # 弹窗界面
│       ├── popup.js            # 弹窗交互逻辑
│       ├── popup.css           # 弹窗样式
│       ├── panel.html          # 侧边栏界面
│       └── native-host/        # 可选：本地剪贴板监听
│           ├── clipboard_host.py   # Native Messaging 宿主脚本
│           └── install_native_host.sh  # macOS 安装脚本
└── readme/                     # 文档补充资源（截图、安装说明等）
```

## 依赖服务

- [DeepSeek API](https://api.deepseek.com/) — AI 词源内容生成
- [AnkiConnect](http://127.0.0.1:8765/) — Anki 本地通信接口
- [Cambridge Dictionary](https://dictionary.cambridge.org/) — 真人发音（主）
- [有道词典](https://dict.youdao.com/) — TTS 发音（备用）

## 许可证

MIT

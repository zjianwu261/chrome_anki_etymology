# API 配置

本扩展所需的 API Key **无法通过本地文件注入**——Chrome 扩展运行在浏览器沙箱中，无法读取本地文件系统上的 `.env` 文件。

## 配置方式

所有配置通过**扩展弹窗 UI** 完成，保存到 `chrome.storage.local`：

1. 点击 Chrome 工具栏中的扩展图标
2. 展开「配置设置」
3. 填入 **DeepSeek API Key**（以 `sk-` 开头）
4. 选择目标 **Anki 牌组**
5. 点击「保存设置」

## 所需 API

| 服务 | 地址 | 用途 |
|------|------|------|
| DeepSeek | https://platform.deepseek.com/ | AI 词源内容生成 |
| AnkiConnect | http://127.0.0.1:8765/ | Anki 本地通信（免费，需安装 Anki 插件） |

## 存储键值参考（chrome.storage.local）

供开发者参考，以下为扩展使用的存储键：

```
apiKey           — DeepSeek API Key
modelName        — 模型名称，默认 "deepseek-chat"
deckName         — 目标 Anki 牌组
attachAudio      — 是否导入音频
youdaoFallback   — Cambridge 失败时用有道兜底
allowDuplicate   — 允许重复导入
autoImportOnCopy — 复制即导入
concurrency      — 批量并发数 (1-8)
wordsInput       — 批量单词输入
```

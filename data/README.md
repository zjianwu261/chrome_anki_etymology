# Data 目录

本目录用于存放 API 配置、本地密钥等敏感数据文件。

## 文件说明

- `.env.example` — 环境变量模板，可安全提交到 Git
- `.env` — 实际密钥文件，**已被 .gitignore 排除，不会同步到 GitHub**

## 使用方式

1. 复制 `.env.example` 为 `.env`
2. 在 `.env` 中填入真实的 DeepSeek API Key
3. Chrome 扩展本身通过弹窗配置保存 API Key 到 `chrome.storage.local`，此 `.env` 文件仅作本地参考

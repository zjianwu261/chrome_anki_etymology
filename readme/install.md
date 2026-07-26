# 扩展安装说明

Chrome 扩展没有单独的"安装位置"——它直接从文件夹加载运行。

## 开发模式加载

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目的 **`distribution/`** 文件夹

Chrome 将直接读取该文件夹中的 `manifest.json` 和所有源代码文件，**不需要复制或移动**。

## 已安装扩展的实际位置

从 Chrome Web Store 安装的扩展存储在 Chrome 用户数据目录中：

- **macOS**：`~/Library/Application Support/Google/Chrome/Default/Extensions/`
- **Windows**：`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions\`
- **Linux**：`~/.config/google-chrome/Default/Extensions/`

开发模式加载的扩展始终从你选择的文件夹运行，Chrome 不会复制它。

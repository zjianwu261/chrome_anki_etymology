#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法: ./install_native_host.sh <CHROME_EXTENSION_ID>"
  exit 1
fi

EXTENSION_ID="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/clipboard_host.py"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/com.maverick.anki_clipboard_host.json"

mkdir -p "$MANIFEST_DIR"
chmod +x "$HOST_SCRIPT"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "com.maverick.anki_clipboard_host",
  "description": "Clipboard watcher for 词源卡导入助手",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "已安装 Native Messaging manifest:"
echo "$MANIFEST_PATH"
echo "请回到 chrome://extensions/ 重新加载扩展。"

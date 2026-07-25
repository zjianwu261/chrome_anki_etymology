importScripts("common.js");

const MENU_ID = "import-etymology-card";
const AUTO_IMPORT_DEDUPE_MS = 4000;
let lastImportedWord = "";
let lastImportedAt = 0;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "导入到 Anki 词源卡",
      contexts: ["selection"]
    });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "import-selected-word") {
    return;
  }

  await importSelectionFromActiveTab();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) {
    return;
  }
  await importSelectedWord(info.selectionText.trim(), "右键导入");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "AUTO_IMPORT_SELECTION" && message?.type !== "AUTO_IMPORT_COPIED_WORD") {
    return;
  }

  const sourceLabel = message?.type === "AUTO_IMPORT_COPIED_WORD" ? "复制导入" : "快捷取词";
  importSelectedWord(message.selection, sourceLabel)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function importSelectedWord(rawWord, sourceLabel) {
  const word = String(rawWord || "").trim();
  if (!word) {
    return { mode: "ignored", word: "" };
  }

  if (shouldSkipRecentAutoImport(word, sourceLabel)) {
    await chrome.storage.local.set({
      lastContextStatus: `${sourceLabel}已忽略重复单词: ${word}`,
      lastContextWord: word,
      lastContextMeaning: "已忽略"
    });
    return { mode: "ignored", word };
  }

  const stored = await chrome.storage.local.get([
    "apiKey",
    "modelName",
    "deckName",
    "attachAudio",
    "allowDuplicate"
  ]);

  if (!stored.apiKey) {
    setBadge("KEY", "#8c2f15");
    await chrome.storage.local.set({ lastContextStatus: "请先保存 DeepSeek API Key。", lastContextMeaning: "" });
    await showNotification("词源卡导入助手", "请先保存 DeepSeek API Key。");
    return { mode: "missing_key", word };
  }

  if (!stored.deckName) {
    setBadge("DECK", "#8c2f15");
    await chrome.storage.local.set({ lastContextStatus: "请先选择一个 Anki 牌组。", lastContextMeaning: "" });
    await showNotification("词源卡导入助手", "请先选择一个 Anki 牌组。");
    return { mode: "missing_deck", word };
  }

  try {
    setBadge("RUN", "#bb4d2a");
    await chrome.storage.local.set({
      lastContextStatus: `${sourceLabel}处理中: ${word}`,
      lastContextWord: word,
      lastContextMeaning: "查询中..."
    });
    const result = await importWordToAnki({
      apiKey: stored.apiKey,
      modelName: stored.modelName || "deepseek-chat",
      deckName: stored.deckName,
      attachAudio: stored.attachAudio !== false,
      allowDuplicate: Boolean(stored.allowDuplicate),
      word
    });
    const action = result?.mode === "updated" ? "已更新" : "已导入";
    setBadge("OK", "#1f7a45");
    await chrome.storage.local.set({
      lastContextStatus: `${sourceLabel}${action}: ${result?.word || word}`,
      lastContextWord: result?.word || word,
      lastContextMeaning: result?.coreMeaningZh || "未返回中文义"
    });
    await showNotification("词源卡导入助手", `${sourceLabel}${action}: ${result?.word || word}`);
    return result;
  } catch (error) {
    setBadge("ERR", "#8c2f15");
    await chrome.storage.local.set({
      lastContextStatus: `${sourceLabel}失败: ${word} -> ${error.message}`,
      lastContextWord: word,
      lastContextMeaning: "获取失败"
    });
    await showNotification("词源卡导入助手", `${sourceLabel}失败: ${word}`);
    throw error;
  } finally {
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
    }, 3500);
  }
}

async function importSelectionFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    await showNotification("词源卡导入助手", "没有找到当前标签页。");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
    const selection = String(response?.selection || "").trim();
    if (!selection) {
      await showNotification("词源卡导入助手", "请先在页面中选中一个单词。");
      return;
    }

    await importSelectedWord(selection, "快捷键导入");
  } catch (_error) {
    await showNotification("词源卡导入助手", "当前页面无法读取选词，请在普通网页中重试。");
  }
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

function shouldSkipRecentAutoImport(word, sourceLabel) {
  if (sourceLabel === "右键导入") {
    return false;
  }

  const normalized = String(word || "").toLowerCase();
  const now = Date.now();
  if (normalized === lastImportedWord && now - lastImportedAt < AUTO_IMPORT_DEDUPE_MS) {
    return true;
  }

  lastImportedWord = normalized;
  lastImportedAt = now;
  return false;
}

async function showNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon-128.png"),
      title,
      message
    });
  } catch (_error) {
    // 通知失败时静默忽略，避免让 service worker 进入错误状态。
  }
}

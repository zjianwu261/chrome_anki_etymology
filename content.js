let lastAutoImportKey = "";
let lastAutoImportAt = 0;
let lastSelectedWord = "";

// 复制即导入：默认关闭，仅在设置开启时才监听复制行为。
let autoImportOnCopy = false;

chrome.storage.local.get(["autoImportOnCopy"]).then((stored) => {
  autoImportOnCopy = Boolean(stored.autoImportOnCopy);
}).catch(() => {});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.autoImportOnCopy) {
    autoImportOnCopy = Boolean(changes.autoImportOnCopy.newValue);
  }
});

// GET_SELECTION 始终可用（供右键 / 快捷键 / 弹窗显式取词）。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_SELECTION") {
    return;
  }

  const selection = getCurrentSelectionText();
  sendResponse({ selection });
});

document.addEventListener("selectionchange", () => {
  lastSelectedWord = normalizeSelection(getCurrentSelectionText());
});

document.addEventListener("keydown", (event) => {
  if (!autoImportOnCopy) {
    return;
  }

  const isCopyShortcut =
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    String(event.key || "").toLowerCase() === "c";

  if (!isCopyShortcut) {
    return;
  }

  void processCopiedWord("快捷键复制");
});

document.addEventListener("copy", (event) => {
  if (!autoImportOnCopy) {
    return;
  }
  void handleCopyEvent(event);
});

async function handleCopyEvent(event) {
  await updateCopyDebugStatus("检测到复制操作，正在检查内容...", "", "");

  const directText = getCopiedText(event);
  const directNormalized = normalizeSelection(directText) || lastSelectedWord;
  await processCandidateWord(directNormalized, "复制单词");
}

async function processCopiedWord(sourceLabel) {
  await new Promise((resolve) => setTimeout(resolve, 60));
  const normalized = normalizeSelection(getCurrentSelectionText()) || lastSelectedWord;
  await processCandidateWord(normalized, sourceLabel);
}

async function processCandidateWord(normalized, sourceLabel) {
  if (!normalized) {
    await updateCopyDebugStatus("复制内容不是独立单词，已忽略。", "", "已忽略");
    return;
  }

  if (shouldSkipDuplicate(normalized)) {
    await updateCopyDebugStatus(`重复复制已忽略: ${normalized}`, normalized, "已忽略");
    return;
  }

  try {
    await updateCopyDebugStatus(`${sourceLabel}检测到单词，准备导入: ${normalized}`, normalized, "准备导入");
    await sendAutoImportMessage("AUTO_IMPORT_COPIED_WORD", normalized);
  } catch (_error) {
    // 扩展重载或受限页面时静默跳过。
  }
}

function getCopiedText(event) {
  const clipboardText = event?.clipboardData?.getData("text/plain") || "";
  if (clipboardText.trim()) {
    return clipboardText;
  }

  const selection = window.getSelection ? String(window.getSelection()).trim() : "";
  if (selection) {
    return selection;
  }

  const active = document.activeElement;
  if (active && typeof active.value === "string") {
    const start = Number.isInteger(active.selectionStart) ? active.selectionStart : 0;
    const end = Number.isInteger(active.selectionEnd) ? active.selectionEnd : 0;
    if (end > start) {
      return active.value.slice(start, end);
    }
  }

  return "";
}

function shouldSkipDuplicate(normalized) {
  const now = Date.now();
  const dedupeKey = `${location.href}::${normalized}`;
  if (dedupeKey === lastAutoImportKey && now - lastAutoImportAt < 2500) {
    return true;
  }

  lastAutoImportKey = dedupeKey;
  lastAutoImportAt = now;
  return false;
}

function sendAutoImportMessage(type, selection) {
  return chrome.runtime.sendMessage({ type, selection });
}

function updateCopyDebugStatus(status, word, meaning) {
  return chrome.storage.local.set({
    lastContextStatus: status,
    lastContextWord: word,
    lastContextMeaning: meaning
  });
}

function getCurrentSelectionText() {
  const selection = window.getSelection ? String(window.getSelection()).trim() : "";
  if (selection) {
    return selection;
  }

  const active = document.activeElement;
  if (active && typeof active.value === "string") {
    const start = Number.isInteger(active.selectionStart) ? active.selectionStart : 0;
    const end = Number.isInteger(active.selectionEnd) ? active.selectionEnd : 0;
    if (end > start) {
      return active.value.slice(start, end);
    }
  }

  return "";
}

function normalizeSelection(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");

  if (!cleaned) {
    return "";
  }

  if (!/^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(cleaned)) {
    return "";
  }

  return cleaned;
}

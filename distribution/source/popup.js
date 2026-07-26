const settingsKeys = [
  "apiKey",
  "modelName",
  "deckName",
  "attachAudio",
  "youdaoFallback",
  "allowDuplicate",
  "autoImportOnCopy",
  "concurrency",
  "wordsInput"
];

const elements = {
  apiKey: document.getElementById("apiKey"),
  modelName: document.getElementById("modelName"),
  deckName: document.getElementById("deckName"),
  attachAudio: document.getElementById("attachAudio"),
  youdaoFallback: document.getElementById("youdaoFallback"),
  allowDuplicate: document.getElementById("allowDuplicate"),
  autoImportOnCopy: document.getElementById("autoImportOnCopy"),
  concurrency: document.getElementById("concurrency"),
  wordsInput: document.getElementById("wordsInput"),
  runButton: document.getElementById("runButton"),
  saveSettings: document.getElementById("saveSettings"),
  clearSettings: document.getElementById("clearSettings"),
  refreshDecks: document.getElementById("refreshDecks"),
  toggleKey: document.getElementById("toggleKey"),
  ankiStatus: document.getElementById("ankiStatus"),
  summary: document.getElementById("summary"),
  logOutput: document.getElementById("logOutput"),
  currentWord: document.getElementById("currentWord"),
  currentMeaning: document.getElementById("currentMeaning")
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  await loadSettings();
  attachEvents();
  await refreshAnkiStatus();
  await preloadSelection();
  await showLastContextStatus();
}

function attachEvents() {
  elements.saveSettings.addEventListener("click", saveSettings);
  elements.clearSettings.addEventListener("click", clearSecret);
  elements.refreshDecks.addEventListener("click", refreshAnkiStatus);
  elements.runButton.addEventListener("click", handleRun);
  elements.toggleKey.addEventListener("click", toggleKeyVisibility);
  chrome.storage.onChanged.addListener(handleStorageChange);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(settingsKeys);
  elements.apiKey.value = stored.apiKey || "";
  elements.modelName.value = stored.modelName || "deepseek-chat";
  elements.attachAudio.checked = stored.attachAudio !== false;
  elements.youdaoFallback.checked = stored.youdaoFallback !== false;
  elements.allowDuplicate.checked = Boolean(stored.allowDuplicate);
  elements.autoImportOnCopy.checked = Boolean(stored.autoImportOnCopy);
  elements.concurrency.value = stored.concurrency || 3;
  elements.wordsInput.value = stored.wordsInput || "";
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiKey: elements.apiKey.value.trim(),
    modelName: elements.modelName.value.trim() || "deepseek-chat",
    deckName: elements.deckName.value,
    attachAudio: elements.attachAudio.checked,
    youdaoFallback: elements.youdaoFallback.checked,
    allowDuplicate: elements.allowDuplicate.checked,
    autoImportOnCopy: elements.autoImportOnCopy.checked,
    concurrency: clampConcurrency(elements.concurrency.value),
    wordsInput: elements.wordsInput.value
  });
  setSummary("设置已保存。");
}

async function clearSecret() {
  await chrome.storage.local.remove("apiKey");
  elements.apiKey.value = "";
  setSummary("已清除保存的 API Key。");
}

function toggleKeyVisibility() {
  const isPassword = elements.apiKey.type === "password";
  elements.apiKey.type = isPassword ? "text" : "password";
  elements.toggleKey.textContent = isPassword ? "隐藏" : "显示";
}

async function refreshAnkiStatus() {
  setLog("");
  try {
    const version = await ankiInvoke("version");
    const decks = await ankiInvoke("deckNames");
    renderDecks(decks);
    setAnkiStatus(`AnkiConnect v${version}`, "ok");
    setSummary("Anki 已连接，可以直接导入。");
  } catch (error) {
    renderDecks([]);
    setAnkiStatus("未连接", "warn");
    setSummary("没有连上 AnkiConnect。请先打开 Anki，并确认插件可用。");
    appendLog(`AnkiConnect 连接失败: ${error.message}`);
  }
}

function renderDecks(decks) {
  const options = decks.length ? decks : ["Default"];
  const current = elements.deckName.value;
  elements.deckName.innerHTML = "";

  for (const deck of options) {
    const option = document.createElement("option");
    option.value = deck;
    option.textContent = deck;
    elements.deckName.appendChild(option);
  }

  chrome.storage.local.get(["deckName"]).then((stored) => {
    const preferred = stored.deckName || current || options[0];
    elements.deckName.value = options.includes(preferred) ? preferred : options[0];
  });
}

function clampConcurrency(value) {
  const n = Math.round(Number(value) || 3);
  return Math.min(8, Math.max(1, n));
}

async function handleRun() {
  const apiKey = elements.apiKey.value.trim();
  const modelName = elements.modelName.value.trim() || "deepseek-chat";
  const deckName = elements.deckName.value;
  const attachAudio = elements.attachAudio.checked;
  const youdaoFallback = elements.youdaoFallback.checked;
  const allowDuplicate = elements.allowDuplicate.checked;
  const concurrency = clampConcurrency(elements.concurrency.value);
  const words = elements.wordsInput.value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!apiKey) {
    setSummary("请先填写 DeepSeek API Key。");
    return;
  }
  if (!words.length) {
    setSummary("请先输入至少一个单词。");
    return;
  }

  await saveSettings();
  setBusy(true);
  setLog("");
  setSummary(`准备处理 ${words.length} 个单词（并发 ${concurrency}）。`);

  let successCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let processed = 0;

  try {
    await runWithConcurrency(words, concurrency, async (word) => {
      try {
        const result = await importWordToAnki({
          apiKey,
          modelName,
          deckName,
          attachAudio,
          youdaoFallback,
          allowDuplicate,
          word
        });

        const audioNote = result?.audioSource === "youdao" ? "（有道发音）" : "";
        if (result?.mode === "updated") {
          updatedCount += 1;
          appendLog(`已更新: ${result.word}${audioNote}`);
        } else if (result?.noteId) {
          successCount += 1;
          appendLog(`已导入: ${result.word}${audioNote}`);
        } else {
          skippedCount += 1;
          appendLog(`已跳过: ${word}`);
        }
      } catch (error) {
        failedCount += 1;
        appendLog(`失败: ${word} -> ${error.message}`);
      }

      processed += 1;
      setSummary(`已完成 ${processed}/${words.length}。新增 ${successCount}，更新 ${updatedCount}，跳过 ${skippedCount}，失败 ${failedCount}。`);
    });

    const summaryText = `处理完成。新增 ${successCount}，更新 ${updatedCount}，跳过 ${skippedCount}，失败 ${failedCount}。`;
    setSummary(summaryText);
    await showNotification("词源卡导入助手", summaryText);
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  for (const button of [elements.runButton, elements.saveSettings, elements.clearSettings, elements.refreshDecks]) {
    button.disabled = isBusy;
  }
}

function setAnkiStatus(text, tone) {
  elements.ankiStatus.textContent = text;
  elements.ankiStatus.className = `pill ${tone === "ok" ? "pill-ok" : tone === "warn" ? "pill-warn" : "pill-muted"}`;
}

function setSummary(text) {
  elements.summary.textContent = text;
}

function setCurrentWordAndMeaning(word, meaning) {
  elements.currentWord.textContent = word || "-";
  elements.currentMeaning.textContent = meaning || "-";
}

function setLog(text) {
  elements.logOutput.textContent = text;
}

function appendLog(text) {
  const current = elements.logOutput.textContent;
  elements.logOutput.textContent = current ? `${current}\n${text}` : text;
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

async function preloadSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
    const selection = response?.selection?.trim();
    if (selection && !elements.wordsInput.value.trim()) {
      elements.wordsInput.value = selection;
      setSummary(`已带入当前网页选中的内容: ${selection}`);
    }
  } catch (_error) {
    // 受限页面无法读取划词时静默跳过。
  }
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
    // 通知失败时静默忽略，避免打断主流程。
  }
}


async function showLastContextStatus() {
  try {
    const stored = await chrome.storage.local.get([
      "lastContextStatus",
      "lastContextWord",
      "lastContextMeaning"
    ]);
    if (stored.lastContextStatus) {
      appendLog(`自动导入状态: ${stored.lastContextStatus}`);
      setSummary(stored.lastContextStatus);
    }
    setCurrentWordAndMeaning(stored.lastContextWord, stored.lastContextMeaning);
  } catch (_error) {
    // ignore
  }
}


function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.lastContextStatus?.newValue) {
    const value = changes.lastContextStatus.newValue;
    appendLog(`自动导入状态: ${value}`);
    setSummary(value);
  }

  if (changes.lastContextWord || changes.lastContextMeaning) {
    setCurrentWordAndMeaning(
      changes.lastContextWord?.newValue ?? elements.currentWord.textContent,
      changes.lastContextMeaning?.newValue ?? elements.currentMeaning.textContent
    );
  }
}

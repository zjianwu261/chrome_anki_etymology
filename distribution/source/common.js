const ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const CAMBRIDGE_BASE = "https://dictionary.cambridge.org";
const YOUDAO_VOICE = "https://dict.youdao.com/dictvoice";

const ANKI_FIELDS = [
  "Word", "Part_of_Speech", "Pronunciation", "Example_Sentence",
  "Example_ZH", "Etymology_Breakdown", "Semantic_Evolution", "Memory_Tip"
];

const DEEPSEEK_RETRY_TIMES = 3;
const DEEPSEEK_RETRY_DELAY = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYSTEM_PROMPT = `你是严谨的英语词源学家兼英语教师。只返回 JSON，不加 markdown，不要输出解释性前言。格式：
{"word":"","part_of_speech":"","pronunciation":"","example_sentence":"","example_zh":"","etymology_intro":"","etymology_parts":[{"part":"","origin":"","meaning":""}],"etymology_literal":"","etymology_conclusion":"","semantic_evolution":[{"stage":"","meaning":"","example_en":"","example_zh":""}],"usage_sections":{"parts_of_speech":[{"label":"","meaning":"","example_en":"","example_zh":""}],"relatives":[{"word":"","literal":"","meaning":""}],"comparison":{"title":"","before_word":"","before_focus":"","contrast_word":"","contrast_focus":"","examples":[{"word":"","example_en":"","example_zh":""}]},"phrases":[{"phrase":"","meaning":""}],"summary":""},"memory_tip":""}
规则：
- word: 原词本身，小写或保留专名大小写
- part_of_speech: 用英文简洁列出该词主要词性，如 "preposition/conjunction/adverb"
- pronunciation: IPA，如 /taɪm/
- example_sentence/example_zh: 提供一组最常见核心义例句
- etymology_intro: 用中文写 2-4 句，先说明最早来源语言，再概括字面义
- etymology_parts: 拆解关键前缀/词根/后缀或历史形式；若该词不宜机械拆词，就填真实历史来源单元
- etymology_literal: 用中文写出字面义，如“在前面”
- etymology_conclusion: 用中文总结“核心意象如何推动后续义项发展”
- semantic_evolution: 写 3-5 个阶段，优先体现“空间/动作/具体义 → 时间/抽象义 → 现代固定用法”等脉络；每阶段必须有中文说明、英文例句、中文翻译
- usage_sections.parts_of_speech: 列出 2-4 个主要词性或用法，每项带中文释义和一组例句
- usage_sections.relatives: 列出 3-6 个同源词/近亲词；literal 写字面组合或构词说明，meaning 写现代含义
- usage_sections.comparison: 仅在存在高价值对比时填写；before_word 填当前词，contrast_word 填易混或可对比表达；examples 最多 2 条
- usage_sections.phrases: 列出 4-8 个常见短语或固定搭配，中文释义要简洁
- usage_sections.summary: 用 1 句中文做“一句话总结”，收束整个词源和语义脉络
- memory_tip: 1 句中文记忆技巧，优先利用词源核心意象，不要和 summary 重复
- 内容必须准确、克制，不要编造不确定的词源；若词源有争议，用“可能源自”“普遍认为”等表述
- 所有中文都用自然中文，不要夹杂模板腔`;

function buildPrompt(word) {
  return [
    `分析英语单词：${word}`,
    "目标：生成适合中文学习者理解的词源卡内容。",
    "重点：",
    "1. 先讲最早来源语言和字面义。",
    "2. 明确展示语义如何从早期具体义一步步演变到现代常见义。",
    "3. 补充主要词性、同源近亲词、易混对比、常见短语和一句话总结。",
    "4. 所有内容要有教学价值，避免空话。"
  ].join("\n");
}

function sanitizeWordField(word) {
  return String(word || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-");
}

async function analyzeWord(apiKey, modelName, word) {
  let lastError = null;

  for (let attempt = 1; attempt <= DEEPSEEK_RETRY_TIMES; attempt += 1) {
    let response;
    try {
      response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0,
          max_tokens: 1800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(word) }
          ]
        })
      });
    } catch (networkError) {
      // 网络抖动：可重试
      lastError = networkError;
      if (attempt < DEEPSEEK_RETRY_TIMES) {
        await sleep(DEEPSEEK_RETRY_DELAY * attempt);
        continue;
      }
      throw networkError;
    }

    if (!response.ok) {
      const detail = await response.text();
      // 401 等鉴权错误不重试，直接抛出
      if (response.status === 401) {
        throw new Error(`DeepSeek 鉴权失败 (401)，请检查 API Key。`);
      }
      lastError = new Error(`DeepSeek 请求失败 (${response.status}): ${detail}`);
      if ((response.status === 429 || response.status >= 500) && attempt < DEEPSEEK_RETRY_TIMES) {
        await sleep(DEEPSEEK_RETRY_DELAY * 2 * attempt);
        continue;
      }
      throw lastError;
    }

    const payload = await response.json();
    const raw = payload.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      lastError = new Error("DeepSeek 没有返回内容。");
      if (attempt < DEEPSEEK_RETRY_TIMES) {
        await sleep(DEEPSEEK_RETRY_DELAY * attempt);
        continue;
      }
      throw lastError;
    }

    try {
      return parseModelJson(raw);
    } catch (parseError) {
      lastError = parseError;
      if (attempt < DEEPSEEK_RETRY_TIMES) {
        await sleep(DEEPSEEK_RETRY_DELAY * attempt);
        continue;
      }
      throw parseError;
    }
  }

  throw lastError || new Error("DeepSeek 调用失败。");
}

function parseModelJson(raw) {
  let cleaned = raw;
  if (cleaned.includes("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  cleaned = cleaned.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  cleaned = cleaned.replace(/(?<=: ")([^"]*?)\n([^"]*?)(?=")/g, "$1 $2");
  return JSON.parse(cleaned);
}

function renderEtymology(data) {
  const intro = escapeHtml(data.etymology_intro || "");
  const parts = Array.isArray(data.etymology_parts) ? data.etymology_parts : [];
  const literal = escapeHtml(data.etymology_literal || "");
  const conclusion = escapeHtml(data.etymology_conclusion || "");
  const relatives = Array.isArray(data.usage_sections?.relatives) ? data.usage_sections.relatives : [];

  let html = intro ? `<p class="etym-intro">${intro}</p>` : "";
  if (parts.length) {
    html += `<div class="ep-row">${parts.map((part) => (
      `<div class="ep-chip">` +
      `<span class="ep-part">${escapeHtml(part.part || "")}</span>` +
      `<span class="ep-origin">${escapeHtml(part.origin || "")}</span>` +
      `<span class="ep-meaning">${escapeHtml(part.meaning || "")}</span>` +
      `</div>`
    )).join("")}</div>`;
  }
  if (literal) {
    html += `<p class="etym-lit">${literal}</p>`;
  }
  if (conclusion) {
    html += `<p class="etym-concl">${conclusion}</p>`;
  }
  if (relatives.length) {
    html += `<div class="stage"><div class="stage-title">同源近亲词</div>${relatives.map((item) => {
      const literalText = escapeHtml(item.literal || "");
      const meaningText = escapeHtml(item.meaning || "");
      const detail = [literalText, meaningText].filter(Boolean).join("；");
      return `<div class="stage-meaning"><strong>${escapeHtml(item.word || "")}</strong>${detail ? `：${detail}` : ""}</div>`;
    }).join("")}</div>`;
  }
  return html;
}

function renderSemanticEvolution(data) {
  const stages = Array.isArray(data.semantic_evolution) ? data.semantic_evolution : [];
  const usage = data.usage_sections || {};
  const partsOfSpeech = Array.isArray(usage.parts_of_speech) ? usage.parts_of_speech : [];
  const comparison = usage.comparison && typeof usage.comparison === "object" ? usage.comparison : {};
  const phrases = Array.isArray(usage.phrases) ? usage.phrases : [];
  const summary = escapeHtml(usage.summary || "");

  let html = stages.map((stage) => (
    `<div class="stage">` +
    `<div class="stage-title">${escapeHtml(stage.stage || "")}</div>` +
    `<div class="stage-meaning">${escapeHtml(stage.meaning || "")}</div>` +
    `<div class="stage-ex">` +
    `<span class="ex-en">${escapeHtml(stage.example_en || "")}</span>` +
    `<span class="ex-zh">${escapeHtml(stage.example_zh || "")}</span>` +
    `</div>` +
    `</div>`
  )).join("");

  if (partsOfSpeech.length) {
    html += `<div class="stage"><div class="stage-title">主要词性与用法</div>${partsOfSpeech.map((item) => (
      `<div class="stage-meaning"><strong>${escapeHtml(item.label || "")}</strong>：${escapeHtml(item.meaning || "")}</div>` +
      `<div class="stage-ex">` +
      `<span class="ex-en">${escapeHtml(item.example_en || "")}</span>` +
      `<span class="ex-zh">${escapeHtml(item.example_zh || "")}</span>` +
      `</div>`
    )).join("")}</div>`;
  }

  if (comparison.contrast_word) {
    html += `<div class="stage">` +
      `<div class="stage-title">${escapeHtml(comparison.title || "词义对比")}</div>` +
      `<div class="stage-meaning"><strong>${escapeHtml(comparison.before_word || "")}</strong>：${escapeHtml(comparison.before_focus || "")}</div>` +
      `<div class="stage-meaning"><strong>${escapeHtml(comparison.contrast_word || "")}</strong>：${escapeHtml(comparison.contrast_focus || "")}</div>` +
      `${(Array.isArray(comparison.examples) ? comparison.examples : []).map((item) => (
        `<div class="stage-ex">` +
        `<span class="ex-en">[${escapeHtml(item.word || "")}] ${escapeHtml(item.example_en || "")}</span>` +
        `<span class="ex-zh">${escapeHtml(item.example_zh || "")}</span>` +
        `</div>`
      )).join("")}` +
      `</div>`;
  }

  if (phrases.length) {
    html += `<div class="stage"><div class="stage-title">常见短语</div>${phrases.map((item) => (
      `<div class="stage-meaning"><strong>${escapeHtml(item.phrase || "")}</strong>：${escapeHtml(item.meaning || "")}</div>`
    )).join("")}</div>`;
  }

  if (summary) {
    html += `<div class="stage"><div class="stage-title">一句话总结</div><div class="stage-meaning">${summary}</div></div>`;
  }

  return html;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function deriveCoreMeaningZh(data) {
  const direct = String(data.core_meaning_zh || "").trim();
  if (direct) {
    return direct;
  }

  const semantic = Array.isArray(data.semantic_evolution) ? data.semantic_evolution : [];
  for (const stage of semantic) {
    const candidate = String(stage.example_zh || stage.meaning || "").trim();
    const normalized = normalizeMeaningText(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const exampleZh = normalizeMeaningText(String(data.example_zh || "").trim());
  if (exampleZh) {
    return exampleZh;
  }

  const summary = normalizeMeaningText(String(data.usage_sections?.summary || "").trim());
  if (summary) {
    return summary;
  }

  const memory = normalizeMeaningText(String(data.memory_tip || "").trim());
  return memory;
}

function normalizeMeaningText(text) {
  if (!text) {
    return "";
  }

  let cleaned = String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/[()（）]/g, " ")
    .replace(/[，,。；;：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.length > 16) {
    cleaned = cleaned.slice(0, 16).trim();
  }

  return cleaned;
}

async function fetchCambridgeBytes(word) {
  let pageResponse;
  try {
    pageResponse = await fetch(`${CAMBRIDGE_BASE}/dictionary/english/${encodeURIComponent(word.toLowerCase())}`);
  } catch (_error) {
    return null;
  }
  if (!pageResponse.ok) {
    return null;
  }
  const html = await pageResponse.text();

  const usMatch = html.match(/<span[^>]*class="[^"]*us[^"]*dpron[^"]*"[\s\S]*?<source[^>]*src="([^"]+\.mp3)"/i);
  const ukMatch = html.match(/<span[^>]*class="[^"]*uk[^"]*dpron[^"]*"[\s\S]*?<source[^>]*src="([^"]+\.mp3)"/i);
  const anyMatch = html.match(/<source[^>]*src="([^"]+\.mp3)"/i);

  const src = (usMatch && usMatch[1]) || (ukMatch && ukMatch[1]) || (anyMatch && anyMatch[1]) || null;
  if (!src) {
    return null;
  }

  const audioUrl = src.startsWith("http") ? src : `${CAMBRIDGE_BASE}${src}`;
  let audioResponse;
  try {
    audioResponse = await fetch(audioUrl);
  } catch (_error) {
    return null;
  }
  if (!audioResponse.ok) {
    return null;
  }
  const bytes = new Uint8Array(await audioResponse.arrayBuffer());
  return bytes.length > 1000 ? bytes : null;
}

async function fetchYoudaoBytes(word) {
  // 有道发音 API（type=2 美式），极稳定，作为兜底。
  const url = `${YOUDAO_VOICE}?audio=${encodeURIComponent(word)}&type=2`;
  let response;
  try {
    response = await fetch(url);
  } catch (_error) {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 1000 ? bytes : null;
}

async function fetchAudioBytes(word, useYoudaoFallback = true) {
  // Cambridge 真人发音优先
  const cambridge = await fetchCambridgeBytes(word);
  if (cambridge) {
    return { bytes: cambridge, source: "cambridge" };
  }
  // 失败 → 有道兜底
  if (useYoudaoFallback) {
    const youdao = await fetchYoudaoBytes(word);
    if (youdao) {
      return { bytes: youdao, source: "youdao" };
    }
  }
  return null;
}

async function storeMediaFile(filename, bytes) {
  const base64 = uint8ArrayToBase64(bytes);
  await ankiInvoke("storeMediaFile", { filename, data: base64 });
}

// ─── 自动创建「词源卡」笔记类型（缺失时） ───
const MODEL_NAME = "词源卡";
let modelEnsured = false;

const MODEL_CSS = `.card{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:17px;line-height:1.6;color:#1c1c1e;background:#fff;text-align:left;max-width:680px;margin:0 auto;padding:14px 18px;}
.word{font-size:30px;font-weight:700;text-align:center;}
.pron{text-align:center;color:#8a6d3b;font-size:18px;margin:4px 0;}
.pos{text-align:center;color:#666;font-size:14px;margin-bottom:6px;}
hr{border:none;border-top:1px solid #e3e3e6;margin:12px 0;}
.ex-en{display:block;}
.ex-zh{display:block;color:#666;font-size:15px;}
.etym-lit{color:#0a7d4b;}
.etym-concl{color:#444;font-style:italic;}
.ep-row{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;}
.ep-chip{background:#f2f2f7;border-radius:10px;padding:6px 10px;}
.ep-part{font-weight:700;display:block;}
.ep-origin{color:#8e8e93;font-size:13px;display:block;}
.ep-meaning{font-size:14px;display:block;}
.stage{background:#f7f7fa;border-left:3px solid #c7c7cc;border-radius:6px;padding:8px 12px;margin:8px 0;}
.stage-title{font-weight:700;color:#3a3a3c;margin-bottom:4px;}
.tip{background:#fff7e6;border-radius:8px;padding:8px 12px;margin-top:10px;}`;

const CARD_FRONT = `<div class="word">{{Word}}</div>
<div class="pron">{{Pronunciation}}</div>
<div class="pos">{{Part_of_Speech}}</div>
[sound:{{Word}}.mp3]`;

const CARD_BACK = `{{FrontSide}}
<hr>
<div class="ex-en">{{Example_Sentence}}</div>
<div class="ex-zh">{{Example_ZH}}</div>
<div>{{Etymology_Breakdown}}</div>
<div>{{Semantic_Evolution}}</div>
{{#Memory_Tip}}<div class="tip">💡 {{Memory_Tip}}</div>{{/Memory_Tip}}`;

async function ensureModelExists() {
  if (modelEnsured) {
    return;
  }
  const models = await ankiInvoke("modelNames");
  if (!models.includes(MODEL_NAME)) {
    await ankiInvoke("createModel", {
      modelName: MODEL_NAME,
      inOrderFields: ANKI_FIELDS,
      css: MODEL_CSS,
      cardTemplates: [{ Name: "Card 1", Front: CARD_FRONT, Back: CARD_BACK }]
    });
  }
  modelEnsured = true;
}

async function addEtymologyNote(deckName, fields, allowDuplicate) {
  return ankiInvoke("addNote", {
    note: {
      deckName,
      modelName: MODEL_NAME,
      fields,
      options: { allowDuplicate },
      tags: ["codex-import", "etymology-card"]
    }
  });
}

async function findExistingEtymologyNotes(word) {
  const escaped = String(word).replaceAll('"', '\"');
  return ankiInvoke("findNotes", {
    query: `note:"词源卡" Word:"${escaped}"`
  });
}

async function updateEtymologyNote(noteId, fields) {
  await ankiInvoke("updateNoteFields", {
    note: {
      id: noteId,
      fields
    }
  });
  return noteId;
}

async function ankiInvoke(action, params = {}) {
  const response = await fetch(ANKI_CONNECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params })
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect 请求失败 (${response.status})`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.result;
}

function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function importWordToAnki(config) {
  await ensureModelExists();

  const analysis = await analyzeWord(config.apiKey, config.modelName, config.word);
  const finalWord = sanitizeWordField(analysis.word || config.word);
  const fields = {
    Word: finalWord,
    Part_of_Speech: analysis.part_of_speech || "",
    Pronunciation: analysis.pronunciation || "",
    Example_Sentence: analysis.example_sentence || "",
    Example_ZH: analysis.example_zh || "",
    Etymology_Breakdown: renderEtymology(analysis),
    Semantic_Evolution: renderSemanticEvolution(analysis),
    Memory_Tip: analysis.memory_tip || ""
  };

  let audioSource = null;
  if (config.attachAudio) {
    const audio = await fetchAudioBytes(finalWord, config.youdaoFallback !== false);
    if (audio) {
      await storeMediaFile(`${finalWord}.mp3`, audio.bytes);
      audioSource = audio.source;
    }
  }

  const coreMeaningZh = deriveCoreMeaningZh(analysis);

  try {
    const noteId = await addEtymologyNote(config.deckName, fields, config.allowDuplicate);
    return { noteId, mode: "created", word: finalWord, coreMeaningZh, audioSource };
  } catch (error) {
    if (!config.allowDuplicate && String(error.message).includes("duplicate")) {
      const existingIds = await findExistingEtymologyNotes(finalWord);
      if (existingIds.length) {
        const noteId = await updateEtymologyNote(existingIds[0], fields);
        return { noteId, mode: "updated", word: finalWord, coreMeaningZh, audioSource };
      }
      return { noteId: null, mode: "skipped", word: finalWord, coreMeaningZh, audioSource };
    }
    throw error;
  }
}

// ─── 限并发执行工具（供批量导入使用） ───
async function runWithConcurrency(items, limit, worker) {
  const size = Math.max(1, Number(limit) || 1);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  const runners = [];
  for (let i = 0; i < Math.min(size, items.length); i += 1) {
    runners.push(runner());
  }
  await Promise.all(runners);
}

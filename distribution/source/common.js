const ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const CAMBRIDGE_BASE = "https://dictionary.cambridge.org";
const YOUDAO_VOICE = "https://dict.youdao.com/dictvoice";

const ANKI_FIELDS = [
  "Word", "Part_of_Speech", "Pronunciation", "Example_Sentence",
  "Example_ZH", "Etymology_Breakdown", "Semantic_Evolution", "Memory_Tip",
  "Related_Cards"
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

const MODEL_CSS = `.card{font-family:'Crimson Pro','Noto Serif SC',Georgia,serif;max-width:680px;margin:0 auto;background:#ffffff;border:none;box-shadow:none;text-align:left;color:#111;position:relative;}
.front{padding:58px 54px 50px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:360px;text-align:center;}
.orn{font-size:18px;color:rgba(0,0,0,0.12);margin-bottom:22px;letter-spacing:.22em;}
.f-word-row{display:flex;align-items:baseline;justify-content:center;gap:12px;flex-wrap:wrap;}
.f-word{font-family:'IM Fell English',Georgia,serif;font-size:66px;color:#111;line-height:1;letter-spacing:-.01em;}
.f-pos{font-size:16px;font-style:italic;color:#555;}
.f-ipa{font-size:21px;color:#888;letter-spacing:.02em;}
.f-rule{width:120px;height:1px;margin:28px auto;position:relative;background:linear-gradient(90deg,transparent,#333,transparent);}
.f-rule::before{content:'✦';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:9px;color:#333;background:#fff;padding:0 5px;}
.f-ex-lbl{font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:rgba(0,0,0,0.22);margin-bottom:10px;}
.f-ex{font-size:19px;font-style:italic;color:#222;line-height:1.9;text-align:center;max-width:500px;}
.f-ex-zh{font-family:'Noto Serif SC',serif;font-size:15px;color:#999;margin-top:8px;text-align:center;line-height:1.8;}
.sec-lbl::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,#ddd,transparent);}
.f-audio-btn{display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;background:none;border:none;color:rgba(0,0,0,0.18);cursor:pointer;transition:color .18s,transform .15s;flex-shrink:0;outline:none;align-self:center;}
.f-audio-btn svg{width:20px;height:20px;}
.f-audio-btn:hover{color:#555;}
.f-audio-btn.playing{color:#222;transform:scale(1.2);}
.replay-button{display:none!important;}
.back{padding:38px 50px 46px;}
.b-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid #eee;padding-bottom:16px;margin-bottom:24px;position:relative;}
.b-head::after{content:'';position:absolute;bottom:-1px;left:0;width:36px;height:2px;background:#333;}
.b-word{font-family:'IM Fell English',Georgia,serif;font-size:32px;color:#111;line-height:1;}
.b-pos{font-size:13px;font-style:italic;color:#555;padding:3px 9px;border:1px solid #ddd;border-radius:3px;}
.b-ipa{font-size:16px;color:#999;margin-left:auto;letter-spacing:.02em;}
.sec{margin-bottom:22px;}
.sec-lbl{font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:#bbb;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
.sec-num{font-size:11px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:2px;padding:0 6px;color:#aaa;font-style:normal;}
.hr{height:1px;margin:18px 0;background:linear-gradient(90deg,transparent,#eee 30%,#eee 70%,transparent);}
.etym-intro{font-size:16px;line-height:1.85;color:#333;margin-bottom:12px;}
.ep-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;}
.ep-chip{background:#f6f6f6;border:1px solid #e4e4e4;border-radius:3px;padding:7px 13px 8px;}
.ep-part{display:block;font-size:13.5px;font-weight:600;color:#111;margin-bottom:3px;}
.ep-origin{display:block;font-size:11.5px;color:#aaa;font-style:italic;margin-bottom:3px;}
.ep-meaning{display:block;font-size:12.5px;color:#444;line-height:1.6;}
.etym-lit{font-size:15px;color:#666;font-style:italic;margin-top:10px;padding-left:12px;border-left:2px solid #e0e0e0;line-height:1.8;}
.etym-concl{font-size:16px;color:#111;margin-top:10px;font-weight:600;line-height:1.8;}
.stage{margin-bottom:16px;padding-bottom:16px;border-bottom:1px dashed #eee;}
.stage:last-child{margin-bottom:0;padding-bottom:0;border-bottom:none;}
.stage-title{font-size:15px;font-weight:600;color:#222;margin-bottom:6px;display:flex;align-items:center;gap:7px;line-height:1.45;}
.stage-title::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#333;flex-shrink:0;}
.stage-meaning{font-size:15px;line-height:1.85;color:#333;margin-bottom:8px;}
.stage-ex{background:#fafafa;border-left:2.5px solid #ccc;padding:8px 12px;border-radius:0 3px 3px 0;}
.ex-en{display:block;font-style:italic;font-size:14px;color:#222;line-height:1.8;}
.ex-zh{display:block;font-family:'Noto Serif SC',serif;font-size:13px;color:#777;margin-top:4px;line-height:1.75;}
.mem{background:#fafafa;border:1px solid #ececec;border-left:3px solid #ccc;padding:11px 15px 12px 20px;font-size:15px;font-family:'Noto Serif SC',serif;color:#333;line-height:1.8;border-radius:0 3px 3px 0;position:relative;}
.b-audio-btn{margin-left:auto;align-self:center;}
.b-foot{margin-top:22px;text-align:center;color:#ddd;font-size:14px;}
.stage-meaning strong{color:#111;font-weight:600;}
.stage+.stage{margin-top:2px;}
.etym-concl+.stage{margin-top:14px;}
.sec .stage-meaning{font-family:'Noto Serif SC','Crimson Pro',serif;}
.nl-links-box{margin-top:14px;padding-top:8px;border-top:1px dashed #999;font-size:14px;text-align:left;}
.nl-links-title{color:#888;font-size:12px;margin-bottom:4px;}
a.nl-link{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:10px;background:rgba(66,133,244,.12);color:#4285f4;text-decoration:none;}
a.nl-link:hover{background:rgba(66,133,244,.25);}`;

const CARD_FRONT = `<div class="card front">
<div class="orn">✦ &nbsp;✦ &nbsp;✦</div>

<div class="f-word-row">
<div class="f-word">{{Word}}</div>
<div class="f-ipa">{{Pronunciation}}</div>
<div class="f-pos">{{Part_of_Speech}}</div>
<button class="f-audio-btn" id="audioBtn" onclick="playAudio()" title="按 K 键重复播放">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
<path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06ZM15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z"/>
</svg>
</button>
</div>

<div class="f-rule"></div>
<div class="f-ex-lbl">Example</div>
<div class="f-ex">{{Example_Sentence}}</div>
<div class="f-ex-zh">{{Example_ZH}}</div>

[sound:{{Word}}.mp3]

<script>
function playAudio() {
var nativeBtn = document.querySelector('.replay-button');
if (nativeBtn) { nativeBtn.click(); return; }
var audio = document.querySelector('audio');
if (audio) { audio.currentTime = 0; audio.play(); }
}
document.addEventListener('keydown', function(e) {
if (e.key === 'k' || e.key === 'K') {
e.preventDefault();
playAudio();
var btn = document.getElementById('audioBtn');
if (btn) {
btn.classList.add('playing');
setTimeout(function() { btn.classList.remove('playing'); }, 300);
}
}
});
</script>
</div>`;

const CARD_BACK = `<div class="card back">
<!-- 页眉 -->
<div class="b-head">
<div class="b-word">{{Word}}</div>
<div class="b-ipa">{{Pronunciation}}</div>
<div class="b-pos">{{Part_of_Speech}}</div>
<button class="f-audio-btn b-audio-btn" id="audioBtn" onclick="playAudio()" title="按 K 键重复播放">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
<path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06ZM15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z"/>
</svg>
</button>
</div>

<!-- 1. 词源拆解 -->
<div class="sec">
<div class="sec-lbl"><span class="sec-num">1</span>词源拆解</div>
{{Etymology_Breakdown}}
</div>

<div class="hr"></div>

<!-- 2. 语义演变 -->
<div class="sec">
<div class="sec-lbl"><span class="sec-num">2</span>语义演变</div>
{{Semantic_Evolution}}
</div>

<div class="hr"></div>

<!-- 记忆技巧 -->
<div class="sec">
<div class="sec-lbl">记忆技巧</div>
<div class="mem">{{Memory_Tip}}</div>
</div>

<div class="b-foot">· · ·</div>

[sound:{{Word}}.mp3]

<script>
function playAudio() {
var nativeBtn = document.querySelector('.replay-button');
if (nativeBtn) { nativeBtn.click(); return; }
var audio = document.querySelector('audio');
if (audio) { audio.currentTime = 0; audio.play(); }
}
document.addEventListener('keydown', function(e) {
if (e.key === 'k' || e.key === 'K') {
e.preventDefault();
playAudio();
var btn = document.getElementById('audioBtn');
if (btn) {
btn.classList.add('playing');
setTimeout(function() { btn.classList.remove('playing'); }, 300);
}
}
});
</script>
</div>

{{#Related_Cards}}<div class="nl-links-box"><div class="nl-links-title">🔗 相关卡片</div>{{Related_Cards}}</div>{{/Related_Cards}}`;

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
    Memory_Tip: analysis.memory_tip || "",
    Related_Cards: ""
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

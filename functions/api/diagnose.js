const PROMPT = `あなたは墓石クリーニング「みやこ磨き」の専門家です。送られた墓石の写真を分析し、以下のJSON形式のみで回答してください。説明文やコードブロック記号は不要です。純粋なJSONだけ返してください。

{
  "stone_type": "石種の推定（例：黒御影石（インド産）、大島石、庵治石など）",
  "stone_type_confidence": "高/中/低",
  "estimated_age": "建墓推定年数（例：15〜20年）",
  "estimated_age_confidence": "高/中/低",
  "estimated_size": {
    "width_cm": 120,
    "depth_cm": 150,
    "height_cm": 90,
    "confidence": "高/中/低"
  },
  "deterioration": [
    {
      "type": "劣化種別（コケ/水垢/サビ/シミ/ひび割れ/風化/文字かすれ/落ち葉汚れ）",
      "severity": "程度（軽度/中度/重度）",
      "location": "箇所（例：台座前面、竿石側面）",
      "description": "具体的な状態の説明"
    }
  ],
  "overall_grade": "A〜Dの1文字（A:良好/B:軽微/C:要メンテ/D:早急対応）",
  "recommended_service": "推奨施工内容の概要",
  "recommended_plan": "梅/竹/松のいずれかの1文字",
  "recommended_timing": "推奨施工時期",
  "next_inspection_months": 6,
  "notes": "その他の所見や注意事項"
}

【重要な執筆ルール】
1. recommended_service では以下の表現を絶対に使用しないこと：
   - 「高圧洗浄」「バイオ洗浄」「ケミカル洗浄」「薬品洗浄」「サンドブラスト」「特殊研磨」「再生研磨」
   代わりに以下を使用：
   - 「手作業による丁寧な清掃」
   - 「専用洗剤での拭き取り」
   - 「ブラシでの細部清掃」
   - 「水洗い・拭き上げ」
   - 「撥水コーティング施工」
   みやこ磨きは手作業による丁寧な施工を信条としています。

2. recommended_plan と recommended_service は必ず整合させること。以下の対応ルールを厳守：

   【梅プラン】真心お墓参り代行 = 合掌・簡易清掃・写真報告のみ
   - 選ぶ条件: 劣化がほぼなく、定期訪問・お参り代行で十分な状態（主に評価A）
   - recommended_service には「合掌」「簡易清掃」「写真報告」以外の施工内容を書かないこと
   - 「洗剤洗浄」「コケ除去」「水垢除去」「撥水コーティング」は絶対に含めない

   【竹プラン】標準クリーニング = 梅の内容 + 専用洗剤洗浄・コケ/水垢除去
   - 選ぶ条件: 軽度〜中度の汚れ・コケ・水垢があり、洗浄で改善できる状態（主に評価B〜C）
   - recommended_service には「手作業による丁寧な清掃」「専用洗剤での拭き取り」「ブラシでの細部清掃」を書く
   - 「撥水コーティング」は絶対に含めない（これが必要なら松プランにすること）

   【松プラン】長期美観維持プラン = 竹の内容 + 撥水コーティング
   - 選ぶ条件: 中度〜重度の劣化で撥水コーティングによる長期保護が必要、または美観を長期間維持したい状態（主に評価D、または評価Cで撥水コーティング推奨の場合）
   - recommended_service に「撥水コーティング」を含める場合は必ず松プランを選ぶこと

   厳守事項: recommended_service の内容と recommended_plan が矛盾してはならない。特に「撥水コーティング」を施工内容に書いた場合は、必ず recommended_plan を「松」にすること。

3. 判断に十分な情報がない場合は confidence を「低」としてください。`;

function findJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) {}
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const idx = cleaned.indexOf("{");
  if (idx === -1) return null;
  let depth = 0;
  for (let i = idx; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.substring(idx, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

function sanitizeServiceText(text) {
  if (!text) return text;
  let s = String(text);
  const replacements = [
    [/高圧洗浄/g, "手作業による丁寧な清掃"],
    [/バイオ洗浄/g, "専用洗剤での拭き取り"],
    [/ケミカル洗浄/g, "専用洗剤での拭き取り"],
    [/薬品洗浄/g, "専用洗剤での拭き取り"],
    [/サンドブラスト/g, "研磨処理"],
    [/特殊研磨/g, "撥水コーティング施工"],
    [/再生研磨/g, "撥水コーティング施工"],
  ];
  for (const [pattern, replacement] of replacements) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

function reconcilePlanWithService(r) {
  const service = String(r.recommended_service || "");
  const notes = String(r.notes || "");
  const combined = service + " " + notes;

  const matsuKeywords = ["撥水コーティング", "コーティング施工", "撥水加工"];
  const hasMatsuWork = matsuKeywords.some(kw => combined.indexOf(kw) >= 0);

  const takeKeywords = ["洗剤", "コケ除去", "水垢除去", "ブラシ", "拭き取り", "拭き上げ", "クリーニング", "洗浄", "除去"];
  const hasTakeWork = takeKeywords.some(kw => combined.indexOf(kw) >= 0);

  const umeOnlyKeywords = ["合掌", "お参り", "参拝", "写真報告"];
  const hasUmeWork = umeOnlyKeywords.some(kw => combined.indexOf(kw) >= 0);

  let aiPlan = null;
  if (r.recommended_plan) {
    const p = String(r.recommended_plan).trim();
    if (p.indexOf("松") >= 0) aiPlan = "松";
    else if (p.indexOf("竹") >= 0) aiPlan = "竹";
    else if (p.indexOf("梅") >= 0) aiPlan = "梅";
  }

  if (hasMatsuWork) return "松";

  if (hasTakeWork) {
    if (aiPlan === "松") return "松";
    return "竹";
  }

  if (hasUmeWork && !hasTakeWork) return "梅";

  if (aiPlan) return aiPlan;
  const g = r.overall_grade;
  if (g === "A") return "梅";
  if (g === "D") return "松";
  return "竹";
}

function fixResult(r) {
  if (!r) return null;
  const g = String(r.overall_grade || "C").trim().toUpperCase().charAt(0);
  r.overall_grade = "ABCD".includes(g) ? g : "C";
  if (!Array.isArray(r.deterioration)) r.deterioration = [];
  if (!r.estimated_size) r.estimated_size = { width_cm: 80, depth_cm: 80, height_cm: 100, confidence: "低" };
  r.next_inspection_months = parseInt(r.next_inspection_months) || 6;
  r.recommended_service = sanitizeServiceText(r.recommended_service);
  r.notes = sanitizeServiceText(r.notes);
  r.recommended_plan = reconcilePlanWithService(r);
  return r;
}

async function callClaudeWithRetry(apiKey, reqBody) {
  const delays = [1500, 3500, 7000];
  let lastResp = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(reqBody),
    });

    if (resp.ok) return resp;

    if ((resp.status === 529 || resp.status === 503 || resp.status === 429) && attempt < delays.length) {
      lastResp = resp;
      await new Promise(r => setTimeout(r, delays[attempt]));
      continue;
    }

    return resp;
  }

  return lastResp;
}

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await context.request.json();
    const { images } = body;

    if (!images || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const imageBlocks = images.slice(0, 2).map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType || "image/jpeg",
        data: img.base64,
      },
    }));

    const reqBody = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [...imageBlocks, { type: "text", text: PROMPT }],
        },
      ],
    };

    const apiResp = await callClaudeWithRetry(apiKey, reqBody);

    if (!apiResp || !apiResp.ok) {
      const status = apiResp ? apiResp.status : 500;
      let errText = "";
      try { errText = await apiResp.text(); } catch (e) {}

      let friendly = `Claude API Error ${status}`;
      if (status === 529 || status === 503) {
        friendly = "現在AIサーバーが混雑しています。30秒〜1分ほど時間を置いてから、もう一度お試しください。";
      } else if (status === 429) {
        friendly = "リクエストが集中しています。少し時間を置いてから再度お試しください。";
      } else if (status === 401 || status === 403) {
        friendly = "APIキーの認証に失敗しました。管理者にお問い合わせください。";
      } else if (status >= 500) {
        friendly = "AIサーバーで一時的な問題が発生しています。しばらく時間を置いてからお試しください。";
      } else {
        friendly = `AI診断でエラーが発生しました（コード: ${status}）。しばらく時間を置いてからお試しください。`;
      }

      return new Response(JSON.stringify({ error: friendly, detail: errText.substring(0, 300) }), {
        status: status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await apiResp.json();

    let aiText = "";
    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text" && block.text) aiText += block.text;
      }
    }

    if (!aiText) {
      return new Response(JSON.stringify({ error: "AIからの応答が空でした。もう一度お試しください。" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = findJSON(aiText);
    if (!parsed) {
      return new Response(JSON.stringify({ error: "AIの応答を解析できませんでした。もう一度お試しください。", raw: aiText.substring(0, 300) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = fixResult(parsed);

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "想定外のエラーが発生しました：" + (err.message || String(err)) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

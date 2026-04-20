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
   - 「高圧洗浄」「バイオ洗浄」「ケミカル洗浄」「薬品洗浄」「サンドブラスト」
   代わりに以下を使用：
   - 「手作業による丁寧な清掃」
   - 「専用洗剤での拭き取り」
   - 「ブラシでの細部清掃」
   - 「水洗い・拭き上げ」
   - 「撥水コーティング施工」
   みやこ磨きは手作業による丁寧な施工を信条としています。

2. recommended_plan の判定基準：
   - 「梅」（真心お墓参り代行）: 劣化がほぼなく、定期的な合掌・簡易清掃・献花で十分な状態（主に評価A）
   - 「竹」（標準クリーニング）: 軽度〜中度の汚れ・コケ・水垢があり、専用洗剤と手作業での洗浄で改善できる状態（主に評価B〜C）
   - 「松」（プレミアム再生研磨）: 重度の劣化、深いシミ、風化、色ムラが目立ち、特殊研磨・撥水コーティングが必要な状態（主に評価D、または評価Cで美観を大幅に回復させたい場合）

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

// NGワードを安全な表現に置換（保険）
function sanitizeServiceText(text) {
  if (!text) return text;
  let s = String(text);
  const replacements = [
    [/高圧洗浄/g, "手作業による丁寧な清掃"],
    [/バイオ洗浄/g, "専用洗剤での拭き取り"],
    [/ケミカル洗浄/g, "専用洗剤での拭き取り"],
    [/薬品洗浄/g, "専用洗剤での拭き取り"],
    [/サンドブラスト/g, "研磨処理"],
  ];
  for (const [pattern, replacement] of replacements) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

// おすすめプランの判定（AIが返さなかった場合のフォールバック）
function decidePlan(r) {
  if (r.recommended_plan) {
    const p = String(r.recommended_plan).trim();
    if (p.indexOf("松") >= 0) return "松";
    if (p.indexOf("竹") >= 0) return "竹";
    if (p.indexOf("梅") >= 0) return "梅";
  }
  // フォールバック: 総合評価から判定
  const g = r.overall_grade;
  if (g === "A") return "梅";
  if (g === "B") return "竹";
  if (g === "C") return "竹";
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

  // NGワードのサニタイズ
  r.recommended_service = sanitizeServiceText(r.recommended_service);
  r.notes = sanitizeServiceText(r.notes);

  // おすすめプランの確定
  r.recommended_plan = decidePlan(r);

  return r;
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

    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [...imageBlocks, { type: "text", text: PROMPT }],
          },
        ],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      return new Response(JSON.stringify({ error: `Claude API Error ${apiResp.status}: ${errText}` }), {
        status: apiResp.status,
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
      return new Response(JSON.stringify({ error: "No text in AI response" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = findJSON(aiText);
    if (!parsed) {
      return new Response(JSON.stringify({ error: "Failed to parse JSON", raw: aiText.substring(0, 500) }), {
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
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

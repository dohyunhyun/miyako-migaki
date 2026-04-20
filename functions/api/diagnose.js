const PROMPT = `あなたは墓石クリーニングの専門家です。送られた墓石の写真を分析し、以下のJSON形式のみで回答してください。説明文やコードブロック記号は不要です。純粋なJSONだけ返してください。

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
  "recommended_timing": "推奨施工時期",
  "next_inspection_months": 6,
  "notes": "その他の所見や注意事項"
}

判断に十分な情報がない場合は confidence を「低」としてください。`;

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

function fixResult(r) {
  if (!r) return null;
  const g = String(r.overall_grade || "C").trim().toUpperCase().charAt(0);
  r.overall_grade = "ABCD".includes(g) ? g : "C";
  if (!Array.isArray(r.deterioration)) r.deterioration = [];
  if (!r.estimated_size) r.estimated_size = { width_cm: 80, depth_cm: 80, height_cm: 100, confidence: "低" };
  r.next_inspection_months = parseInt(r.next_inspection_months) || 6;
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
        model: "claude-sonnet-4-20250514",
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

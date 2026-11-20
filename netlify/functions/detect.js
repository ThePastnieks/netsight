// Netlify Function: Detection API Proxy
// Protects API keys, calls Roboflow or Vision API, returns normalized result

const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://detect.roboflow.com';
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID || 'fishing-gear/1';
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const CONF_THRESHOLD = 0.35;

const GEAR_CLASSES = ['buoy', 'float', 'net', 'trap', 'none'];

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Main handler
export async function handler(event, context) {
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const base64Image = body.image;

    if (!base64Image) {
      return errorResponse(400, 'Missing image data');
    }

    // Validate base64
    if (!isValidBase64(base64Image)) {
      return errorResponse(400, 'Invalid image data');
    }

    let result;

    // Try Roboflow first if configured
    if (ROBOFLOW_API_KEY) {
      try {
        result = await callRoboflow(base64Image);
      } catch (err) {
        console.warn('Roboflow failed, trying Claude:', err.message);
      }
    }

    // Fallback to Claude Vision API
    if (!result && CLAUDE_API_KEY) {
      result = await callClaudeVision(base64Image);
    }

    // If neither configured, return error
    if (!result) {
      return errorResponse(503, 'No detection service configured');
    }

    // Normalize and validate result
    const normalized = normalizeResult(result);
    if (!normalized) {
      return errorResponse(500, 'Invalid detection result');
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized)
    };

  } catch (err) {
    console.error('Detection error:', err);
    return errorResponse(500, 'Detection failed: ' + err.message);
  }
}

// Call Roboflow API
async function callRoboflow(base64Image) {
  const url = `${ROBOFLOW_API_URL}/${ROBOFLOW_MODEL_ID}?api_key=${ROBOFLOW_API_KEY}&confidence=${CONF_THRESHOLD * 100}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: base64Image
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Roboflow ${response.status}: ${err}`);
  }

  const data = await response.json();
  return parseRoboflowResult(data);
}

// Parse Roboflow result to standard format
function parseRoboflowResult(data) {
  const predictions = data.predictions || [];

  if (predictions.length === 0) {
    return {
      primary_class: 'none',
      primary_confidence: 0,
      explanation: 'No fishing gear detected in the image.',
      all_predictions: []
    };
  }

  // Sort by confidence descending
  predictions.sort((a, b) => b.confidence - a.confidence);

  const top = predictions[0];
  const className = mapRoboflowClass(top.class);

  return {
    primary_class: className,
    primary_confidence: top.confidence,
    explanation: `Detected ${className} with ${Math.round(top.confidence * 100)}% confidence.`,
    all_predictions: predictions.map(p => ({
      class: mapRoboflowClass(p.class),
      confidence: p.confidence,
      bbox: p.bbox || { x: p.x, y: p.y, width: p.width, height: p.height }
    }))
  };
}

// Map Roboflow class names to our standard classes
function mapRoboflowClass(cls) {
  const lower = cls.toLowerCase();
  if (lower.includes('buoy')) return 'buoy';
  if (lower.includes('float')) return 'float';
  if (lower.includes('net')) return 'net';
  if (lower.includes('trap') || lower.includes('pot')) return 'trap';
  return 'unknown';
}

// Call Claude Vision API
async function callClaudeVision(base64Image) {
  const prompt = `You are an expert at identifying fishing gear in marine photos. Analyze this image and detect any fishing gear.

Look for these specific gear types:
- buoy: Round or cylindrical floating markers, often colorful (orange, yellow, white), used to mark gear location
- float: Small floats or float lines, typically smaller than buoys, often in lines or clusters
- net: Fishing nets (gillnet, trawl net, seine net) - look for mesh patterns, netting in water
- trap: Crab/lobster pots, fish traps - boxy or cylindrical structures with entrances

Return a JSON object with exactly these fields:
{
  "primary_class": "buoy|float|net|trap|none",
  "primary_confidence": 0.0-1.0,
  "explanation": "Brief description of what you see and why",
  "all_predictions": [
    {"class": "buoy", "confidence": 0.9, "bbox": {"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.1}}
  ]
}

Rules:
- Only return one primary_class (the most confident detection)
- If nothing detected, use "none" with low confidence (0.1-0.3)
- Confidence must be 0.0-1.0
- Bbox coordinates are normalized 0-1 (x, y center, width, height)
- Keep explanation under 200 characters`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0]?.text || '{}';

  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON in response');
  } catch (parseErr) {
    console.error('Failed to parse Claude response:', text);
    throw new Error('Invalid response from vision API');
  }
}

// Normalize result to standard format
function normalizeResult(result) {
  if (!result || typeof result !== 'object') return null;

  const primaryClass = result.primary_class || 'unknown';
  const primaryConfidence = Math.max(0, Math.min(1, Number(result.primary_confidence) || 0));
  const explanation = String(result.explanation || 'Detection completed.');

  // Validate class
  if (!GEAR_CLASSES.includes(primaryClass) && primaryClass !== 'unknown') {
    return null;
  }

  return {
    primary_class: primaryClass,
    primary_confidence: primaryConfidence,
    explanation: explanation.slice(0, 300),
    all_predictions: Array.isArray(result.all_predictions) ? result.all_predictions.slice(0, 5) : []
  };
}

// Validate base64
function isValidBase64(str) {
  try {
    // Check if valid base64
    return btoa(atob(str)) === str;
  } catch {
    return false;
  }
}

// Error response helper
function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message })
  };
}
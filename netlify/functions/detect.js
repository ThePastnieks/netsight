// NetSight — detection endpoint
//
// This is the seam between the app and the model. The app POSTs a photo here;
// this function returns a verdict. Replace `runModel()` with your own
// implementation — the app does not care how the answer is produced.
//
// Request   POST application/json
//           { "image": "<base64 jpeg/png, no data: prefix>" }
//
// Response  200 application/json
//           {
//             "fishing_net": true,          // required
//             "confidence": 0.93,           // required, 0..1
//             "class": "net",               // optional: net|buoy|float|trap|none
//             "objects": [                  // optional: bounding boxes for the overlay
//               { "class": "net", "confidence": 0.93, "box": [0.1, 0.2, 0.5, 0.3] }
//             ],
//             "explanation": "…",           // optional, one sentence
//             "model": "netsight-net-v1"    // optional, shown in the UI
//           }
//
// `box` is [x, y, width, height] normalised to 0..1 of the image.
// Errors return a non-2xx status with { "error": "…" }.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'Invalid JSON body');
  }

  const base64 = payload.image;
  if (!base64 || typeof base64 !== 'string') {
    return fail(400, 'Missing "image" (base64)');
  }
  if (base64.length > MAX_IMAGE_BYTES) {
    return fail(413, 'Image too large');
  }

  try {
    const verdict = await runModel(base64);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(verdict)
    };
  } catch (err) {
    console.error('Detection failed:', err);
    return fail(502, 'Detection failed: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// REPLACE THIS with the real model call.
//
// Options, in rough order of effort:
//
//   1. Hosted detector (fastest to wire up)
//      POST the base64 to Roboflow / a Hugging Face inference endpoint /
//      your own Flask+FastAPI service, then map the reply onto the shape below.
//
//   2. Serverless inference
//      Load a TF.js / ONNX model inside this function and run it here.
//
//   3. Call out to a GPU box
//      fetch() your own inference server that holds the trained weights.
//
// Whatever you pick, only the return value matters.
// ---------------------------------------------------------------------------
async function runModel(/* base64 */) {
  // A stub that keeps the app honest: it reports "no verdict" rather than
  // pretending a photo was analysed.
  throw new Error('No model wired up yet — see netlify/functions/detect.js');

  // Example of a finished implementation:
  //
  // const res = await fetch(process.env.MODEL_URL, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     Authorization: 'Bearer ' + process.env.MODEL_TOKEN
  //   },
  //   body: JSON.stringify({ image: base64 })
  // });
  //
  // if (!res.ok) throw new Error(`model ${res.status}`);
  // const out = await res.json();
  //
  // return {
  //   fishing_net: out.predictions.some(p => p.class === 'net' && p.confidence > 0.5),
  //   confidence: Math.max(0, ...out.predictions.map(p => p.confidence)),
  //   class: out.predictions[0]?.class || 'none',
  //   objects: out.predictions.map(p => ({
  //     class: p.class,
  //     confidence: p.confidence,
  //     box: [p.x, p.y, p.width, p.height]
  //   })),
  //   explanation: `Model found ${out.predictions.length} object(s).`,
  //   model: 'netsight-net-v1'
  // };
}

function fail(statusCode, message) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message })
  };
}

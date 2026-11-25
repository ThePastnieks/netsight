// NetSight — detection endpoint, Vercel form.
//
// The app POSTs a photo; this returns a verdict. Replace `runModel()` with your
// own implementation — the app does not care how the answer is produced.
//
// Request   POST application/json
//           { "image": "<base64 jpeg/png, no data: prefix>" }
//
// Response  200 application/json
//           {
//             "fishing_net": true,          // required
//             "confidence": 0.93,           // required, 0..1
//             "class": "net",               // optional: net|buoy|float|trap|none
//             "objects": [                  // optional: boxes for the overlay
//               { "class": "net", "confidence": 0.93, "box": [0.1, 0.2, 0.5, 0.3] }
//             ],
//             "explanation": "…",           // optional, one sentence
//             "model": "netsight-net-v1"    // optional, shown in the UI
//           }
//
// `box` is [x, y, width, height] normalised to 0..1 of the image.
//
// This is the Vercel twin of netlify/functions/detect.js. Vercel only looks in
// api/, so both exist: deploy to either host and the app works.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const image = body.image;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing image' });
  }

  // base64 is ~4/3 the byte size
  if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'Image too large' });
  }

  try {
    const result = await runModel(image);
    return res.status(200).json(normalise(result));
  } catch (err) {
    console.error('detect failed:', err);
    return res.status(502).json({ error: err.message || 'The model did not answer' });
  }
};

// --------------------------------------------------------------- the seam
//
// Replace this. Until a model is wired in, say so plainly instead of inventing
// a verdict — a fake answer here would be worse than no answer, because people
// would act on it.

async function runModel(image) {
  throw new Error(
    'No model wired up yet. Edit api/detect.js and replace runModel(). See DETECT.md.'
  );
}

function normalise(raw) {
  const confidence = Number(raw.confidence);
  const cls = raw.class || (raw.fishing_net ? 'net' : 'none');

  return {
    fishing_net: !!raw.fishing_net,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    class: cls,
    objects: Array.isArray(raw.objects) ? raw.objects : [],
    explanation: raw.explanation || '',
    model: raw.model || 'unknown'
  };
}

# Detection contract

The app does one thing with AI: it hands a photo to a model and shows what the
model says. Everything about *how* the answer is produced is behind one HTTP
endpoint. This document is the whole interface.

```
photo  ──▶  POST {image}  ──▶  your model  ──▶  {fishing_net, confidence, …}  ──▶  UI
```

---

## 1. Request

The app sends exactly this, nothing else:

```http
POST /.netlify/functions/detect
Content-Type: application/json

{ "image": "iVBORw0KGgoAAAANSUhEUg…" }
```

* `image` — base64 **without** the `data:image/jpeg;base64,` prefix.
* Format is whatever the phone camera produced: JPEG or PNG.
* Client-side cap is 5 MB (`CONFIG.MAX_PHOTO_MB`); the function rejects > 8 MB.
* No auth header, no API key, no metadata. If you need a secret, keep it inside
  the function's environment variables.

---

## 2. Response

```json
{
  "fishing_net": true,
  "confidence": 0.93,
  "class": "net",
  "objects": [
    { "class": "net", "confidence": 0.93, "box": [0.10, 0.20, 0.50, 0.30] }
  ],
  "explanation": "A gillnet floats on the surface near the shore.",
  "model": "netsight-net-v1"
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `fishing_net` | **yes** | boolean | The one answer that matters. |
| `confidence` | **yes** | number 0–1 | How sure the model is. |
| `class` | no | `net` \| `buoy` \| `float` \| `trap` \| `none` | Defaults to `net` when `fishing_net` is true, `none` when false. |
| `objects` | no | array | Draws boxes on the photo. |
| `explanation` | no | string | One sentence, shown under the verdict. Truncated at 300 chars. |
| `model` | no | string | Shown in the UI so you can tell versions apart. |

### Boxes

`box` is `[x, y, width, height]`, all normalised to `0..1` of the image, origin
top-left. Pixel coordinates must be divided by image width/height first.

```
[0, 0, 1, 1]      whole image
[0.5, 0.5, 0.5, 0.5]   bottom-right quarter
```

A box with anything other than four finite numbers is dropped silently.

### Errors

Any non-2xx status is shown to the user as-is, prefixed with the code:

```json
{ "error": "model timeout" }
```

---

## 3. Tolerated variations

The client normalises, so you do not have to match the names exactly:

* `fishing_net` may also be `fishingNet`, `is_fishing_net` or `detected`.
* `confidence` may also be `score`, `probability` or `fishing_net_confidence`.
* `objects` may also be `detections`; each item may use `label`/`name` for
  `class`, `score` for `confidence`, and `bbox` for `box`.
* Class names are matched loosely: anything containing `net`/`gill`/`mesh`
  becomes `net`, `buoy`/`marker` → `buoy`, `float`/`barrel` → `float`,
  `trap`/`pot`/`cage` → `trap`.

If `fishing_net` is absent **and** `confidence` is absent, the app treats the
reply as invalid and tells the user the endpoint is misconfigured.

---

## 4. What the UI does with it

| Situation | What the user sees |
|---|---|
| `fishing_net: true`, `confidence ≥ threshold` | **"Fishing net detected"**, type `Net` preselected, box drawn |
| `fishing_net: true`, `confidence < threshold` | Same verdict, but **"Low confidence — choose the gear type yourself"** and no preselection |
| `fishing_net: false` | **"No fishing gear found"**, nothing preselected |
| Endpoint unreachable / non-2xx | Toast with the error; no verdict card at all |

Threshold defaults to `0.5` and is editable in **Admin → AI**.

---

## 5. Where to plug in

`netlify/functions/detect.js` ships with a stub. Replace `runModel()`:

```js
async function runModel(base64) {
  const res = await fetch(process.env.MODEL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.MODEL_TOKEN
    },
    body: JSON.stringify({ image: base64 })
  });
  if (!res.ok) throw new Error(`model ${res.status}`);

  const out = await res.json();
  return {
    fishing_net: out.predictions.some(p => p.class === 'net' && p.confidence > 0.5),
    confidence: Math.max(0, ...out.predictions.map(p => p.confidence)),
    class: out.predictions[0]?.class || 'none',
    objects: out.predictions.map(p => ({
      class: p.class,
      confidence: p.confidence,
      box: [p.x, p.y, p.width, p.height]
    })),
    explanation: `Model found ${out.predictions.length} object(s).`,
    model: 'netsight-net-v1'
  };
}
```

Three ways to run the model itself:

1. **Call a hosted detector** — Roboflow, Hugging Face Inference, a Modal or
   Replicate deployment. Fastest to wire up; you map their reply onto the shape
   above.
2. **Run inference inside the function** — bundle a TF.js / ONNX model and run
   it in Node. Cold starts are the trade-off.
3. **Your own GPU box** — the function just proxies to it. Keep the URL and
   token in Netlify environment variables.

---

## 6. Testing

From the admin panel: **AI → Test endpoint**. It POSTs a 1×1 PNG and reports
either the round-trip time plus the model name, or exactly what was wrong
(HTTP status, non-JSON reply, missing fields).

From the command line:

```bash
curl -sS -X POST http://localhost:8888/.netlify/functions/detect \
  -H 'Content-Type: application/json' \
  -d "{\"image\":\"$(base64 -w0 photo.jpg)\"}"
```

A good reply, in under a second, looks like:

```json
{"fishing_net":true,"confidence":0.91,"class":"net","model":"netsight-net-v1"}
```

---

## 7. Notes for the model team

* The prompt is not in this repo any more — there is no prompt. If you use a
  vision LLM, write your own and keep it next to the model.
* Ask for `fishing_net: false` on open water. False positives cost the user a
  wasted report; false negatives let gear stay in the water.
* Return `unknown` rather than guessing when the water is unreadable (glare,
  chop, night). The UI asks the user to confirm in that case.
* Include `model` so the inspector dashboard can tell which version produced a
  sighting.

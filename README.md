# blueat-cdn-v2

Cloudflare Worker for proxying Bluesky image blobs via paths like:

- `/img/{type}/plain/{did}/{cid}`

This worker resolves the DID to a PDS endpoint, fetches the blob, and caches responses at the edge.

## Deploy via the Cloudflare Dashboard

These steps let you deploy this project **without using the CLI**.

### 1) Create a Worker in the dashboard

1. Sign in to Cloudflare.
2. Go to **Workers & Pages**.
3. Click **Create**.
4. Choose **Workers**.
5. Choose **Start from Hello World** (or equivalent starter option).
6. Name the worker (for example: `blueat-cdn-v2`) and create it.

### 2) Replace the default code with this project’s worker

1. Open your new Worker.
2. Go to the **Code** editor.
3. Open `src/worker.ts` from this repository.
4. Copy all contents of `src/worker.ts` and paste into the dashboard editor.
5. Click **Deploy**.

> Tip: If your dashboard editor is set to JavaScript mode, switch the file to TypeScript (or paste into the default module entrypoint and deploy; Cloudflare handles Worker module syntax).

### 3) Add a route so requests hit the worker

1. In your Worker, open **Settings** → **Triggers**.
2. Add a **Route** for your zone, for example:
   - `cdn.example.com/img/*`
3. Save the trigger.

Now requests to that route will execute this worker.

### 4) (Optional) Use workers.dev first

If you want to test before attaching a route:

1. Keep the default `workers.dev` subdomain enabled.
2. Test with a URL like:
   - `https://<your-worker>.<subdomain>.workers.dev/img/avatar/plain/did:plc:.../...`

### 5) Verify behavior

Check that:

- Valid image URLs return content with `200`.
- Invalid paths return `404`.
- Non-`GET`/`HEAD` requests return `405`.
- Response headers include cache metadata such as `Cache-Control` and `X-Proxy-Source`.

## Local development (optional)

If you decide to use local tooling later:

```bash
npm install
npm run dev
```

And deploy with:

```bash
npm run deploy
```

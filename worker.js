const PLC_DIRECTORY = "https://plc.directory";
const PATH_RE = /^\/img\/([^/]+)\/plain\/(did:[^/]+)\/([^@/]+)/;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(PATH_RE);
    if (!match) return new Response("Not Found", { status: 404 });

    const cache = caches.default;

    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      const age = Date.now() - new Date(cachedResponse.headers.get("X-Cached-At") || 0).getTime();
      if (age > 86_400_000) {
        ctx.waitUntil(revalidate(request, match, cache));
      }
      return cachedResponse;
    }

    const type = match[1];
    const did = match[2];
    const cid = match[3];

    try {
      const pdsUrl = await resolvePds(did);
      if (!pdsUrl) return new Response("PDS Not Found", { status: 404 });

      let blobRes = await fetch(`${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`);

      if (blobRes.status === 404 && (type === "avatar" || type === "banner")) {
        blobRes = await resolveProfileFallback(pdsUrl, did, type, cid);
      }

      if (!blobRes?.ok) return new Response("Asset Not Found", { status: 404 });

      const finalRes = buildResponse(blobRes, "pds-direct");
      ctx.waitUntil(cache.put(request, finalRes.clone()));
      return finalRes;
    } catch {
      return new Response("Bad Gateway", { status: 502 });
    }
  },
};

function buildResponse(source, proxySource) {
  const res = new Response(source.body, source);
  res.headers.set("Cache-Control", "public, max-age=604800, immutable");
  res.headers.set("X-Proxy-Source", proxySource);
  res.headers.set("X-Cached-At", new Date().toUTCString());
  res.headers.set("Content-Disposition", "inline");
  return res;
}

async function resolveProfileFallback(pdsUrl, did, type, cid) {
  const profileRes = await fetch(
    `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.actor.profile&rkey=self`
  );
  if (!profileRes.ok) return null;
  const profileData = await profileRes.json();
  const originalCid = profileData.value?.[type]?.ref?.$link;
  if (!originalCid || originalCid === cid) return null;
  return fetch(`${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${originalCid}`);
}

async function revalidate(request, match, cache) {
  const type = match[1], did = match[2], cid = match[3];
  try {
    const pdsUrl = await resolvePds(did);
    if (!pdsUrl) return;
    const blobRes = await fetch(`${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`);
    if (blobRes.ok) {
      await cache.put(request, buildResponse(blobRes, "pds-direct-revalidate"));
    }
  } catch {}
}

async function resolvePds(did) {
  let reqUrl;
  if (did.startsWith("did:web:")) {
    const parts = did.slice(8).split(":");
    const host = decodeURIComponent(parts[0]);
    const path = parts.length === 1
      ? "/.well-known/did.json"
      : `/${parts.slice(1).map(decodeURIComponent).join("/")}/did.json`;
    reqUrl = `https://${host}${path}`;
  } else {
    reqUrl = `${PLC_DIRECTORY}/${did}`;
  }

  const res = await fetch(reqUrl, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) return null;

  const doc = await res.json();
  if (!doc?.service) return null;

  for (let i = 0; i < doc.service.length; i++) {
    const s = doc.service[i];
    if (s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer") {
      return s.serviceEndpoint;
    }
  }
  return null;
}

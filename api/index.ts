import type { VercelRequest, VercelResponse } from "@vercel/node";

const PLC_DIRECTORY = "https://plc.directory";
const PATH_RE = /^\/img\/([^/]+)\/plain\/(did:[^/]+)\/([^@/]+)/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const host = req.headers.host ?? "localhost";
  const protocol = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const match = url.pathname.match(PATH_RE);

  if (!match) {
    res.status(404).send("Not Found");
    return;
  }

  const type = match[1];
  const did = match[2];
  const cid = match[3];

  try {
    const pdsUrl = await resolvePds(did);
    if (!pdsUrl) {
      res.status(404).send("PDS Not Found");
      return;
    }

    let blobRes = await fetch(`${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`);

    if (blobRes.status === 404 && (type === "avatar" || type === "banner")) {
      const fallbackRes = await resolveProfileFallback(pdsUrl, did, type, cid);
      if (fallbackRes) blobRes = fallbackRes;
    }

    if (!blobRes.ok || !blobRes.body) {
      res.status(404).send("Asset Not Found");
      return;
    }

    res.status(200);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("X-Proxy-Source", "pds-direct");
    res.setHeader("X-Cached-At", new Date().toUTCString());
    res.setHeader("Content-Disposition", "inline");

    const contentType = blobRes.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const arr = Buffer.from(await blobRes.arrayBuffer());
    res.send(arr);
  } catch {
    res.status(502).send("Bad Gateway");
  }
}

async function resolveProfileFallback(pdsUrl: string, did: string, type: string, cid: string) {
  const profileRes = await fetch(
    `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.actor.profile&rkey=self`
  );
  if (!profileRes.ok) return null;

  const profileData = (await profileRes.json()) as {
    value?: Record<string, { ref?: { $link?: string } }>;
  };
  const originalCid = profileData.value?.[type]?.ref?.$link;
  if (!originalCid || originalCid === cid) return null;

  return fetch(`${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${originalCid}`);
}

async function resolvePds(did: string): Promise<string | null> {
  let reqUrl: string;

  if (did.startsWith("did:web:")) {
    const parts = did.slice(8).split(":");
    const host = decodeURIComponent(parts[0]);
    const path =
      parts.length === 1
        ? "/.well-known/did.json"
        : `/${parts.slice(1).map(decodeURIComponent).join("/")}/did.json`;
    reqUrl = `https://${host}${path}`;
  } else {
    reqUrl = `${PLC_DIRECTORY}/${did}`;
  }

  const docRes = await fetch(reqUrl);
  if (!docRes.ok) return null;

  const doc = (await docRes.json()) as {
    service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>;
  };

  if (!doc.service) return null;

  for (const service of doc.service) {
    if (
      service.id === "#atproto_pds" ||
      service.type === "AtprotoPersonalDataServer"
    ) {
      return service.serviceEndpoint ?? null;
    }
  }

  return null;
}

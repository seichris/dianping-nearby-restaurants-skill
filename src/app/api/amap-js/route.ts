import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const AMAP_JS_API_URL = "https://webapi.amap.com/maps";
const CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const FORWARDED_REQUEST_HEADERS = ["accept-language", "referer", "user-agent"];

function getAmapUrl(request: NextRequest): URL | null {
  const { searchParams } = new URL(request.url);
  const key = (searchParams.get("key") || "").trim();
  const version = (searchParams.get("v") || "2.0").trim();

  if (!key) return null;

  const url = new URL(AMAP_JS_API_URL);
  url.searchParams.set("v", version);
  url.searchParams.set("key", key);
  return url;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const targetUrl = getAmapUrl(request);
  if (!targetUrl) {
    return NextResponse.json({ error: "AMap JS API key is required." }, { status: 400 });
  }

  const upstreamHeaders = new Headers({
    accept: "application/javascript,text/javascript,*/*",
  });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  const upstream = await fetch(targetUrl.toString(), {
    cache: "no-store",
    headers: upstreamHeaders,
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: "Failed to fetch AMap JS API." }, { status: upstream.status || 502 });
  }

  const upstreamContentType = upstream.headers.get("content-type") || "application/javascript; charset=utf-8";
  const isJavaScript = /\b(?:java|ecma)script\b/i.test(upstreamContentType);
  const headers = new Headers({
    "cache-control": isJavaScript ? CACHE_CONTROL : "no-store",
    "content-type": upstreamContentType,
    vary: "Referer, User-Agent, Accept-Language",
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

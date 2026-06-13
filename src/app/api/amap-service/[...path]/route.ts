import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AMAP_REST_API_ORIGIN = "https://restapi.amap.com";
const AMAP_WEB_API_ORIGIN = "https://webapi.amap.com";
const AMAP_SERVICE_PREFIX = "_AMapService";
const AMAP_VERSION_PATH_PATTERN = /^v\d+$/;

const FORWARDED_REQUEST_HEADERS = ["accept", "accept-language", "content-type", "referer", "user-agent"];

const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface AMapProxyContext {
  params: Promise<{
    path?: string[];
  }>;
}

function buildUpstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  });
  return headers;
}

async function proxyAMapService(request: NextRequest, context: AMapProxyContext): Promise<NextResponse> {
  if (process.env.AMAP_USE_SERVICE_PROXY !== "true") {
    return NextResponse.json({ error: "AMap service proxy is disabled." }, { status: 404 });
  }

  const securityJsCode = (process.env.AMAP_SECURITY_JS_CODE || "").trim();
  if (!securityJsCode) {
    return NextResponse.json({ error: "Missing AMAP_SECURITY_JS_CODE." }, { status: 500 });
  }

  const { path = [] } = await context.params;
  if (path[0] !== AMAP_SERVICE_PREFIX || !AMAP_VERSION_PATH_PATTERN.test(path[1] || "")) {
    return NextResponse.json({ error: "Unsupported AMap service path." }, { status: 400 });
  }

  const servicePath = path.slice(1);
  const isStyleRequest = servicePath[0] === "v4" && servicePath[1] === "map" && servicePath[2] === "styles";
  const upstreamPath = servicePath.map((segment) => encodeURIComponent(segment)).join("/");
  const upstreamUrl = new URL(`/${upstreamPath}`, isStyleRequest ? AMAP_WEB_API_ORIGIN : AMAP_REST_API_ORIGIN);
  const requestUrl = new URL(request.url);

  requestUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value);
  });
  upstreamUrl.searchParams.set("jscode", securityJsCode);

  const upstream = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers: buildUpstreamHeaders(request),
    cache: "no-store",
    redirect: "manual",
  });

  return new NextResponse(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream),
  });
}

export async function GET(request: NextRequest, context: AMapProxyContext): Promise<NextResponse> {
  return proxyAMapService(request, context);
}

export async function HEAD(request: NextRequest, context: AMapProxyContext): Promise<NextResponse> {
  return proxyAMapService(request, context);
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET,HEAD,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

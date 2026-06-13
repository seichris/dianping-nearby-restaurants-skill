export interface AMapClientConfig {
  jsApiKey: string;
  securityJsCode: string;
  serviceHost: string;
  useServiceProxy: boolean;
  configError: string | null;
}

type AMapClientEnv = Record<string, string | undefined>;

export function resolveAMapClientConfig(env: AMapClientEnv): AMapClientConfig {
  const useServiceProxy = env.AMAP_USE_SERVICE_PROXY === "true";
  const allowClientSecurityJsCode = env.AMAP_ALLOW_CLIENT_SECURITY_JS_CODE === "true" || env.NODE_ENV !== "production";
  const jsApiKey = (env.AMAP_JS_API_KEY || "").trim();
  const securityJsCode = (env.AMAP_SECURITY_JS_CODE || "").trim();
  let configError: string | null = null;

  if (jsApiKey && env.NODE_ENV === "production") {
    if (useServiceProxy && !securityJsCode) {
      configError = "AMap service proxy requires AMAP_SECURITY_JS_CODE.";
    } else if (!useServiceProxy && !allowClientSecurityJsCode) {
      configError =
        "AMap production config requires AMAP_ALLOW_CLIENT_SECURITY_JS_CODE=true for direct client auth or AMAP_USE_SERVICE_PROXY=true for the service proxy.";
    } else if (!useServiceProxy && !securityJsCode) {
      configError = "AMap direct client auth requires AMAP_SECURITY_JS_CODE.";
    }
  }

  return {
    jsApiKey,
    securityJsCode: !useServiceProxy && allowClientSecurityJsCode ? securityJsCode : "",
    serviceHost: useServiceProxy ? (env.AMAP_SERVICE_HOST || "/api/amap-service/_AMapService").trim() : "",
    useServiceProxy,
    configError,
  };
}

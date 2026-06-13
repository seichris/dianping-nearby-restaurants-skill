"use client";

declare global {
  interface Window {
    AMap?: AMapLoaderNamespace;
    _AMapSecurityConfig?: {
      securityJsCode?: string;
      serviceHost?: string;
    };
  }
}

interface AMapLoaderNamespace {
  Map?: unknown;
  plugin?: (plugins: string[], callback: () => void) => void;
}

let amapLoader: Promise<AMapLoaderNamespace> | null = null;

export function loadAMap(key: string, securityJsCode: string, serviceHost: string): Promise<AMapLoaderNamespace> {
  if (typeof window === "undefined") throw new Error("AMap can only load in the browser.");
  if (window.AMap?.Map) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;

  const config: NonNullable<Window["_AMapSecurityConfig"]> = {};
  if (securityJsCode) {
    config.securityJsCode = securityJsCode;
  } else if (serviceHost) {
    config.serviceHost = serviceHost;
  }
  window._AMapSecurityConfig = config;

  amapLoader = new Promise<AMapLoaderNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-amap-loader="true"]');
    if (existing) {
      if (existing.dataset.amapLoaded === "true" && window.AMap?.Map) {
        resolve(window.AMap);
        return;
      }
      existing.addEventListener(
        "load",
        () => {
          if (window.AMap?.Map) {
            resolve(window.AMap);
          } else {
            reject(new Error("AMap JS API loaded without AMap.Map."));
          }
        },
        { once: true }
      );
      existing.addEventListener("error", () => reject(new Error("Failed to load AMap JS API.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `/api/amap-js?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.amapLoader = "true";
    script.onload = () => {
      const loadedAMap = window.AMap;
      if (!loadedAMap?.Map) {
        reject(new Error("AMap JS API loaded without AMap.Map."));
        return;
      }
      script.dataset.amapLoaded = "true";
      resolve(loadedAMap);
    };
    script.onerror = () => reject(new Error("Failed to load AMap JS API."));
    document.head.appendChild(script);
  }).catch((error) => {
    amapLoader = null;
    throw error;
  });

  return amapLoader;
}

export function loadAMapPlugins(AMap: AMapLoaderNamespace, plugins: string[]): Promise<void> {
  const plugin = AMap?.plugin;
  if (!plugin) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("AMap plugins did not finish loading.")), 12000);
    plugin(plugins, () => {
      window.clearTimeout(timeout);
      resolve();
    });
  });
}

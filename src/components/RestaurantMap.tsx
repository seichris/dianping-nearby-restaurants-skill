"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { loadAMap, loadAMapPlugins } from "@/lib/client/amapLoader";
import type { AMapClientConfig } from "@/lib/amapMaps";
import type { RestaurantRecord } from "@/types/restaurants";

interface RestaurantMapProps {
  records: RestaurantRecord[];
  activeCity: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  amapConfig: AMapClientConfig;
}

interface Point {
  lng: number;
  lat: number;
}

interface AMapLngLatLike {
  lng?: number;
  lat?: number;
  getLng?: () => number;
  getLat?: () => number;
}

interface AMapMarkerInstance {
  setMap: (map: AMapMapInstance | null) => void;
  on?: (eventName: string, handler: () => void) => void;
  getContent?: () => unknown;
  getPosition?: () => unknown;
}

interface AMapMapInstance {
  addControl?: (control: unknown) => void;
  panTo?: (position: unknown) => void;
  resize?: () => void;
  setCenter?: (center: [number, number]) => void;
  setFitView?: (markers: AMapMarkerInstance[], immediately?: boolean, avoid?: number[], maxZoom?: number) => void;
}

interface AMapGeocoderInstance {
  getLocation: (address: string, callback: (status: string, result: AMapGeocodeResult) => void) => void;
}

interface AMapInfoWindowInstance {
  setContent?: (content: HTMLElement) => void;
  open?: (map: AMapMapInstance, position: unknown) => void;
}

interface AMapGeocodeResult {
  info?: string;
  geocodes?: Array<{
    location?: AMapLngLatLike;
  }>;
}

interface AMapNamespace {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMapInstance;
  Marker: new (options: Record<string, unknown>) => AMapMarkerInstance;
  Geocoder: new (options: Record<string, unknown>) => AMapGeocoderInstance;
  ToolBar: new (options?: Record<string, unknown>) => unknown;
  Scale: new (options?: Record<string, unknown>) => unknown;
  InfoWindow: new (options?: Record<string, unknown>) => AMapInfoWindowInstance;
  Pixel: new (x: number, y: number) => unknown;
  plugin?: (plugins: string[], callback: () => void) => void;
}

const CITY_CENTERS: Record<string, Point> = {
  beijing: { lng: 116.4074, lat: 39.9042 },
  shanghai: { lng: 121.4737, lat: 31.2304 },
};

const CITY_NAMES: Record<string, string> = {
  beijing: "北京",
  shanghai: "上海",
};

function fallbackCenter(records: RestaurantRecord[], activeCity?: string): Point {
  if (activeCity && CITY_CENTERS[activeCity]) return CITY_CENTERS[activeCity];
  const firstCity = records[0]?.city;
  if (firstCity && records.every((record) => record.city === firstCity)) {
    return CITY_CENTERS[firstCity] || CITY_CENTERS.shanghai;
  }
  return { lng: 119.3, lat: 35.7 };
}

function markerLabel(index: number): string {
  return index < 99 ? String(index + 1) : "99+";
}

function createMarkerElement(index: number, active: boolean): HTMLElement {
  const marker = document.createElement("div");
  marker.className = "amap-marker-pin";
  marker.dataset.active = active ? "true" : "false";
  const label = document.createElement("span");
  label.textContent = markerLabel(index);
  marker.appendChild(label);
  return marker;
}

function setMarkerActive(marker: AMapMarkerInstance, active: boolean): void {
  const content = marker?.getContent?.();
  if (content instanceof HTMLElement) {
    content.dataset.active = active ? "true" : "false";
  }
}

function getLngLat(location: unknown): Point | null {
  if (!location) return null;
  const candidate = location as AMapLngLatLike;
  const lng = typeof candidate.getLng === "function" ? candidate.getLng() : candidate.lng;
  const lat = typeof candidate.getLat === "function" ? candidate.getLat() : candidate.lat;
  return typeof lng === "number" && typeof lat === "number" && Number.isFinite(lng) && Number.isFinite(lat)
    ? { lng, lat }
    : null;
}

function geocodeAddress(AMap: AMapNamespace, record: RestaurantRecord): Promise<Point | null> {
  if (!record.address) return Promise.resolve(null);

  return new Promise((resolve) => {
    const geocoder = new AMap.Geocoder({
      city: CITY_NAMES[record.city] || record.cityLabel || record.city,
    });
    const query = `${CITY_NAMES[record.city] || record.cityLabel}${record.address}`;
    geocoder.getLocation(query, (status, result) => {
      if (status !== "complete" || result?.info !== "OK") {
        resolve(null);
        return;
      }
      resolve(getLngLat(result.geocodes?.[0]?.location));
    });
  });
}

function infoWindowContent(record: RestaurantRecord): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.maxWidth = "260px";
  wrap.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";

  const title = document.createElement("div");
  title.textContent = record.name;
  title.style.fontWeight = "700";
  title.style.fontSize = "14px";
  title.style.marginBottom = "6px";
  wrap.appendChild(title);

  const meta = document.createElement("div");
  meta.textContent = [record.stationName, record.category, record.address].filter(Boolean).join(" · ");
  meta.style.color = "#475569";
  meta.style.fontSize = "12px";
  meta.style.lineHeight = "1.45";
  wrap.appendChild(meta);

  if (record.taocanCount > 0 || record.voucherCount > 0) {
    const offers = document.createElement("div");
    offers.textContent = `${record.taocanCount} taocan, ${record.voucherCount} vouchers`;
    offers.style.color = "#0f766e";
    offers.style.fontSize = "12px";
    offers.style.fontWeight = "600";
    offers.style.marginTop = "8px";
    wrap.appendChild(offers);
  }

  return wrap;
}

export default function RestaurantMap({ records, activeCity, selectedId, onSelect, amapConfig }: RestaurantMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMapInstance | null>(null);
  const amapRef = useRef<AMapNamespace | null>(null);
  const markersRef = useRef<Map<string, AMapMarkerInstance>>(new Map());
  const pointCacheRef = useRef<Map<string, Point | null>>(new Map());
  const infoWindowRef = useRef<AMapInfoWindowInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing map");
  const [mapReady, setMapReady] = useState(false);
  const activeCityRef = useRef(activeCity);

  const limitedRecords = useMemo(() => records.slice(0, 250), [records]);
  const configError = amapConfig.configError || (!amapConfig.jsApiKey ? "Missing AMAP_JS_API_KEY." : null);
  const visibleError = configError || error;

  useEffect(() => {
    activeCityRef.current = activeCity;
  }, [activeCity]);

  useEffect(() => {
    if (configError) return;
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    async function initializeMap() {
      try {
        setStatus("Loading AMap");
        const AMap = (await loadAMap(amapConfig.jsApiKey, amapConfig.securityJsCode, amapConfig.serviceHost)) as AMapNamespace;
        if (cancelled || !containerRef.current) return;

        const center = fallbackCenter(limitedRecords, activeCityRef.current);
        const map = new AMap.Map(containerRef.current, {
          center: [center.lng, center.lat],
          zoom: limitedRecords.length > 0 && limitedRecords.every((record) => record.city === limitedRecords[0].city) ? 12 : 5,
          resizeEnable: true,
          viewMode: "2D",
        });

        mapRef.current = map;
        amapRef.current = AMap;
        setStatus("Loading map tools");

        await loadAMapPlugins(AMap, ["AMap.Geocoder", "AMap.ToolBar", "AMap.Scale"]);
        if (cancelled) return;
        map.addControl?.(new AMap.ToolBar({ position: "RT" }));
        map.addControl?.(new AMap.Scale());
        infoWindowRef.current = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30) });
        setMapReady(true);
        setStatus("Ready");
      } catch (mapError) {
        if (!cancelled) {
          setError(mapError instanceof Error ? mapError.message : "Failed to initialize AMap.");
        }
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
    };
  }, [amapConfig.jsApiKey, amapConfig.securityJsCode, amapConfig.serviceHost, configError, limitedRecords]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize?.();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map || !mapReady) return;
    const amapNamespace = AMap;
    const mapInstance = map;

    let cancelled = false;

    async function renderMarkers() {
      setStatus("Geocoding addresses");
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = new Map();

      const points = await Promise.all(
        limitedRecords.map(async (record) => {
          const cacheKey = `${record.city}:${record.address || record.name}`;
          if (!pointCacheRef.current.has(cacheKey)) {
            pointCacheRef.current.set(cacheKey, await geocodeAddress(amapNamespace, record));
          }
          return { record, point: pointCacheRef.current.get(cacheKey) || null };
        })
      );

      if (cancelled) return;

      const fitMarkers: AMapMarkerInstance[] = [];
      points.forEach(({ record, point }, index) => {
        if (!point) return;
        const marker = new amapNamespace.Marker({
          position: [point.lng, point.lat],
          content: createMarkerElement(index, record.id === selectedId),
          anchor: "bottom-center",
          title: record.name,
          bubble: false,
        });
        marker.on?.("click", () => {
          onSelect(record.id);
          infoWindowRef.current?.setContent?.(infoWindowContent(record));
          infoWindowRef.current?.open?.(mapInstance, marker.getPosition?.());
        });
        marker.setMap(mapInstance);
        markersRef.current.set(record.id, marker);
        fitMarkers.push(marker);
      });

      if (fitMarkers.length) {
        mapInstance.setFitView?.(fitMarkers, false, [72, 72, 72, 72], 16);
      } else {
        const center = fallbackCenter(limitedRecords, activeCityRef.current);
        mapInstance.setCenter?.([center.lng, center.lat]);
      }

      setStatus(`${fitMarkers.length} mapped`);
    }

    void renderMarkers();

    return () => {
      cancelled = true;
    };
  }, [limitedRecords, mapReady, onSelect, selectedId]);

  useEffect(() => {
    const marker = selectedId ? markersRef.current.get(selectedId) : null;
    const map = mapRef.current;
    markersRef.current.forEach((currentMarker, id) => setMarkerActive(currentMarker, id === selectedId));
    if (!marker || !map) return;
    map.panTo?.(marker.getPosition?.());
  }, [selectedId]);

  return (
    <div className="relative h-full min-h-[420px] bg-slate-100">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
        {visibleError ? <span className="font-medium text-red-700">{visibleError}</span> : <span>{status}</span>}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-sm">
        Markers are geocoded from Dianping shop addresses.
      </div>
    </div>
  );
}

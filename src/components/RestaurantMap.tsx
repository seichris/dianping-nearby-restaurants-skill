"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLatBounds, Map as MapLibreMap, Marker as MapLibreMarker, Popup as MapLibrePopup } from "maplibre-gl";

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

type MapProvider = "openfreemap" | "amap";

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
  destroy?: () => void;
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

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const CITY_CENTERS: Record<string, Point> = {
  beijing: { lng: 116.4074, lat: 39.9042 },
  shanghai: { lng: 121.4737, lat: 31.2304 },
};

const STATION_CENTERS: Record<string, Point> = {
  "beijing::团结湖": { lng: 116.4618, lat: 39.9338 },
  "shanghai::静安寺": { lng: 121.446, lat: 31.2231 },
};

const CITY_NAMES: Record<string, string> = {
  beijing: "北京",
  shanghai: "上海",
};

function fallbackCenter(records: RestaurantRecord[], activeCity?: string): Point {
  const stationCenter = records[0]?.stationKey ? STATION_CENTERS[records[0].stationKey] : null;
  if (stationCenter && records.every((record) => record.stationKey === records[0].stationKey)) return stationCenter;
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
  marker.className = "restaurant-marker-pin";
  marker.dataset.active = active ? "true" : "false";
  const label = document.createElement("span");
  label.textContent = markerLabel(index);
  marker.appendChild(label);
  return marker;
}

function setMarkerElementActive(element: HTMLElement | null | undefined, active: boolean): void {
  if (element) element.dataset.active = active ? "true" : "false";
}

function setAMapMarkerActive(marker: AMapMarkerInstance, active: boolean): void {
  const content = marker?.getContent?.();
  if (content instanceof HTMLElement) {
    setMarkerElementActive(content, active);
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

function sharedMapPoint(record: RestaurantRecord): Point | null {
  const location = record.amapLocation;
  if (!location) return null;
  return Number.isFinite(location.lng) && Number.isFinite(location.lat)
    ? { lng: location.lng, lat: location.lat }
    : null;
}

function geocodeAddress(AMap: AMapNamespace, record: RestaurantRecord): Promise<Point | null> {
  const sharedPoint = sharedMapPoint(record);
  if (sharedPoint) return Promise.resolve(sharedPoint);
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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function offsetPoint(center: Point, distanceMeters: number, bearingDegrees: number): Point {
  const bearing = (bearingDegrees * Math.PI) / 180;
  const latRadians = (center.lat * Math.PI) / 180;
  const latOffset = (Math.cos(bearing) * distanceMeters) / 111_320;
  const lngOffset = (Math.sin(bearing) * distanceMeters) / (111_320 * Math.cos(latRadians));
  return { lng: center.lng + lngOffset, lat: center.lat + latOffset };
}

function approximateOpenMapPoint(record: RestaurantRecord, index: number): Point {
  const sharedPoint = sharedMapPoint(record);
  if (sharedPoint) return sharedPoint;
  const center = STATION_CENTERS[record.stationKey] || CITY_CENTERS[record.city] || CITY_CENTERS.shanghai;
  const distance = Math.max(80, Math.min(record.distanceMeters || 420, 1800));
  const bearing = (hashString(`${record.id}:${record.name}`) + index * 23) % 360;
  return offsetPoint(center, distance, bearing);
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
  const amapMapRef = useRef<AMapMapInstance | null>(null);
  const amapRef = useRef<AMapNamespace | null>(null);
  const amapMarkersRef = useRef<Map<string, AMapMarkerInstance>>(new Map());
  const amapPointCacheRef = useRef<Map<string, Point | null>>(new Map());
  const amapInfoWindowRef = useRef<AMapInfoWindowInstance | null>(null);
  const openMapRef = useRef<MapLibreMap | null>(null);
  const openMarkersRef = useRef<Map<string, { marker: MapLibreMarker; point: Point }>>(new Map());
  const openPopupRef = useRef<MapLibrePopup | null>(null);
  const [provider, setProvider] = useState<MapProvider>("openfreemap");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing map");
  const [amapReady, setAMapReady] = useState(false);
  const [openMapReady, setOpenMapReady] = useState(false);
  const activeCityRef = useRef(activeCity);

  const limitedRecords = useMemo(() => records.slice(0, 250), [records]);
  const configError = amapConfig.configError || (!amapConfig.jsApiKey ? "Missing AMAP_JS_API_KEY." : null);
  const visibleError = provider === "amap" ? configError || error : error;

  useEffect(() => {
    activeCityRef.current = activeCity;
  }, [activeCity]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      amapMapRef.current?.resize?.();
      openMapRef.current?.resize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (provider !== "openfreemap") return;
    if (!containerRef.current || openMapRef.current) return;

    let cancelled = false;

    async function initializeOpenMap() {
      try {
        setError(null);
        setStatus("Loading OpenFreeMap");
        const maplibregl = await import("maplibre-gl");
        if (cancelled || !containerRef.current) return;

        containerRef.current.replaceChildren();
        const center = fallbackCenter([], activeCityRef.current);
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: OPENFREEMAP_STYLE_URL,
          center: [center.lng, center.lat],
          zoom: activeCityRef.current ? 11 : 5,
          attributionControl: { compact: true },
        });

        map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
        map.addControl(new maplibregl.ScaleControl(), "bottom-right");
        openMapRef.current = map;
        openPopupRef.current = new maplibregl.Popup({ closeButton: false, offset: 28 });
        map.once("load", () => {
          if (cancelled) return;
          setOpenMapReady(true);
          setStatus("Ready");
        });
      } catch (mapError) {
        if (!cancelled) {
          setError(mapError instanceof Error ? mapError.message : "Failed to initialize OpenFreeMap.");
        }
      }
    }

    void initializeOpenMap();

    return () => {
      cancelled = true;
      openMarkersRef.current.forEach(({ marker }) => marker.remove());
      openMarkersRef.current = new Map();
      openPopupRef.current?.remove();
      openPopupRef.current = null;
      openMapRef.current?.remove();
      openMapRef.current = null;
      setOpenMapReady(false);
    };
  }, [provider]);

  useEffect(() => {
    if (provider !== "openfreemap" || !openMapReady) return;
    const map = openMapRef.current;
    if (!map) return;

    const renderOpenMarkers = async () => {
      const maplibregl = await import("maplibre-gl");
      openMarkersRef.current.forEach(({ marker }) => marker.remove());
      openMarkersRef.current = new Map();

      const points = limitedRecords.map((record, index) => ({ record, point: approximateOpenMapPoint(record, index) }));
      const bounds = new maplibregl.LngLatBounds() as LngLatBounds;

      points.forEach(({ record, point }, index) => {
        bounds.extend([point.lng, point.lat]);
        const element = createMarkerElement(index, record.id === selectedId);
        element.addEventListener("click", () => {
          onSelect(record.id);
          openPopupRef.current?.setDOMContent(infoWindowContent(record)).setLngLat([point.lng, point.lat]).addTo(map);
        });
        const marker = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([point.lng, point.lat]).addTo(map);
        openMarkersRef.current.set(record.id, { marker, point });
      });

      if (points.length) {
        map.fitBounds(bounds, { padding: 72, maxZoom: 15, duration: 400 });
      } else {
        const center = fallbackCenter(limitedRecords, activeCityRef.current);
        map.flyTo({ center: [center.lng, center.lat], zoom: 11, duration: 300 });
      }

      setStatus(`${points.length} mapped`);
    };

    void renderOpenMarkers();
  }, [limitedRecords, onSelect, openMapReady, provider, selectedId]);

  useEffect(() => {
    if (provider !== "amap") return;
    if (configError) {
      return;
    }
    if (!containerRef.current || amapMapRef.current) return;

    let cancelled = false;

    async function initializeAMap() {
      try {
        setError(null);
        setStatus("Loading AMap");
        const AMap = (await loadAMap(amapConfig.jsApiKey, amapConfig.securityJsCode, amapConfig.serviceHost)) as AMapNamespace;
        if (cancelled || !containerRef.current) return;

        containerRef.current.replaceChildren();
        const center = fallbackCenter([], activeCityRef.current);
        const map = new AMap.Map(containerRef.current, {
          center: [center.lng, center.lat],
          zoom: activeCityRef.current ? 11 : 5,
          resizeEnable: true,
          viewMode: "2D",
        });

        amapMapRef.current = map;
        amapRef.current = AMap;
        setStatus("Loading map tools");

        await loadAMapPlugins(AMap, ["AMap.Geocoder", "AMap.ToolBar", "AMap.Scale"]);
        if (cancelled) return;
        map.addControl?.(new AMap.ToolBar({ position: "RT" }));
        map.addControl?.(new AMap.Scale());
        amapInfoWindowRef.current = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30) });
        setAMapReady(true);
        setStatus("Ready");
      } catch (mapError) {
        if (!cancelled) {
          setError(mapError instanceof Error ? mapError.message : "Failed to initialize AMap.");
        }
      }
    }

    void initializeAMap();

    return () => {
      cancelled = true;
      amapMarkersRef.current.forEach((marker) => marker.setMap(null));
      amapMarkersRef.current = new Map();
      amapInfoWindowRef.current = null;
      amapMapRef.current?.destroy?.();
      amapMapRef.current = null;
      amapRef.current = null;
      setAMapReady(false);
    };
  }, [amapConfig.jsApiKey, amapConfig.securityJsCode, amapConfig.serviceHost, configError, provider]);

  useEffect(() => {
    if (provider !== "amap") return;
    const AMap = amapRef.current;
    const map = amapMapRef.current;
    if (!AMap || !map || !amapReady) return;
    const amapNamespace = AMap;
    const mapInstance = map;

    let cancelled = false;

    async function renderAMapMarkers() {
      setStatus("Geocoding addresses");
      amapMarkersRef.current.forEach((marker) => marker.setMap(null));
      amapMarkersRef.current = new Map();

      const points = await Promise.all(
        limitedRecords.map(async (record) => {
          const sharedPoint = sharedMapPoint(record);
          if (sharedPoint) return { record, point: sharedPoint, shared: true };
          const cacheKey = `${record.city}:${record.address || record.name}`;
          if (!amapPointCacheRef.current.has(cacheKey)) {
            amapPointCacheRef.current.set(cacheKey, await geocodeAddress(amapNamespace, record));
          }
          return { record, point: amapPointCacheRef.current.get(cacheKey) || null, shared: false };
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
          amapInfoWindowRef.current?.setContent?.(infoWindowContent(record));
          amapInfoWindowRef.current?.open?.(mapInstance, marker.getPosition?.());
        });
        marker.setMap(mapInstance);
        amapMarkersRef.current.set(record.id, marker);
        fitMarkers.push(marker);
      });

      if (fitMarkers.length) {
        mapInstance.setFitView?.(fitMarkers, false, [72, 72, 72, 72], 16);
      } else {
        const center = fallbackCenter(limitedRecords, activeCityRef.current);
        mapInstance.setCenter?.([center.lng, center.lat]);
      }

      const sharedCount = points.filter(({ point, shared }) => point && shared).length;
      setStatus(sharedCount ? `${fitMarkers.length} mapped · ${sharedCount} cached` : `${fitMarkers.length} mapped`);
    }

    void renderAMapMarkers();

    return () => {
      cancelled = true;
    };
  }, [amapReady, limitedRecords, onSelect, provider, selectedId]);

  useEffect(() => {
    if (provider === "openfreemap") {
      const entry = selectedId ? openMarkersRef.current.get(selectedId) : null;
      openMarkersRef.current.forEach(({ marker }, id) => setMarkerElementActive(marker.getElement(), id === selectedId));
      if (entry && openMapRef.current) {
        openMapRef.current.panTo([entry.point.lng, entry.point.lat], { duration: 300 });
      }
      return;
    }

    const marker = selectedId ? amapMarkersRef.current.get(selectedId) : null;
    const map = amapMapRef.current;
    amapMarkersRef.current.forEach((currentMarker, id) => setAMapMarkerActive(currentMarker, id === selectedId));
    if (!marker || !map) return;
    map.panTo?.(marker.getPosition?.());
  }, [provider, selectedId]);

  return (
    <div className="relative h-full min-h-[420px] bg-slate-100">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
        {visibleError ? <span className="font-medium text-red-700">{visibleError}</span> : <span>{status}</span>}
      </div>
      <button
        type="button"
        onClick={() => setProvider((current) => (current === "openfreemap" ? "amap" : "openfreemap"))}
        className="absolute bottom-3 left-3 rounded-md border bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      >
        {provider === "openfreemap" ? "AMap" : "Open Map"}
      </button>
      <div className="pointer-events-none absolute bottom-3 right-3 max-w-[260px] rounded-md bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-sm">
        {provider === "openfreemap"
          ? "OpenFreeMap uses saved AMap points when available, then station-distance estimates."
          : "AMap uses saved points when available, then geocodes Dianping shop addresses."}
      </div>
    </div>
  );
}

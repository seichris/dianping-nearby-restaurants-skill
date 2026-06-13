"use client";

import { Github, MapPin, Search } from "lucide-react";
import { type CSSProperties, useCallback, useMemo, useRef, useState } from "react";

import RestaurantMap from "@/components/RestaurantMap";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AMapClientConfig } from "@/lib/amapMaps";
import { cn } from "@/lib/utils";
import type { RestaurantDataset, RestaurantRecord } from "@/types/restaurants";

interface RestaurantExplorerProps {
  dataset: RestaurantDataset;
  amapConfig: AMapClientConfig;
}

function formatCurrency(value: number | null): string {
  return value === null ? "—" : `¥${value}`;
}

function formatRating(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function matchesSearch(record: RestaurantRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [
    record.name,
    record.namePinyin,
    record.address,
    record.addressPinyin,
    record.category,
    record.area,
    record.stationName,
    record.rankingBadge,
    ...record.recommendedDishes.slice(0, 6),
    ...record.offers.map((offer) => offer.title),
    ...record.offers.map((offer) => offer.titleEn),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function defaultCity(cities: RestaurantDataset["cities"]): string {
  return cities.some((city) => city.city === "beijing") ? "beijing" : cities[0]?.city || "";
}

export default function RestaurantExplorer({ dataset, amapConfig }: RestaurantExplorerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeCity, setActiveCity] = useState(() => defaultCity(dataset.cities));
  const [stationFilter, setStationFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [leftWidth, setLeftWidth] = useState(52);
  const initialCity = dataset.cities.find((city) => city.city === defaultCity(dataset.cities));
  const [selectedId, setSelectedId] = useState<string | null>(initialCity?.records[0]?.id || null);

  const activeCityGroup = useMemo(
    () => dataset.cities.find((city) => city.city === activeCity) || dataset.cities[0] || null,
    [activeCity, dataset.cities]
  );

  const stationOptions = useMemo(
    () => dataset.stations.filter((station) => station.city === activeCityGroup?.city),
    [activeCityGroup?.city, dataset.stations]
  );

  const filteredRecords = useMemo(
    () =>
      activeCityGroup
        ? activeCityGroup.records.filter(
            (record) => (stationFilter === "all" || record.stationKey === stationFilter) && matchesSearch(record, query)
          )
        : [],
    [activeCityGroup, query, stationFilter]
  );
  const showStationColumn = stationFilter === "all";

  const handleCityChange = useCallback(
    (nextCity: string) => {
      const nextCityGroup = dataset.cities.find((city) => city.city === nextCity);
      setActiveCity(nextCity);
      setStationFilter("all");
      setSelectedId(nextCityGroup?.records[0]?.id || null);
    },
    [dataset.cities]
  );

  const handleStationChange = useCallback(
    (nextStation: string) => {
      setStationFilter(nextStation);
      const nextRecord = activeCityGroup?.records.find((record) => nextStation === "all" || record.stationKey === nextStation);
      setSelectedId(nextRecord?.id || null);
    },
    [activeCityGroup]
  );

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const updateWidth = (clientX: number) => {
      const bounds = container.getBoundingClientRect();
      const next = ((clientX - bounds.left) / bounds.width) * 100;
      setLeftWidth(Math.min(72, Math.max(32, next)));
    };

    updateWidth(event.clientX);

    const handleMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, []);

  return (
    <main className="flex h-dvh min-h-screen flex-col overflow-hidden bg-slate-50 text-slate-950">
      <div className="border-b bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Dianping Nearby Restaurants</h1>
          </div>
          <a
            href="https://github.com/seichris/dianping-nearby-restaurants-skill"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            <Github className="h-4 w-4" />
            <span>Ask claude/codex to add restaurants near you</span>
          </a>
        </div>
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section
          className="flex min-h-0 w-full flex-col border-r bg-white md:w-[var(--left-width)]"
          style={{ "--left-width": `${leftWidth}%` } as CSSProperties}
        >
          <div className="border-b px-4 py-3">
            <div className="grid gap-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search shops, dishes, categories, offers"
                  className="h-10 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <div className="flex flex-nowrap items-center gap-2">
                <label className="relative block w-[10.75rem] shrink-0">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    value={stationFilter}
                    onChange={(event) => handleStationChange(event.target.value)}
                    className="h-10 w-full appearance-none rounded-md border bg-white pl-9 pr-8 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="all">All stations</option>
                    {stationOptions.map((station) => (
                      <option key={station.key} value={station.key}>
                        {station.stationName}
                        {station.lineName ? ` · ${station.lineName}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex shrink-0 flex-nowrap items-center gap-2">
                  {dataset.cities.map((city) => (
                    <button
                      key={city.city}
                      type="button"
                      aria-pressed={city.city === activeCity}
                      onClick={() => handleCityChange(city.city)}
                      className={cn(
                        "h-10 rounded-md border px-2.5 text-sm font-medium transition",
                        city.city === activeCity
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                      )}
                    >
                      {city.cityLabel}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {!activeCityGroup || filteredRecords.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                No restaurants match the current filters.
              </div>
            ) : (
              <div className="space-y-5 p-4">
                <section className="overflow-hidden rounded-lg border bg-white">
                  <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
                    <div>
                      <h2 className="font-semibold">{activeCityGroup.cityLabel}</h2>
                      <p className="text-xs text-slate-500">{filteredRecords.length} shops in current view</p>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[220px]">Shop</TableHead>
                        {showStationColumn ? <TableHead className="min-w-[110px]">Station</TableHead> : null}
                        <TableHead className="w-[84px]">Rating</TableHead>
                        <TableHead className="w-[90px]">Avg</TableHead>
                        <TableHead className="min-w-[260px]">Taocan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRecords.map((record) => (
                        <TableRow
                          key={record.id}
                          data-state={selectedId === record.id ? "selected" : undefined}
                          className="cursor-pointer"
                          onClick={() => setSelectedId(record.id)}
                        >
                          <TableCell>
                            <div className="flex gap-3">
                              {record.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={record.imageUrl}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className="h-14 w-14 shrink-0 rounded-md border object-cover"
                                />
                              ) : null}
                              <div className="min-w-0 space-y-1.5">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {record.shopUrl ? (
                                      <a
                                        href={record.shopUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(event) => event.stopPropagation()}
                                        className="font-medium text-slate-950 underline-offset-4 hover:underline"
                                      >
                                        {record.name}
                                      </a>
                                    ) : (
                                      <span className="font-medium">{record.name}</span>
                                    )}
                                    {record.taocanCount > 0 ? (
                                      <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-700">
                                        {record.taocanCount} taocan
                                      </span>
                                    ) : null}
                                  </div>
                                  {record.namePinyin ? <div className="text-xs text-slate-500">{record.namePinyin}</div> : null}
                                </div>
                                {record.category ? <div className="text-xs text-slate-500">{record.category}</div> : null}
                                {record.address ? <div className="line-clamp-2 text-xs text-slate-500">{record.address}</div> : null}
                                {record.addressPinyin ? (
                                  <div className="line-clamp-2 text-xs text-slate-400">{record.addressPinyin}</div>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          {showStationColumn ? (
                            <TableCell>
                              <div className="text-sm">{record.stationName}</div>
                              <div className="text-xs text-slate-500">
                                {record.distanceMeters ? `${record.distanceMeters}m` : record.lineName}
                              </div>
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <div className={cn("font-medium", record.rating && record.rating >= 4.5 ? "text-emerald-700" : "")}>
                              {formatRating(record.rating)}
                            </div>
                            <div className="text-xs text-slate-500">{record.reviewCount?.toLocaleString() || "—"} reviews</div>
                          </TableCell>
                          <TableCell>{formatCurrency(record.avgPricePerPerson)}</TableCell>
                          <TableCell>
                            {record.offers.some((offer) => offer.type === "taocan") ? (
                              <div className="space-y-2">
                                {record.offers
                                  .filter((offer) => offer.type === "taocan")
                                  .map((offer, offerIndex) => (
                                    <div key={`${record.id}:taocan:${offerIndex}`} className="flex gap-2 text-sm">
                                      {offer.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={offer.imageUrl}
                                          alt=""
                                          loading="lazy"
                                          referrerPolicy="no-referrer"
                                          className="h-12 w-12 shrink-0 rounded-md border object-cover"
                                        />
                                      ) : null}
                                      <div className="min-w-0 space-y-1">
                                        <div>
                                          <div className="font-medium text-slate-900">{offer.title}</div>
                                          {offer.titleEn ? <div className="text-xs text-slate-500">{offer.titleEn}</div> : null}
                                        </div>
                                        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                                          {offer.price === null ? null : (
                                            <span className="font-medium text-slate-900">¥{offer.price}</span>
                                          )}
                                          {offer.originalPrice === null ? null : <span>Was ¥{offer.originalPrice}</span>}
                                          {offer.discount ? <span>{offer.discount}</span> : null}
                                          {offer.validTimeEn || offer.validTime ? (
                                            <span>Valid {offer.validTimeEn || offer.validTime}</span>
                                          ) : null}
                                          {offer.earliestUsableEn || offer.earliestUsable ? (
                                            <span>{offer.earliestUsableEn || offer.earliestUsable}</span>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            ) : (
                              <span className="text-sm text-slate-400">No taocan</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              </div>
            )}
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize table and map panes"
          aria-valuemin={32}
          aria-valuemax={72}
          aria-valuenow={Math.round(leftWidth)}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setLeftWidth((current) => {
              const delta = event.key === "ArrowLeft" ? -4 : 4;
              return Math.min(72, Math.max(32, current + delta));
            });
          }}
          className="hidden w-2 cursor-col-resize touch-none bg-slate-200 transition hover:bg-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 md:block"
        />

        <section className="min-h-[46vh] w-full min-w-0 flex-1 md:min-h-0">
          <RestaurantMap
            records={filteredRecords}
            activeCity={activeCityGroup?.city || activeCity}
            selectedId={selectedId}
            onSelect={setSelectedId}
            amapConfig={amapConfig}
          />
        </section>
      </div>
    </main>
  );
}

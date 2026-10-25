import React, { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MapControlButton,
  MapControlStack,
  applyMarkerState,
  createLiveMarker,
  DRIVER_MARKER_SIZE,
  driverMarkerHtml,
  type LiveMarker,
} from "@sakay/shared";

export interface SharedTripPoint {
  lat: number;
  lng: number;
}

interface SharedTripMapProps {
  language: "tl" | "en";
  pickup: SharedTripPoint | null;
  dropoff: SharedTripPoint | null;
  /** The road between pickup and destination, from the routing service. Null (nothing is drawn) when the service gave no real road geometry. */
  route: [number, number][] | null;
  /** Where the driver is, from the shared-trip answer; null until the database has a position */
  driver: SharedTripPoint | null;
  /** The position is older than a live one: the marker is drawn dimmer */
  driverStale: boolean;
}

const hasPoint = (p: SharedTripPoint | null | undefined): p is SharedTripPoint =>
  Boolean(p) && Number.isFinite(p!.lat) && Number.isFinite(p!.lng) && !(p!.lat === 0 && p!.lng === 0);

const pickupIcon = L.divIcon({
  className: "leaflet-pickup-marker",
  html: `<div style="width:14px;height:14px;background-color:#FFFFFF;border:3px solid #FF6600;border-radius:50%;box-shadow:0 2px 6px rgba(15,23,42,0.25);box-sizing:content-box;"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const dropoffIcon = L.divIcon({
  className: "leaflet-dropoff-marker",
  html: `<div style="width:28px;height:28px;background-color:#EF4444;border:3px solid #FFFFFF;border-radius:50%;box-shadow:0 4px 12px rgba(239,68,68,0.5);display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-size:11px;font-weight:800;">D</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/**
 * The map of the public shared-trip page: the road from the pickup to the destination, the two ends, and the driver's tricycle moving as new positions arrive.
 * Everything drawn comes from the shared-trip answer and the routing service; nothing is invented (no road geometry means no line, no position means no marker).
 * The camera frames the whole trip once; after the viewer drags or zooms it is left alone, and the two round buttons are actions: the top one frames the whole
 * trip again, the bottom one centres on the driver and keeps the driver in view as the tricycle moves.
 */
const SharedTripMap: React.FC<SharedTripMapProps> = ({ language, pickup, dropoff, route, driver, driverStale }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const pinsLayerRef = useRef<L.LayerGroup | null>(null);
  const driverMarkerRef = useRef<LiveMarker | null>(null);
  const driverElementRef = useRef<L.Marker | null>(null);
  const followRef = useRef(false);
  const framedKeyRef = useRef<string | null>(null);
  const latest = useRef({ pickup, dropoff, route, driver });
  latest.current = { pickup, dropoff, route, driver };

  const tripPoints = (): L.LatLngTuple[] => {
    const pts: L.LatLngTuple[] = [];
    const { pickup: pk, dropoff: dr, route: rt, driver: me } = latest.current;
    if (rt) rt.forEach(([lat, lng]) => pts.push([lat, lng]));
    if (hasPoint(pk)) pts.push([pk.lat, pk.lng]);
    if (hasPoint(dr)) pts.push([dr.lat, dr.lng]);
    if (hasPoint(me)) pts.push([me.lat, me.lng]);
    return pts;
  };

  const fitTrip = () => {
    const map = mapRef.current;
    const pts = tripPoints();
    if (!map || pts.length === 0) return;
    followRef.current = false;
    map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16, animate: true });
  };

  const centerOnDriver = () => {
    const map = mapRef.current;
    const me = latest.current.driver;
    if (!map || !hasPoint(me)) return;
    followRef.current = true;
    map.setView([me.lat, me.lng], Math.max(map.getZoom(), 16), { animate: true });
  };

  // The map itself: made once, removed on unmount
  useEffect(() => {
    if (!containerRef.current) return undefined;
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false, center: [13.4117, 121.1803], zoom: 13 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: ["a", "b", "c"] }).addTo(map);
    L.control.attribution({ prefix: false }).addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>').addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    pinsLayerRef.current = L.layerGroup().addTo(map);
    const liveLayer = L.layerGroup().addTo(map);
    driverMarkerRef.current = createLiveMarker<L.Marker>({
      create: (p) => {
        const marker = L.marker([p.lat, p.lng], {
          interactive: false,
          zIndexOffset: 1000,
          icon: L.divIcon({
            className: "leaflet-driver-marker",
            html: driverMarkerHtml(),
            iconSize: [DRIVER_MARKER_SIZE, DRIVER_MARKER_SIZE],
            iconAnchor: [DRIVER_MARKER_SIZE / 2, DRIVER_MARKER_SIZE / 2],
          }),
        }).addTo(liveLayer);
        driverElementRef.current = marker;
        return marker;
      },
    });
    // a viewer who drags or zooms takes the camera: it does not follow the driver until the bottom button is pressed
    map.on("dragstart", () => {
      followRef.current = false;
    });
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      driverMarkerRef.current?.destroy();
      driverMarkerRef.current = null;
      driverElementRef.current = null;
      routeLayerRef.current = null;
      pinsLayerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // The two ends and the road between them; the camera frames the whole trip once per trip
  useEffect(() => {
    const map = mapRef.current;
    const pins = pinsLayerRef.current;
    const road = routeLayerRef.current;
    if (!map || !pins || !road) return;
    pins.clearLayers();
    road.clearLayers();
    if (hasPoint(pickup)) L.marker([pickup.lat, pickup.lng], { icon: pickupIcon, interactive: false }).addTo(pins);
    if (hasPoint(dropoff)) L.marker([dropoff.lat, dropoff.lng], { icon: dropoffIcon, interactive: false, zIndexOffset: 500 }).addTo(pins);
    if (route && route.length >= 2) {
      L.polyline(route, { color: "#FFFFFF", weight: 9, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(road);
      L.polyline(route, { color: "#FF6600", weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(road);
    }
    const key = `${pickup?.lat},${pickup?.lng}|${dropoff?.lat},${dropoff?.lng}|${route ? route.length : 0}`;
    if (framedKeyRef.current !== key && tripPoints().length > 0) {
      framedKeyRef.current = key;
      map.fitBounds(L.latLngBounds(tripPoints()), { padding: [48, 48], maxZoom: 16, animate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, route]);

  // The driver: the marker is made at the first position and glides to each newer one; while the viewer follows it, it is kept in view
  useEffect(() => {
    const controller = driverMarkerRef.current;
    const map = mapRef.current;
    if (!controller || !map) return;
    controller.update(hasPoint(driver) ? { lat: driver.lat, lng: driver.lng, at: Date.now() } : null);
    if (hasPoint(driver) && followRef.current) {
      const here = L.latLng(driver.lat, driver.lng);
      if (!map.getBounds().pad(-0.25).contains(here)) map.panTo(here, { animate: true });
    }
  }, [driver?.lat, driver?.lng]);

  // A position that has stopped refreshing is drawn dimmer, so nobody takes it for live
  useEffect(() => {
    applyMarkerState(driverElementRef.current?.getElement(), { stale: driverStale });
  }, [driverStale, driver?.lat, driver?.lng]);

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100%", minHeight: 240, overflow: "hidden", backgroundColor: "#E2E8F0" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <MapControlStack bottom={28} label={language === "tl" ? "Mga kontrol ng mapa" : "Map controls"}>
        <MapControlButton
          icon="route"
          label={language === "tl" ? "Ipakita ang buong ruta" : "Show the whole trip"}
          unavailableReason={tripPointsAvailable(pickup, dropoff, route, driver) ? undefined : language === "tl" ? "Wala pang ruta." : "There is no trip to show yet."}
          onClick={fitTrip}
        />
        <MapControlButton
          icon="my-location"
          label={language === "tl" ? "Sundan ang drayber" : "Follow the driver"}
          unavailableReason={hasPoint(driver) ? undefined : language === "tl" ? "Wala pang lokasyon ng drayber." : "There is no driver position yet."}
          onClick={centerOnDriver}
        />
      </MapControlStack>
    </Box>
  );
};

const tripPointsAvailable = (pickup: SharedTripPoint | null, dropoff: SharedTripPoint | null, route: [number, number][] | null, driver: SharedTripPoint | null): boolean =>
  hasPoint(pickup) || hasPoint(dropoff) || Boolean(route && route.length) || hasPoint(driver);

export default SharedTripMap;

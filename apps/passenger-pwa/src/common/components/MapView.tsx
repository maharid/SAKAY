import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Box from "@mui/material/Box";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  applyMarkerState,
  continuousRotation,
  createLiveMarker,
  createMapCamera,
  DRIVER_MARKER_SIZE,
  driverMarkerHtml,
  passengerMarkerHtml,
  PASSENGER_MARKER_SIZE,
  resolveHeading,
  tweenRadius,
  type CameraMap,
  type CameraMode,
  type GeoPoint,
  type GlideFix,
  type LiveMarker,
  type MapCamera,
  type MapInsets,
} from "@sakay/shared";
import { DEFAULT_CALAPAN_CENTER, getOSRMRoute } from "../../services/locationService";

export type { CameraMode };

export interface MapViewProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  /** The person's own position, and the driver's: drawn as markers that glide between fixes (`at` = when the sender took the fix, to drop reordered ones) */
  userLocation?: GlideFix | null;
  pickupLocation?: { lat: number; lng: number } | null;
  dropoffLocation?: { lat: number; lng: number } | null;
  driverLocation?: GlideFix | null;
  routeCoordinates?: [number, number][];
  recenterTrigger?: number;
  height?: string;
  width?: string;
  interactive?: boolean;
  onCenterChange?: (center: { lat: number; lng: number }) => void;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  /** What covers the map (a bottom sheet, a header), in pixels: the camera frames and centres inside what is left, not behind it */
  insets?: Partial<MapInsets>;
  /** The area the database is searching for a driver, in metres, drawn around the pickup. Nothing is drawn without a real radius. */
  searchRadiusMeters?: number | null;
  /** What the trip is doing now (its stage): a change re-frames the map, unless the person is exploring it */
  stageKey?: string;
  /** Show the person's own (blue) marker even while a route is drawn: the trip screens */
  showUserMarker?: boolean;
  /** A position that has not been refreshed lately is drawn dimmer */
  userStale?: boolean;
  driverStale?: boolean;
  /** Told when the camera starts or stops following someone, so a control can show that it is "on" */
  onCameraModeChange?: (mode: CameraMode) => void;
}

/** What a screen can ask the map to do (from its own buttons). Each returns false when it could not (no such position yet). */
export interface MapViewHandle {
  centerOnUser: () => boolean;
  centerOnDriver: () => boolean;
  fitRoute: () => boolean;
  fitSearchArea: () => boolean;
}

const hasPoint = (p: { lat: number; lng: number } | null | undefined): p is { lat: number; lng: number } =>
  Boolean(p) && Number.isFinite(p!.lat) && Number.isFinite(p!.lng) && !(p!.lat === 0 && p!.lng === 0);

/** The four extremes of a circle on the map (and its centre), for fitting the camera to it */
function circleExtent(center: GeoPoint, radiusMeters: number): GeoPoint[] {
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return [
    { lat: center.lat + dLat, lng: center.lng },
    { lat: center.lat - dLat, lng: center.lng },
    { lat: center.lat, lng: center.lng + dLng },
    { lat: center.lat, lng: center.lng - dLng },
  ];
}

const reducedMotion = (): boolean => {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * MapView - Leaflet OpenStreetMap Map Component (matching LGU & TODA portals)
 * Road-based route, the two live markers (passenger: blue person; driver: orange tricycle with a direction arrow), the driver-search area,
 * and a camera that works from the part of the map that is actually visible.
 */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    center = { lat: DEFAULT_CALAPAN_CENTER.latitude, lng: DEFAULT_CALAPAN_CENTER.longitude },
    zoom = 15,
    userLocation,
    pickupLocation,
    dropoffLocation,
    driverLocation,
    routeCoordinates,
    recenterTrigger = 0,
    height = "100%",
    width = "100%",
    interactive = true,
    onCenterChange,
    onMapClick,
    insets,
    searchRadiusMeters,
    stageKey,
    showUserMarker = false,
    userStale = false,
    driverStale = false,
    onCameraModeChange,
  },
  ref
) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const cameraRef = useRef<MapCamera | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayersRef = useRef<L.LayerGroup | null>(null);
  const onCenterChangeRef = useRef(onCenterChange);
  onCenterChangeRef.current = onCenterChange;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onModeRef = useRef(onCameraModeChange);
  onModeRef.current = onCameraModeChange;
  const [roadCoords, setRoadCoords] = useState<[number, number][]>(routeCoordinates || []);
  const lastFetchRef = useRef<{ startLat: number; startLng: number; endLat: number; endLng: number } | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const lastUserInputRef = useRef<number>(-Infinity); // no touch yet (0 would count the first 1.2 s after the page loaded as one)
  const insetsRef = useRef<Partial<MapInsets> | undefined>(insets);
  insetsRef.current = insets;
  // The live markers (the person and the driver) live in their own layer: the pins and the route are redrawn when they change, these are not.
  const liveLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<LiveMarker | null>(null);
  const driverMarkerRef = useRef<LiveMarker | null>(null);
  const userElementRef = useRef<L.Marker | null>(null);
  const driverElementRef = useRef<L.Marker | null>(null);
  // The driver's arrow: where the vehicle was, which way it was last known to point, and the angle currently drawn
  const driverPrevRef = useRef<GeoPoint | null>(null);
  const driverHeadingRef = useRef<number | null>(null);
  const driverRotationRef = useRef<number | null>(null);
  // The search circle and the radius it currently shows (it grows to a new radius, it does not jump)
  const searchLayerRef = useRef<L.Circle | null>(null);
  const searchShownRef = useRef<number | null>(null);
  const searchFrameRef = useRef<number | null>(null);
  // What the latest props say, for the handle and the camera's callbacks
  const latest = useRef({ userLocation, driverLocation, pickupLocation, dropoffLocation, searchRadiusMeters, showUserMarker });
  latest.current = { userLocation, driverLocation, pickupLocation, dropoffLocation, searchRadiusMeters, showUserMarker };
  const routePointsRef = useRef<[number, number][]>([]);

  /** The points that make "the whole trip": the route and the pins the trip is about */
  const tripPoints = (): GeoPoint[] => {
    const pts: GeoPoint[] = routePointsRef.current.map(([lat, lng]) => ({ lat, lng }));
    const { pickupLocation: pk, dropoffLocation: dr, driverLocation: dv } = latest.current;
    if (hasPoint(pk)) pts.push(pk);
    if (hasPoint(dr)) pts.push(dr);
    if (hasPoint(dv)) pts.push(dv);
    return pts;
  };

  useImperativeHandle(
    ref,
    () => ({
      centerOnUser: () => {
        const u = latest.current.userLocation;
        return hasPoint(u) ? Boolean(cameraRef.current?.centerOn(u, { explicit: true, follow: "user" })) : false;
      },
      centerOnDriver: () => {
        const d = latest.current.driverLocation;
        return hasPoint(d) ? Boolean(cameraRef.current?.centerOn(d, { explicit: true, follow: "driver" })) : false;
      },
      fitRoute: () => {
        // The road route when there is one; without it (offline, the routing service is down) the pins and the driver are still framed
        const pts = tripPoints();
        if (pts.length < 2) return false;
        return Boolean(cameraRef.current?.fit({ points: pts, explicit: true, kind: "route" }));
      },
      fitSearchArea: () => {
        const { pickupLocation: pk, searchRadiusMeters: r } = latest.current;
        if (!hasPoint(pk) || !r) return false;
        return Boolean(cameraRef.current?.fit({ points: [pk, ...circleExtent(pk, r)], explicit: true, kind: "search", maxZoom: 17 }));
      },
    }),
    []
  );

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Remove existing instance if any
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const targetCenter = (pickupLocation && pickupLocation.lat !== 0)
      ? pickupLocation
      : (center && center.lat !== 0)
      ? center
      : { lat: DEFAULT_CALAPAN_CENTER.latitude, lng: DEFAULT_CALAPAN_CENTER.longitude };

    // Create Map
    const map = L.map(mapContainerRef.current, {
      center: [targetCenter.lat, targetCenter.lng],
      zoom: zoom,
      zoomControl: false,
      attributionControl: false,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      scrollWheelZoom: interactive,
      boxZoom: false,
      keyboard: false,
      fadeAnimation: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
      easeLinearity: 0.25,
    });

    // OpenStreetMap Tile Layer (Clean & fast)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      subdomains: ["a", "b", "c"],
    }).addTo(map);

    // The search area sits BELOW the route line and every marker, and never takes a tap
    const searchPane = map.createPane("searchRadiusPane");
    searchPane.style.zIndex = "350";
    searchPane.style.pointerEvents = "none";

    // Create a LayerGroup for markers
    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;

    // Create a LayerGroup for route polylines
    const routeLayers = L.layerGroup().addTo(map);
    routeLayersRef.current = routeLayers;

    // Live markers: made once, then moved (never rebuilt)
    const liveLayer = L.layerGroup().addTo(map);
    liveLayerRef.current = liveLayer;
    userMarkerRef.current = createLiveMarker<L.Marker>({
      create: (p) => {
        const marker = L.marker([p.lat, p.lng], {
          interactive: false,
          zIndexOffset: 900,
          icon: L.divIcon({
            className: "leaflet-user-marker",
            html: passengerMarkerHtml(),
            iconSize: [PASSENGER_MARKER_SIZE, PASSENGER_MARKER_SIZE],
            iconAnchor: [PASSENGER_MARKER_SIZE / 2, PASSENGER_MARKER_SIZE / 2],
          }),
        }).addTo(liveLayer);
        userElementRef.current = marker;
        return marker;
      },
    });
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

    mapInstanceRef.current = map;

    // The camera: framing and following that work from the visible area (see packages/shared/src/utils/mapCamera.ts)
    const camera = createMapCamera(map as unknown as CameraMap, {
      followZoom: 16,
      onModeChange: (m) => onModeRef.current?.(m),
      autoFollow: () => {
        const l = latest.current;
        if (hasPoint(l.driverLocation)) return "driver";
        // nothing else on the map: the person's own dot is what the map follows
        return hasPoint(l.userLocation) && !hasPoint(l.pickupLocation) && routePointsRef.current.length < 2 ? "user" : null;
      },
    });
    cameraRef.current = camera;
    camera.setInsets(insetsRef.current ?? {});

    // Only a person's own drag / pinch / wheel hands the map over to them. (Leaflet's `zoomstart` also fires for the camera's own zooms, so
    // a recent touch, click or wheel is what tells the two apart.)
    const container = map.getContainer();
    const markInput = () => {
      lastUserInputRef.current = performance.now();
    };
    container.addEventListener("pointerdown", markInput, { passive: true });
    container.addEventListener("touchstart", markInput, { passive: true });
    container.addEventListener("wheel", markInput, { passive: true });
    map.on("dragstart", () => camera.userMoved());
    map.on("zoomstart", () => {
      if (performance.now() - lastUserInputRef.current < 1200) camera.userMoved();
    });

    // Report map center changes when movement completes or pauses for silky smooth dragging
    const handleMoveEnd = () => {
      if (mapInstanceRef.current && onCenterChangeRef.current) {
        const c = mapInstanceRef.current.getCenter();
        onCenterChangeRef.current({ lat: c.lat, lng: c.lng });
      }
    };

    // The location pickers: a tap moves the pin to the tapped place. A map nobody asked to listen to does not move when tapped.
    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!onCenterChangeRef.current && !onMapClickRef.current) return;
      camera.userMoved();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo([e.latlng.lat, e.latlng.lng], { animate: !reducedMotion() });
        if (onCenterChangeRef.current) {
          onCenterChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
        if (onMapClickRef.current) {
          onMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      }
    };

    map.on("moveend", handleMoveEnd);
    map.on("click", handleMapClick);

    // The container's size changed (rotation, window, the keyboard): the map re-measures itself and keeps what was framed in view
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => camera.resized());
      resizeObserver.observe(container);
    }

    // Invalidate size after container settles
    const resizeTimer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 250);

    return () => {
      clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      container.removeEventListener("pointerdown", markInput);
      container.removeEventListener("touchstart", markInput);
      container.removeEventListener("wheel", markInput);
      camera.destroy();
      cameraRef.current = null;
      if (searchFrameRef.current !== null) cancelAnimationFrame(searchFrameRef.current);
      searchFrameRef.current = null;
      searchLayerRef.current = null;
      searchShownRef.current = null;
      // Stop the glide frames before the map goes away (nothing may draw on a removed map)
      userMarkerRef.current?.destroy();
      driverMarkerRef.current?.destroy();
      userMarkerRef.current = null;
      driverMarkerRef.current = null;
      userElementRef.current = null;
      driverElementRef.current = null;
      liveLayerRef.current = null;
      if (markersLayerRef.current) {
        markersLayerRef.current.clearLayers();
        markersLayerRef.current = null;
      }
      if (routeLayersRef.current) {
        routeLayersRef.current.clearLayers();
        routeLayersRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [interactive]);

  // What covers the map changed (a sheet opened or closed, a panel appeared): the camera re-frames inside what is left
  useEffect(() => {
    cameraRef.current?.setInsets(insets ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets?.top, insets?.right, insets?.bottom, insets?.left]);

  // The trip moved to another stage
  useEffect(() => {
    if (stageKey === undefined) return;
    cameraRef.current?.stageChanged(stageKey);
  }, [stageKey]);

  // The driver's tricycle: made at the first fix, then it glides to each newer one. The fixes themselves are not changed.
  // The dependencies are the position's numbers, not the object: a parent that rebuilds the object every render must not restart the glide.
  useEffect(() => {
    const controller = driverMarkerRef.current;
    if (!controller) return;
    const result = controller.update(driverLocation ?? null);
    if (!driverLocation) {
      driverElementRef.current = null;
      driverPrevRef.current = null;
      driverHeadingRef.current = null;
      driverRotationRef.current = null;
      return;
    }
    // Which way it points: the device's own heading, else the direction it actually moved, else the last known one; none when unknown
    if (result && result.status !== "ignored") {
      const heading = resolveHeading({
        reported: driverLocation.heading,
        speedMps: driverLocation.speed,
        previous: driverPrevRef.current,
        current: driverLocation,
        lastHeading: driverHeadingRef.current,
      });
      driverPrevRef.current = { lat: driverLocation.lat, lng: driverLocation.lng };
      driverHeadingRef.current = heading.heading;
      if (heading.heading === null) {
        driverRotationRef.current = null;
        applyMarkerState(driverElementRef.current?.getElement(), { rotation: null });
      } else {
        driverRotationRef.current = continuousRotation(driverRotationRef.current, heading.heading);
        applyMarkerState(driverElementRef.current?.getElement(), { rotation: driverRotationRef.current });
      }
    }
    cameraRef.current?.followMarker("driver", driverLocation, result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocation?.lat, driverLocation?.lng, driverLocation?.at, driverLocation?.heading, interactive]);

  // The person's own position (shown while there is not yet both a pickup and a destination, or always on the trip screens)
  const showUserDot = Boolean(userLocation) && (showUserMarker || !pickupLocation || !dropoffLocation);
  useEffect(() => {
    const controller = userMarkerRef.current;
    if (!controller) return;
    const result = controller.update(showUserDot && userLocation ? userLocation : null);
    if (!showUserDot) userElementRef.current = null;
    if (showUserDot && userLocation) cameraRef.current?.followMarker("user", userLocation, result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation?.lat, userLocation?.lng, userLocation?.at, showUserDot, interactive]);

  // A position that has stopped refreshing is drawn dimmer, so nobody takes it for live
  useEffect(() => {
    applyMarkerState(driverElementRef.current?.getElement(), { stale: driverStale });
    applyMarkerState(userElementRef.current?.getElement(), { stale: userStale });
  }, [driverStale, userStale, driverLocation?.lat, driverLocation?.lng, userLocation?.lat, userLocation?.lng, showUserDot]);

  // Synchronize roadCoordinates prop or fetch road coordinates via OSRM
  useEffect(() => {
    if (routeCoordinates && routeCoordinates.length >= 2) {
      setRoadCoords(routeCoordinates);
      return;
    }

    let startPoint: { lat: number; lng: number } | null = null;
    let endPoint: { lat: number; lng: number } | null = null;

    if (dropoffLocation && dropoffLocation.lat !== 0) {
      // Ongoing trip: route from driver to destination (or pickup if driver not ready)
      startPoint = driverLocation && driverLocation.lat !== 0 ? driverLocation : (pickupLocation && pickupLocation.lat !== 0 ? pickupLocation : userLocation ?? null);
      endPoint = dropoffLocation;
    } else if (pickupLocation && pickupLocation.lat !== 0 && driverLocation && driverLocation.lat !== 0) {
      // Pre-trip: driver heading to passenger pickup point
      startPoint = driverLocation;
      endPoint = pickupLocation;
    } else if (pickupLocation && pickupLocation.lat !== 0 && dropoffLocation && dropoffLocation.lat !== 0) {
      startPoint = pickupLocation;
      endPoint = dropoffLocation;
    }

    if (startPoint && startPoint.lat !== 0 && endPoint && endPoint.lat !== 0) {
      const now = Date.now();
      // Allow dynamic rerouting if driver moved > 35m or destination changed, throttled to 7s
      if (lastFetchRef.current) {
        const dEndLat = Math.abs(lastFetchRef.current.endLat - endPoint.lat);
        const dEndLng = Math.abs(lastFetchRef.current.endLng - endPoint.lng);
        const dStartLat = Math.abs(lastFetchRef.current.startLat - startPoint.lat);
        const dStartLng = Math.abs(lastFetchRef.current.startLng - startPoint.lng);

        const movedSignificantly = dStartLat > 0.00035 || dStartLng > 0.00035;
        const endChanged = dEndLat > 0.0005 || dEndLng > 0.0005;
        const timePassed = now - lastFetchTimeRef.current > 7000;

        if (!endChanged && (!movedSignificantly || !timePassed) && roadCoords.length > 0) {
          return;
        }
      }

      let isMounted = true;
      lastFetchTimeRef.current = now;
      lastFetchRef.current = {
        startLat: startPoint.lat,
        startLng: startPoint.lng,
        endLat: endPoint.lat,
        endLng: endPoint.lng,
      };

      getOSRMRoute(startPoint.lat, startPoint.lng, endPoint.lat, endPoint.lng)
        .then((result) => {
          if (isMounted && result.coordinates && result.coordinates.length >= 2) {
            setRoadCoords(result.coordinates);
          }
        })
        .catch((err) => {
          console.warn("[MapView] Road routing error:", err);
        });

      return () => {
        isMounted = false;
      };
    } else {
      setRoadCoords([]);
      lastFetchRef.current = null;
    }
  }, [
    pickupLocation?.lat,
    pickupLocation?.lng,
    dropoffLocation?.lat,
    dropoffLocation?.lng,
    driverLocation?.lat,
    driverLocation?.lng,
    userLocation?.lat,
    userLocation?.lng,
    routeCoordinates,
  ]);

  // The pins and the road route. The camera fits the whole trip into the VISIBLE area once per destination (and again when the stage changes).
  const searchActive = Boolean(searchRadiusMeters) && hasPoint(pickupLocation);
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    const routeLayers = routeLayersRef.current;
    if (!map || !markersLayer || !routeLayers) return;

    markersLayer.clearLayers();
    routeLayers.clearLayers();

    // (The person's position and the driver's tricycle are live markers, moved by their own effects above.)

    // 2. Pickup Marker: Google Maps Style Glowing & Moving Circle
    if (pickupLocation && pickupLocation.lat !== 0) {
      const pickupIcon = L.divIcon({
        className: "leaflet-pickup-marker",
        html: `
          <div class="leaflet-gmaps-pickup-container">
            <div class="gmaps-pickup-radar-wave"></div>
            <div class="gmaps-pickup-radar-wave wave-delayed"></div>
            <div class="gmaps-pickup-aura"></div>
            <div class="gmaps-pickup-core-dot"></div>
          </div>
        `,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      });

      L.marker([pickupLocation.lat, pickupLocation.lng], { icon: pickupIcon }).addTo(markersLayer);
    }

    // 3. Dropoff Marker: Google Maps Style Red Location Pin
    if (dropoffLocation && dropoffLocation.lat !== 0) {
      const dropoffIcon = L.divIcon({
        className: "leaflet-destination-marker",
        html: `
          <div style="
            position: relative;
            width: 32px;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.38));
            cursor: pointer;
          ">
            <svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M16 0C7.16344 0 0 7.16344 0 16C0 27.2 14.5 40.5 15.36 41.28C15.73 41.62 16.27 41.62 16.64 41.28C17.5 40.5 32 27.2 32 16C32 7.16344 24.8366 0 16 0Z"
                fill="#EA4335"
              />
              <circle cx="16" cy="16" r="6.2" fill="#FFFFFF" />
              <circle cx="16" cy="16" r="3" fill="#C5221F" />
            </svg>
          </div>
        `,
        iconSize: [32, 42],
        iconAnchor: [16, 42],
      });

      L.marker([dropoffLocation.lat, dropoffLocation.lng], { icon: dropoffIcon }).addTo(markersLayer);
    }

    // 5. Draw Road-Based Route Polyline (Google Maps style) & Fit Bounds (No straight-line fallback)
    const activeRoutePoints: [number, number][] =
      roadCoords && roadCoords.length >= 2
        ? roadCoords
        : routeCoordinates && routeCoordinates.length >= 2
        ? routeCoordinates
        : [];

    routePointsRef.current = activeRoutePoints;

    if (activeRoutePoints.length >= 2) {
      // 5a. Bottom casing: clean white glow border providing crisp road separation
      const routeCasing = L.polyline(activeRoutePoints, {
        color: "#FFFFFF",
        weight: 9,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      });

      // 5b. Main road route line: solid vibrant orange matching SAKAY and BOOK - SOLO.png
      const routeLine = L.polyline(activeRoutePoints, {
        color: "#FF6600",
        weight: 6,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      });

      routeLayers.addLayer(routeCasing);
      routeLayers.addLayer(routeLine);

      // Fit the whole road journey into the visible area ONLY ONCE when the route first loads or the destination changes. While a driver
      // search is running the search area is what is framed instead.
      if (!searchActive) {
        const last = activeRoutePoints[activeRoutePoints.length - 1];
        cameraRef.current?.fit({ points: tripPoints(), key: `route:${last[0]}_${last[1]}`, kind: "route" });
      }
    } else if (!(driverLocation && driverLocation.lat !== 0) && pickupLocation && pickupLocation.lat !== 0 && !searchActive) {
      // No route to frame: the driver, then the pickup, then the person, as before. The live markers follow themselves; the pickup is centred here.
      if (cameraRef.current && cameraRef.current.mode() !== "free") {
        cameraRef.current.centerOn(pickupLocation, { minZoom: 0 });
      }
    }
    // The pins and the route are redrawn only when they change (the live markers have their own effects), so the dependencies are their numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupLocation?.lat, pickupLocation?.lng, dropoffLocation?.lat, dropoffLocation?.lng, roadCoords, routeCoordinates, searchActive, stageKey]);

  // The driver-search area: a dashed light-orange circle around the pickup, at the radius the DATABASE reports. When the search widens the
  // circle grows to the new radius over a moment (or at once for a person who prefers reduced motion), and the camera frames it.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const stopTween = () => {
      if (searchFrameRef.current !== null) cancelAnimationFrame(searchFrameRef.current);
      searchFrameRef.current = null;
    };
    if (!searchRadiusMeters || !hasPoint(pickupLocation)) {
      stopTween();
      if (searchLayerRef.current) {
        searchLayerRef.current.remove();
        searchLayerRef.current = null;
      }
      searchShownRef.current = null;
      return;
    }
    const target = searchRadiusMeters;
    const centerLatLng: [number, number] = [pickupLocation.lat, pickupLocation.lng];
    if (!searchLayerRef.current) {
      searchLayerRef.current = L.circle(centerLatLng, {
        pane: "searchRadiusPane",
        radius: target,
        color: "#FB923C",
        weight: 1.75,
        opacity: 0.9,
        dashArray: "6 8",
        fillColor: "#FDBA74",
        fillOpacity: 0.1,
        interactive: false,
        className: "sakay-search-radius",
      }).addTo(map);
      searchShownRef.current = target;
    } else {
      searchLayerRef.current.setLatLng(centerLatLng);
      const from = searchShownRef.current ?? target;
      stopTween();
      if (reducedMotion() || from === target) {
        searchLayerRef.current.setRadius(target);
        searchShownRef.current = target;
      } else {
        const started = performance.now();
        const DURATION_MS = 700;
        const step = (now: number) => {
          const layer = searchLayerRef.current;
          if (!layer) return;
          const progress = (now - started) / DURATION_MS;
          const radius = tweenRadius(from, target, progress);
          layer.setRadius(radius);
          searchShownRef.current = radius;
          searchFrameRef.current = progress < 1 ? requestAnimationFrame(step) : null;
        };
        searchFrameRef.current = requestAnimationFrame(step);
      }
    }
    // Frame the whole search area inside the visible map, once per radius (a widening search re-frames once, never in a loop)
    cameraRef.current?.fit({ points: [pickupLocation, ...circleExtent(pickupLocation, target)], key: `search:${target}`, kind: "search", maxZoom: 17 });
    return stopTween;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRadiusMeters, pickupLocation?.lat, pickupLocation?.lng, interactive]);

  // Recenter trigger listener (an explicit press elsewhere on the screen): takes the camera back, then frames the route, or centres on the
  // driver, the pickup or the person, whichever there is, inside the visible area
  const seenRecenterRef = useRef(recenterTrigger);
  useEffect(() => {
    // Only a CHANGE of the trigger is a press (mounting, and React re-running the effect in development, are not)
    if (seenRecenterRef.current === recenterTrigger) return;
    seenRecenterRef.current = recenterTrigger;
    const camera = cameraRef.current;
    if (!camera) return;
    camera.release();
    if (routePointsRef.current.length >= 2) {
      camera.fit({ points: tripPoints(), explicit: true, kind: "route" });
    } else if (hasPoint(driverLocation)) {
      camera.centerOn(driverLocation, { explicit: true, follow: "driver", minZoom: zoom });
    } else if (hasPoint(pickupLocation)) {
      camera.centerOn(pickupLocation, { minZoom: zoom });
    } else if (hasPoint(userLocation)) {
      camera.centerOn(userLocation, { explicit: true, follow: "user", minZoom: zoom });
    } else if (center) {
      camera.centerOn(center, { minZoom: zoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTrigger]);

  return (
    <Box
      sx={{
        width: width,
        height: height,
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1,
        overflow: "hidden",
        backgroundColor: "#E2E8F0",
      }}
    >
      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
    </Box>
  );
});

export default MapView;

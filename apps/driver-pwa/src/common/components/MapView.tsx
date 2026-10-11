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
  getOSRMRoute,
  passengerMarkerHtml,
  PASSENGER_MARKER_SIZE,
  resolveHeading,
  type CameraMap,
  type CameraMode,
  type GeoPoint,
  type GlideFix,
  type LiveMarker,
  type MapCamera,
  type MapInsets,
} from "@sakay/shared";

export type { CameraMode };

export const DEFAULT_CALAPAN_CENTER = {
  latitude: 13.4117,
  longitude: 121.1803,
};

/** While the vehicle is moving at least this fast (m/s, about 7 km/h) the map is brought in close enough to drive by (see `closeUpWhileMoving`) */
const MOVING_MIN_SPEED_MPS = 2;
const DRIVING_ZOOM = 16;

export interface MapViewProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  /** The driver's own position: drawn as the orange tricycle marker that glides between fixes (`at` = when the fix was taken, to drop reordered ones). `heading` / `speed` are what the phone reported. */
  userLocation?: GlideFix | null;
  pickupLocation?: { lat: number; lng: number } | null;
  dropoffLocation?: { lat: number; lng: number } | null;
  routeCoordinates?: [number, number][];
  recenterTrigger?: number;
  height?: string;
  width?: string;
  interactive?: boolean;
  /** What covers the map (a top panel, a bottom sheet), in pixels: the camera frames and centres inside what is left, not behind it */
  insets?: Partial<MapInsets>;
  /** What the trip is doing now (its stage): a change re-frames the map, unless the driver is exploring it */
  stageKey?: string;
  /** The driver's own position has stopped refreshing: the marker is drawn dimmer */
  userStale?: boolean;
  /** While the vehicle is moving, bring the map in close and keep the driver centred (a driver who drags or zooms the map is left alone). Trip screens only. */
  closeUpWhileMoving?: boolean;
  /** Told when the camera starts or stops following the driver, so a control can show that it is "on" */
  onCameraModeChange?: (mode: CameraMode) => void;
}

/** What a screen can ask the map to do (from its own buttons). Each returns false when it could not (no such position yet). */
export interface MapViewHandle {
  centerOnDriver: () => boolean;
  fitRoute: () => boolean;
}

const hasPoint = (p: { lat: number; lng: number } | null | undefined): p is { lat: number; lng: number } =>
  Boolean(p) && Number.isFinite(p!.lat) && Number.isFinite(p!.lng) && !(p!.lat === 0 && p!.lng === 0);

/**
 * MapView - Leaflet OpenStreetMap Map Component (Driver PWA)
 * Road-based route from the OSRM road network, the driver's own marker (orange tricycle with a direction arrow once a heading is known),
 * the passenger at the pickup (blue person, the same marker the passenger sees for themselves), and a camera that works from the part of
 * the map that is actually visible.
 */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    center = { lat: DEFAULT_CALAPAN_CENTER.latitude, lng: DEFAULT_CALAPAN_CENTER.longitude },
    zoom = 15,
    userLocation,
    pickupLocation,
    dropoffLocation,
    routeCoordinates,
    recenterTrigger = 0,
    height = "100%",
    width = "100%",
    interactive = true,
    insets,
    stageKey,
    userStale = false,
    closeUpWhileMoving = false,
    onCameraModeChange,
  },
  ref
) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const cameraRef = useRef<MapCamera | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayersRef = useRef<L.LayerGroup | null>(null);
  const [roadCoords, setRoadCoords] = useState<[number, number][]>(routeCoordinates || []);
  const lastFetchRef = useRef<{ startLat: number; startLng: number; endLat: number; endLng: number } | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const lastUserInputRef = useRef<number>(-Infinity); // no touch yet (0 would count the first 1.2 s after the page loaded as one)
  const onModeRef = useRef(onCameraModeChange);
  onModeRef.current = onCameraModeChange;
  const insetsRef = useRef<Partial<MapInsets> | undefined>(insets);
  insetsRef.current = insets;
  // The driver's own marker lives in its own layer: the pins and the route are redrawn when they change, the marker is not.
  const userMarkerRef = useRef<LiveMarker | null>(null);
  const userElementRef = useRef<L.Marker | null>(null);
  // The arrow: where the vehicle was, which way it was last known to point, and the angle currently drawn
  const prevFixRef = useRef<GeoPoint | null>(null);
  const headingRef = useRef<number | null>(null);
  const rotationRef = useRef<number | null>(null);
  // The close-up for driving is applied once per stage (and again after the driver asks to be centred), never while the driver explores
  const closeUpDoneRef = useRef(false);
  const routePointsRef = useRef<[number, number][]>([]);
  // What the latest props say, for the handle and the camera's callbacks
  const latest = useRef({ userLocation, pickupLocation, dropoffLocation, closeUpWhileMoving });
  latest.current = { userLocation, pickupLocation, dropoffLocation, closeUpWhileMoving };

  /** The points that make "the whole trip": the route and the pins the trip is about, and the driver */
  const tripPoints = (): GeoPoint[] => {
    const pts: GeoPoint[] = routePointsRef.current.map(([lat, lng]) => ({ lat, lng }));
    const { pickupLocation: pk, dropoffLocation: dr, userLocation: me } = latest.current;
    if (hasPoint(pk)) pts.push(pk);
    if (hasPoint(dr)) pts.push(dr);
    if (hasPoint(me)) pts.push(me);
    return pts;
  };

  useImperativeHandle(
    ref,
    () => ({
      centerOnDriver: () => {
        const me = latest.current.userLocation;
        if (!hasPoint(me) || !cameraRef.current) return false;
        closeUpDoneRef.current = false;
        return cameraRef.current.centerOn(me, { explicit: true, follow: "driver" });
      },
      fitRoute: () => {
        const pts = tripPoints();
        if (pts.length < 2) return false;
        return Boolean(cameraRef.current?.fit({ points: pts, explicit: true, kind: "route" }));
      },
    }),
    []
  );

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const effectiveLat =
      typeof userLocation?.lat === "number" && !isNaN(userLocation.lat)
        ? userLocation.lat
        : typeof center?.lat === "number" && !isNaN(center.lat)
        ? center.lat
        : DEFAULT_CALAPAN_CENTER.latitude;

    const effectiveLng =
      typeof userLocation?.lng === "number" && !isNaN(userLocation.lng)
        ? userLocation.lng
        : typeof center?.lng === "number" && !isNaN(center.lng)
        ? center.lng
        : DEFAULT_CALAPAN_CENTER.longitude;

    const map = L.map(mapContainerRef.current, {
      center: [effectiveLat, effectiveLng],
      zoom: zoom,
      zoomControl: false,
      attributionControl: false,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      subdomains: ["a", "b", "c"],
    }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;

    const routeLayers = L.layerGroup().addTo(map);
    routeLayersRef.current = routeLayers;

    // The driver's own marker: made once, then moved (never rebuilt)
    const liveLayer = L.layerGroup().addTo(map);
    userMarkerRef.current = createLiveMarker<L.Marker>({
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
        userElementRef.current = marker;
        return marker;
      },
    });

    mapInstanceRef.current = map;

    // The camera: framing and following that work from the visible area (see packages/shared/src/utils/mapCamera.ts). Here the map follows the driver.
    const camera = createMapCamera(map as unknown as CameraMap, {
      followZoom: DRIVING_ZOOM,
      onModeChange: (m) => onModeRef.current?.(m),
      autoFollow: () => "driver",
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

    // The container's size changed (rotation, window, the keyboard): the map re-measures itself and keeps what was framed in view
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => camera.resized());
      resizeObserver.observe(container);
    }

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
      // Stop the glide frames before the map goes away (nothing may draw on a removed map)
      userMarkerRef.current?.destroy();
      userMarkerRef.current = null;
      userElementRef.current = null;
      markersLayerRef.current = null;
      routeLayersRef.current = null;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // What covers the map changed (a panel grew or shrank): the camera re-frames inside what is left
  useEffect(() => {
    cameraRef.current?.setInsets(insets ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets?.top, insets?.right, insets?.bottom, insets?.left]);

  // The trip moved to another stage
  useEffect(() => {
    if (stageKey === undefined) return;
    cameraRef.current?.stageChanged(stageKey);
    closeUpDoneRef.current = false;
  }, [stageKey]);

  // The driver's marker: made at the first fix, then it glides to each newer one, pointing the way the vehicle travels. The fixes themselves
  // (what is sent to the database, and what routing, distance and trip progress use) are not changed.
  // The dependencies are the position's numbers, not the object: a parent that rebuilds the object every render must not restart the glide.
  useEffect(() => {
    const controller = userMarkerRef.current;
    if (!controller) return;
    const result = controller.update(userLocation ?? null);
    if (!userLocation) {
      userElementRef.current = null;
      prevFixRef.current = null;
      headingRef.current = null;
      rotationRef.current = null;
      return;
    }
    // Which way it points: the device's own heading while moving, else the direction it actually moved, else the last known one; none when unknown
    if (result && result.status !== "ignored") {
      const resolved = resolveHeading({
        reported: userLocation.heading,
        speedMps: userLocation.speed,
        previous: prevFixRef.current,
        current: userLocation,
        lastHeading: headingRef.current,
      });
      prevFixRef.current = { lat: userLocation.lat, lng: userLocation.lng };
      headingRef.current = resolved.heading;
      if (resolved.heading === null) {
        rotationRef.current = null;
        applyMarkerState(userElementRef.current?.getElement(), { rotation: null });
      } else {
        rotationRef.current = continuousRotation(rotationRef.current, resolved.heading);
        applyMarkerState(userElementRef.current?.getElement(), { rotation: rotationRef.current });
      }
    }

    const camera = cameraRef.current;
    if (!camera) return;
    // Moving for real: bring the map in close once, so the road ahead can be read. Only while the camera is following the driver.
    const mode = camera.mode();
    const moving = typeof userLocation.speed === "number" && userLocation.speed >= MOVING_MIN_SPEED_MPS;    if (latest.current.closeUpWhileMoving && moving && !closeUpDoneRef.current && (mode === "auto" || mode === "driver")) {
      closeUpDoneRef.current = true;
      camera.centerOn(userLocation, { minZoom: DRIVING_ZOOM });
      return;
    }
    camera.followMarker("driver", userLocation, result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation?.lat, userLocation?.lng, userLocation?.at, userLocation?.heading, interactive]);

  // A position that has stopped refreshing is drawn dimmer, so nobody takes it for live
  useEffect(() => {
    applyMarkerState(userElementRef.current?.getElement(), { stale: userStale });
  }, [userStale, userLocation?.lat, userLocation?.lng]);

  // Synchronize routeCoordinates prop or fetch road coordinates via OSRM
  useEffect(() => {
    if (routeCoordinates && routeCoordinates.length >= 2) {
      setRoadCoords(routeCoordinates);
      return;
    }

    let startPoint: { lat: number; lng: number } | null = null;
    let endPoint: { lat: number; lng: number } | null = null;

    if (dropoffLocation && dropoffLocation.lat !== 0) {
      // In trip to destination: dynamic route from live driver to dropoff
      startPoint = userLocation && userLocation.lat !== 0 ? userLocation : (pickupLocation && pickupLocation.lat !== 0 ? pickupLocation : null);
      endPoint = dropoffLocation;
    } else if (pickupLocation && pickupLocation.lat !== 0 && userLocation && userLocation.lat !== 0) {
      // Pre-trip: en route from driver location to passenger pickup
      startPoint = userLocation;
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
          console.warn("[Driver MapView] Road routing note:", err);
        });

      return () => {
        isMounted = false;
      };
    } else {
      setRoadCoords([]);
      lastFetchRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pickupLocation?.lat,
    pickupLocation?.lng,
    dropoffLocation?.lat,
    dropoffLocation?.lng,
    userLocation?.lat,
    userLocation?.lng,
    routeCoordinates,
  ]);

  // The pins and the road route. The camera fits the whole trip into the VISIBLE area once per destination (and again when the stage changes).
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    const routeLayers = routeLayersRef.current;
    if (!map || !markersLayer || !routeLayers) return;

    markersLayer.clearLayers();
    routeLayers.clearLayers();

    // (The driver's own marker is a live marker, moved by its own effect above.)

    // 2. The pickup. While the passenger is still to be collected it is THE PASSENGER: the same blue person marker the passenger sees for
    //    themselves. After boarding the place is only a spot already passed, so it is a small quiet dot.
    if (pickupLocation && pickupLocation.lat !== 0) {
      const waiting = !(dropoffLocation && dropoffLocation.lat !== 0);
      const pickupIcon = waiting
        ? L.divIcon({
            className: "leaflet-pickup-marker",
            html: passengerMarkerHtml(),
            iconSize: [PASSENGER_MARKER_SIZE, PASSENGER_MARKER_SIZE],
            iconAnchor: [PASSENGER_MARKER_SIZE / 2, PASSENGER_MARKER_SIZE / 2],
          })
        : L.divIcon({
            className: "leaflet-pickup-marker",
            html: `<div style="width:14px;height:14px;background-color:#FFFFFF;border:3px solid #FF6B00;border-radius:50%;opacity:0.85;box-shadow:0 2px 6px rgba(15,23,42,0.25);box-sizing:content-box;"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });

      L.marker([pickupLocation.lat, pickupLocation.lng], { icon: pickupIcon, zIndexOffset: waiting ? 800 : 0 }).addTo(markersLayer);
    }

    // 3. Dropoff Pin Marker (Red/Orange)
    if (dropoffLocation && dropoffLocation.lat !== 0) {
      const dropoffIcon = L.divIcon({
        className: "leaflet-dropoff-marker",
        html: `
          <div style="
            width: 28px;
            height: 28px;
            background-color: #EF4444;
            border: 3px solid #FFFFFF;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #FFFFFF;
            font-size: 11px;
            font-weight: 800;
          ">D</div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      L.marker([dropoffLocation.lat, dropoffLocation.lng], { icon: dropoffIcon }).addTo(markersLayer);
    }

    // 4. Draw Road-Based Route Polyline (OSRM geometry) & Fit Bounds (No ugly straight line fallback)
    const activeRoutePoints: [number, number][] =
      roadCoords && roadCoords.length >= 2
        ? roadCoords
        : routeCoordinates && routeCoordinates.length >= 2
        ? routeCoordinates
        : [];

    routePointsRef.current = activeRoutePoints;

    if (activeRoutePoints.length >= 2) {
      // 4a. Bottom white casing border for clean road contrast
      const routeCasing = L.polyline(activeRoutePoints, {
        color: "#FFFFFF",
        weight: 9,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      });

      // 4b. Main road route line: solid SAKAY orange
      const routeLine = L.polyline(activeRoutePoints, {
        color: "#FF6B00",
        weight: 6,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      });

      routeLayers.addLayer(routeCasing);
      routeLayers.addLayer(routeLine);

      // Fit the whole road journey into the VISIBLE area ONLY ONCE when the route first loads or the destination changes (and again when the
      // stage changes); a driver who has dragged or zoomed the map is left alone. Once framed, the map follows the driver's marker as it glides.
      const last = activeRoutePoints[activeRoutePoints.length - 1];
      cameraRef.current?.fit({ points: tripPoints(), key: `route:${last[0]}_${last[1]}`, kind: "route" });
    }
    // The pins and the route are redrawn only when they change (the driver's marker has its own effect), so the dependencies are their numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupLocation?.lat, pickupLocation?.lng, dropoffLocation?.lat, dropoffLocation?.lng, roadCoords, routeCoordinates, stageKey]);

  // Recenter trigger listener (an explicit press elsewhere on the screen): takes the camera back, then frames the route, or centres on the
  // driver, inside the visible area
  const seenRecenterRef = useRef(recenterTrigger);
  useEffect(() => {
    // Only a CHANGE of the trigger is a press (mounting, and React re-running the effect in development, are not)
    if (seenRecenterRef.current === recenterTrigger) return;
    seenRecenterRef.current = recenterTrigger;
    const camera = cameraRef.current;
    if (!camera) return;
    camera.release();
    closeUpDoneRef.current = false;
    if (routePointsRef.current.length >= 2) {
      camera.fit({ points: tripPoints(), explicit: true, kind: "route" });
    } else if (hasPoint(userLocation)) {
      camera.centerOn(userLocation, { explicit: true, follow: "driver", minZoom: zoom });
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

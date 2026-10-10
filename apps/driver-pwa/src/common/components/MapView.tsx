import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { createLiveMarker, getOSRMRoute, type GlideFix, type GlideResult, type LiveMarker } from "@sakay/shared";

export const DEFAULT_CALAPAN_CENTER = {
  latitude: 13.4117,
  longitude: 121.1803,
};

export interface MapViewProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  /** The driver's own position: drawn as a marker that glides between fixes (`at` = when the fix was taken, to drop reordered ones) */
  userLocation?: GlideFix | null;
  pickupLocation?: { lat: number; lng: number } | null;
  dropoffLocation?: { lat: number; lng: number } | null;
  routeCoordinates?: [number, number][];
  recenterTrigger?: number;
  height?: string;
  width?: string;
  interactive?: boolean;
}

/**
 * MapView - Leaflet OpenStreetMap Map Component (Driver PWA)
 * Render road-based navigation route geometry using OSRM road network.
 */
export const MapView: React.FC<MapViewProps> = ({
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
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayersRef = useRef<L.LayerGroup | null>(null);
  const [roadCoords, setRoadCoords] = useState<[number, number][]>(routeCoordinates || []);
  const lastFetchRef = useRef<{ startLat: number; startLng: number; endLat: number; endLng: number } | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const userInteractedRef = useRef<boolean>(false);
  const routeFittedKeyRef = useRef<string | null>(null);
  // The driver's own marker lives in its own layer: the pins and the route are redrawn when they change, the marker is not.
  const userMarkerRef = useRef<LiveMarker | null>(null);
  const routeFramedRef = useRef(false);

  /**
   * Keeps the map on the driver as the marker glides: the map pans in a straight line over the same time, so the marker stays where it is on
   * the screen and the map slides under it. A driver who has dragged or zoomed the map is left alone.
   */
  const followDriver = (target: { lat: number; lng: number }, result: GlideResult | null) => {
    const map = mapInstanceRef.current;
    if (!map || !result || result.status === "ignored" || userInteractedRef.current) return;
    const at: [number, number] = [target.lat, target.lng];
    if (result.status === "gliding") {
      map.panTo(at, { animate: true, duration: result.durationMs / 1000, easeLinearity: 1, noMoveStart: true });
    } else if (result.reason === "reduced-motion") {
      map.panTo(at, { animate: false });
    } else if (result.reason === "jump" || !routeFramedRef.current) {
      map.panTo(at, { animate: true });
    }
  };

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
      create: (p) =>
        L.marker([p.lat, p.lng], {
          interactive: false,
          zIndexOffset: 1000,
          icon: L.divIcon({
            className: "leaflet-user-marker",
            html: `
              <div class="leaflet-user-pulse">
                <div class="pulse-ring"></div>
                <div class="pulse-core"></div>
              </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
        }).addTo(liveLayer),
    });

    mapInstanceRef.current = map;

    // Track user gesture interaction so GPS ticks do not override manual zoom or pan
    map.on("dragstart", () => {
      userInteractedRef.current = true;
    });
    map.on("zoomstart", () => {
      userInteractedRef.current = true;
    });

    const resizeTimer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 250);

    return () => {
      clearTimeout(resizeTimer);
      // Stop the glide frames before the map goes away (nothing may draw on a removed map)
      userMarkerRef.current?.destroy();
      userMarkerRef.current = null;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [interactive]);

  // The driver's marker: made at the first fix, then it glides to each newer one. The fixes themselves (what is sent to the database, and what
  // routing, distance and trip progress use) are not changed.
  useEffect(() => {
    const controller = userMarkerRef.current;
    if (!controller) return;
    const result = controller.update(userLocation ?? null);
    if (userLocation) followDriver(userLocation, result);
  }, [userLocation?.lat, userLocation?.lng, userLocation?.at, interactive]);

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
  }, [
    pickupLocation?.lat,
    pickupLocation?.lng,
    dropoffLocation?.lat,
    dropoffLocation?.lng,
    userLocation?.lat,
    userLocation?.lng,
    routeCoordinates,
  ]);

  // Handle Updates: Markers, Road Route Polyline, Panning
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    const routeLayers = routeLayersRef.current;
    if (!map || !markersLayer || !routeLayers) return;

    markersLayer.clearLayers();
    routeLayers.clearLayers();

    // (The driver's own marker is a live marker, moved by its own effect above.)

    // 2. Pickup Pin Marker (Orange Circle)
    if (pickupLocation && pickupLocation.lat !== 0) {
      const pickupIcon = L.divIcon({
        className: "leaflet-pickup-marker",
        html: `
          <div style="
            width: 24px;
            height: 24px;
            background-color: #FF6B00;
            border: 3px solid #FFFFFF;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(255, 107, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
          "></div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      L.marker([pickupLocation.lat, pickupLocation.lng], { icon: pickupIcon }).addTo(markersLayer);
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

    routeFramedRef.current = activeRoutePoints.length >= 2;

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

      // Fit map bounds to show the entire road journey ONLY ONCE when route first loads or destination changes!
      const endPointKey = `${activeRoutePoints[activeRoutePoints.length - 1][0]}_${activeRoutePoints[activeRoutePoints.length - 1][1]}`;
      if (!userInteractedRef.current && routeFittedKeyRef.current !== endPointKey) {
        routeFittedKeyRef.current = endPointKey;
        const bounds = L.latLngBounds(activeRoutePoints);
        map.fitBounds(bounds, {
          padding: [60, 60],
          maxZoom: 16,
        });
      }
      // (once the route is framed, the map follows the driver's marker as it glides)
    }
  }, [pickupLocation?.lat, pickupLocation?.lng, dropoffLocation?.lat, dropoffLocation?.lng, roadCoords, routeCoordinates, recenterTrigger]);

  // Recenter trigger listener (explicit user click)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    userInteractedRef.current = false;

    const activeRoutePoints: [number, number][] =
      roadCoords && roadCoords.length >= 2
        ? roadCoords
        : routeCoordinates && routeCoordinates.length >= 2
        ? routeCoordinates
        : [];

    if (activeRoutePoints.length >= 2) {
      const bounds = L.latLngBounds(activeRoutePoints);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    } else if (typeof userLocation?.lat === "number" && !isNaN(userLocation.lat) && typeof userLocation?.lng === "number" && !isNaN(userLocation.lng)) {
      map.flyTo([userLocation.lat, userLocation.lng], zoom, { duration: 0.8 });
    } else if (typeof center?.lat === "number" && !isNaN(center.lat) && typeof center?.lng === "number" && !isNaN(center.lng)) {
      map.flyTo([center.lat, center.lng], zoom, { duration: 0.8 });
    }
  }, [recenterTrigger, zoom]);

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
};

export default MapView;

import React, { useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MapIcon from "@mui/icons-material/Map";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";

export interface MapViewProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  userLocation?: { lat: number; lng: number } | null;
  pickupLocation?: { lat: number; lng: number } | null;
  dropoffLocation?: { lat: number; lng: number } | null;
  recenterTrigger?: number;
  height?: string;
  width?: string;
  interactive?: boolean;
}

const DEFAULT_CALAPAN_CENTER = { lat: 13.4115, lng: 121.1803 };

// Simulated tricycle drivers around Calapan City
const NEARBY_DRIVERS = [
  { id: "driver_1", lat: 13.4140, lng: 121.1820, name: "Tricycle Driver #104" },
  { id: "driver_2", lat: 13.4080, lng: 121.1760, name: "Tricycle Driver #215" },
  { id: "driver_3", lat: 13.4200, lng: 121.1850, name: "Tricycle Driver #088" },
];

// Helper sub-component to dynamically control map centering
const MapPanController: React.FC<{
  center: { lat: number; lng: number };
  zoom: number;
  recenterTrigger?: number;
}> = ({ center, zoom, recenterTrigger }) => {
  const map = useMap();

  useEffect(() => {
    if (map && center) {
      map.panTo(center);
      if (zoom) map.setZoom(zoom);
    }
  }, [map, center, zoom, recenterTrigger]);

  return null;
};

const MapView: React.FC<MapViewProps> = ({
  center = DEFAULT_CALAPAN_CENTER,
  zoom = 15,
  userLocation = DEFAULT_CALAPAN_CENTER,
  pickupLocation,
  dropoffLocation,
  recenterTrigger = 0,
  height = "100%",
  width = "100%",
  interactive = true,
}) => {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || "";
  const effectiveCenter = userLocation || center;

  // Custom SVG Marker icon URLs / Data URIs
  const userPinIcon = "https://maps.google.com/mapfiles/ms/icons/orange-dot.png";
  const pickupPinIcon = "https://maps.google.com/mapfiles/ms/icons/green-dot.png";
  const dropoffPinIcon = "https://maps.google.com/mapfiles/ms/icons/red-dot.png";
  const driverPinIcon = "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png";

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
      }}
    >
      {apiKey ? (
        /* Real Google Maps API Component when key is configured */
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={effectiveCenter}
            defaultZoom={zoom}
            disableDefaultUI={true}
            gestureHandling={interactive ? "greedy" : "none"}
            style={{ width: "100%", height: "100%" }}
          >
            {/* Map centering controller */}
            <MapPanController
              center={effectiveCenter}
              zoom={zoom}
              recenterTrigger={recenterTrigger}
            />

            {/* User Current Location Marker */}
            {userLocation && (
              <Marker
                position={userLocation}
                title="Kasalukuyang Lokasyon"
                icon={{
                  url: userPinIcon,
                }}
              />
            )}

            {/* Pickup Marker */}
            {pickupLocation && (
              <Marker
                position={pickupLocation}
                title="Pickup Point"
                icon={{
                  url: pickupPinIcon,
                }}
              />
            )}

            {/* Dropoff Marker */}
            {dropoffLocation && (
              <Marker
                position={dropoffLocation}
                title="Destinasyon"
                icon={{
                  url: dropoffPinIcon,
                }}
              />
            )}

            {/* Nearby Tricycle Drivers Markers */}
            {NEARBY_DRIVERS.map((driver) => (
              <Marker
                key={driver.id}
                position={{ lat: driver.lat, lng: driver.lng }}
                title={driver.name}
                icon={{
                  url: driverPinIcon,
                }}
              />
            ))}
          </Map>
        </APIProvider>
      ) : (
        /* Developer Configuration Guidance when API key is missing */
        <Box
          sx={{
            width: "100%",
            height: "100%",
            backgroundColor: "#E2E8F0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <Box
            sx={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              backgroundColor: "rgba(255, 107, 0, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px",
            }}
          >
            <MapIcon sx={{ fontSize: "36px", color: "#FF6B00" }} />
          </Box>
          <Typography
            sx={{
              fontSize: "16px",
              fontWeight: 800,
              color: "#0F172A",
              marginBottom: "8px",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            Google Maps API Key Required
          </Typography>
          <Typography
            sx={{
              fontSize: "13px",
              color: "#64748B",
              lineHeight: 1.5,
              maxWidth: "280px",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            Please set <code>VITE_GOOGLE_MAPS_API_KEY</code> in{" "}
            <code>apps/passenger-pwa/.env</code> to load live Google Maps tiles.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default MapView;

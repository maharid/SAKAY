import React, { useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import CircularProgress from "@mui/material/CircularProgress";

import MapView from "../../../../common/components/MapView";
import {
  reverseGeocodeCoordinates,
  DEFAULT_CALAPAN_CENTER,
  getCurrentDevicePosition,
} from "../../../../services/locationService";
import { useLanguage } from "../../../../utils/LanguageContext";

interface MapLocationPickerProps {
  open: boolean;
  onClose: () => void;
  initialCoords?: { lat: number; lng: number };
  onConfirmLocation: (location: { address: string; lat: number; lng: number }) => void;
}

const MapLocationPicker: React.FC<MapLocationPickerProps> = ({
  open,
  onClose,
  initialCoords,
  onConfirmLocation,
}) => {
  const { language } = useLanguage();
  const [recenterTrigger, setRecenterTrigger] = useState<number>(1);

  const [centerCoords, setCenterCoords] = useState<{ lat: number; lng: number }>(() => {
    if (initialCoords && initialCoords.lat !== 0) return initialCoords;
    const savedLat = localStorage.getItem("user_lat");
    const savedLng = localStorage.getItem("user_lng");
    if (savedLat && savedLng) {
      return { lat: parseFloat(savedLat), lng: parseFloat(savedLng) };
    }
    return {
      lat: DEFAULT_CALAPAN_CENTER.latitude,
      lng: DEFAULT_CALAPAN_CENTER.longitude,
    };
  });

  const handleRecenterGps = async () => {
    try {
      const coords = await getCurrentDevicePosition();
      setCenterCoords({ lat: coords.latitude, lng: coords.longitude });
      setRecenterTrigger((prev) => prev + 1);
    } catch {
      const savedLat = localStorage.getItem("user_lat");
      const savedLng = localStorage.getItem("user_lng");
      if (savedLat && savedLng) {
        setCenterCoords({ lat: parseFloat(savedLat), lng: parseFloat(savedLng) });
      } else {
        setCenterCoords({
          lat: DEFAULT_CALAPAN_CENTER.latitude,
          lng: DEFAULT_CALAPAN_CENTER.longitude,
        });
      }
      setRecenterTrigger((prev) => prev + 1);
    }
  };

  // Re-sync initial center when dialog opens
  useEffect(() => {
    if (open) {
      if (initialCoords && initialCoords.lat !== 0) {
        setCenterCoords(initialCoords);
      } else {
        const savedLat = localStorage.getItem("user_lat");
        const savedLng = localStorage.getItem("user_lng");
        if (savedLat && savedLng) {
          setCenterCoords({ lat: parseFloat(savedLat), lng: parseFloat(savedLng) });
        }
      }
    }
  }, [open, initialCoords?.lat, initialCoords?.lng]);

  const [resolvedAddress, setResolvedAddress] = useState<string>("");
  const [resolving, setResolving] = useState<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reverse-geocode center coordinates when map center updates
  useEffect(() => {
    if (!open) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setResolving(true);
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const address = await reverseGeocodeCoordinates(centerCoords.lat, centerCoords.lng);
        setResolvedAddress(address);
      } catch (err) {
        console.warn("Map picker reverse geocoding error:", err);
        setResolvedAddress(
          language === "tl" ? "Naitalang Lokasyon sa Calapan" : "Recorded Location in Calapan"
        );
      } finally {
        setResolving(false);
      }
    }, 400);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [centerCoords.lat, centerCoords.lng, open, language]);

  const handleConfirm = () => {
    const finalAddress =
      resolvedAddress ||
      (language === "tl" ? "Naitalang Lokasyon sa Calapan" : "Recorded Location in Calapan");
    onConfirmLocation({
      address: finalAddress,
      lat: centerCoords.lat,
      lng: centerCoords.lng,
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      slotProps={{
        paper: {
          sx: {
            backgroundColor: "#E3ECEF",
            padding: 0,
          },
        },
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* 1. Map Canvas Underlying View */}
        <MapView
          userLocation={centerCoords}
          center={centerCoords}
          recenterTrigger={recenterTrigger}
          onCenterChange={(coords) => setCenterCoords(coords)}
          onMapClick={(coords) => setCenterCoords(coords)}
        />

        {/* 2. Top Header Bar: ← Bumalik / Back + Centered "Pumili sa Mapa" Title */}
        <Paper
          elevation={2}
          sx={{
            position: "absolute",
            top: "calc(var(--safe-area-top) + 12px)",
            left: "16px",
            right: "16px",
            zIndex: 20,
            borderRadius: "16px",
            backgroundColor: "#FFFFFF",
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton onClick={onClose} size="small" sx={{ color: "#0F172A", p: 0.5 }}>
              <ArrowBackIcon sx={{ fontSize: 22 }} />
            </IconButton>
            <Typography
              sx={{
                fontSize: "16px",
                fontWeight: 700,
                color: "#0F172A",
                fontFamily: "Poppins, sans-serif",
              }}
            >
              {language === "tl" ? "Pumili sa Mapa" : "Select on Map"}
            </Typography>
          </Box>
        </Paper>

        {/* 3. FIXED CENTER PIN OVERLAY (Pin stays still while Map moves underneath) */}
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -100%)",
            zIndex: 15,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* Target Location Badge */}
          <Paper
            elevation={3}
            sx={{
              backgroundColor: "#0F172A",
              color: "#FFFFFF",
              px: 1.5,
              py: 0.5,
              borderRadius: "999px",
              mb: 0.5,
              whiteSpace: "nowrap",
            }}
          >
            <Typography sx={{ fontSize: "11px", fontWeight: 700, fontFamily: "Poppins, sans-serif" }}>
              {resolving
                ? (language === "tl" ? "Kinukuha ang address..." : "Resolving address...")
                : (language === "tl" ? "Ipwesto ang mapa dito" : "Position map under pin")}
            </Typography>
          </Paper>

          {/* SAKAY Orange Center Location Pin */}
          <LocationOnIcon
            sx={{
              color: "#FF6B00",
              fontSize: "44px",
              filter: "drop-shadow(0px 6px 12px rgba(255, 107, 0, 0.4))",
            }}
          />

          {/* Pin Shadow Dot */}
          <Box
            sx={{
              width: 10,
              height: 4,
              borderRadius: "50%",
              backgroundColor: "rgba(15, 23, 42, 0.3)",
              mt: -0.5,
            }}
          />
        </Box>

        {/* 4. Floating Recenter GPS Location Button matching Dashboard/Home */}
        <IconButton
          onClick={handleRecenterGps}
          aria-label={language === "tl" ? "Bumalik sa kasalukuyang lokasyon" : "Recenter map location"}
          sx={{
            position: "absolute",
            bottom: "calc(var(--safe-area-bottom) + 140px)",
            right: "16px",
            backgroundColor: "#FFFFFF",
            color: "#0F172A",
            boxShadow: "0 4px 16px rgba(15, 23, 42, 0.15)",
            border: "1px solid #E2E8F0",
            borderRadius: "50%",
            width: "44px",
            height: "44px",
            zIndex: 25,
            transition: "all 0.15s ease",
            "&:hover": {
              backgroundColor: "#F8FAFC",
            },
            "&:active": {
              transform: "scale(0.95)",
            },
          }}
        >
          <MyLocationIcon sx={{ fontSize: 20, color: "#0F172A" }} />
        </IconButton>

        {/* 4. Bottom Confirmation Card: Napiling Lokasyon & Gamitin ang Lokasyong Ito */}
        <Paper
          elevation={6}
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            backgroundColor: "#FFFFFF",
            borderTopLeftRadius: "24px",
            borderTopRightRadius: "24px",
            padding: "16px 20px calc(var(--safe-area-bottom) + 16px) 20px",
            boxShadow: "0 -10px 30px rgba(15, 23, 42, 0.12)",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          <Box>
            <Typography
              sx={{
                fontSize: "12px",
                fontWeight: 700,
                color: "#94A3B8",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                fontFamily: "Poppins, sans-serif",
                mb: 0.25,
              }}
            >
              {language === "tl" ? "Napiling Lokasyon" : "Selected Location"}
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {resolving ? (
                <CircularProgress size={16} sx={{ color: "#FF6B00" }} />
              ) : (
                <LocationOnIcon sx={{ color: "#FF6B00", fontSize: 20, flexShrink: 0 }} />
              )}
              <Typography
                sx={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#0F172A",
                  fontFamily: "Poppins, sans-serif",
                  lineHeight: 1.35,
                }}
              >
                {resolving
                  ? (language === "tl" ? "Inaalam ang eksaktong lokasyon..." : "Determining exact location...")
                  : (resolvedAddress || (language === "tl" ? "Calapan City, Oriental Mindoro" : "Calapan City, Oriental Mindoro"))}
              </Typography>
            </Box>
          </Box>

          {/* Kumpirmahin ang Lokasyon Button */}
          <Button
            fullWidth
            variant="contained"
            disabled={resolving}
            onClick={handleConfirm}
            sx={{
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "14px",
              height: "44px",
              fontSize: "14px",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "Kumpirmahin ang Lokasyon" : "Confirm Location"}
          </Button>
        </Paper>
      </Box>
    </Dialog>
  );
};

export default MapLocationPicker;

import React, { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import WorkOutlinedIcon from "@mui/icons-material/WorkOutlined";
import SchoolOutlinedIcon from "@mui/icons-material/SchoolOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import FavoriteBorderOutlinedIcon from "@mui/icons-material/FavoriteBorderOutlined";

import { useLanguage } from "../../../utils/LanguageContext";
import { searchPlaces } from "../../../services/locationService";
import type { PlaceSuggestion } from "../../../services/locationService";
import MapLocationPicker from "../../ride-booking/components/Dashboard/MapLocationPicker";

export interface SavedPlaceItem {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  icon?: string;
}

export const ICON_OPTIONS = [
  { key: "home", labelTl: "Bahay", labelEn: "Home", icon: HomeOutlinedIcon },
  { key: "work", labelTl: "Trabaho", labelEn: "Work", icon: WorkOutlinedIcon },
  { key: "school", labelTl: "Paaralan", labelEn: "School", icon: SchoolOutlinedIcon },
  { key: "favorite", labelTl: "Paborito", labelEn: "Favorite", icon: FavoriteBorderOutlinedIcon },
  { key: "other", labelTl: "Iba pa", labelEn: "Other", icon: PlaceOutlinedIcon },
];

export interface SavedPlaceModalProps {
  open: boolean;
  onClose: () => void;
  initialPlace?: SavedPlaceItem | null;
  onSave: (place: { id?: string; name: string; address: string; lat: number; lng: number; icon: string }) => void;
  onError?: (msg: string) => void;
}

const SavedPlaceModal: React.FC<SavedPlaceModalProps> = ({
  open,
  onClose,
  initialPlace,
  onSave,
  onError,
}) => {
  const { language } = useLanguage();

  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [addressSearchQuery, setAddressSearchQuery] = useState("");
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number }>({ lat: 13.4124, lng: 121.1834 });
  const [selectedIcon, setSelectedIcon] = useState<string>("other");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialPlace) {
        setPlaceName(initialPlace.name);
        setPlaceAddress(initialPlace.address);
        setAddressSearchQuery(initialPlace.address);
        setPlaceCoords({ lat: initialPlace.lat, lng: initialPlace.lng });
        setSelectedIcon(initialPlace.icon || "other");
      } else {
        setPlaceName("");
        setPlaceAddress("");
        setAddressSearchQuery("");
        setPlaceCoords({ lat: 13.4124, lng: 121.1834 });
        setSelectedIcon("other");
      }
      setSuggestions([]);
    }
  }, [open, initialPlace]);

  // Search Places autocomplete
  useEffect(() => {
    if (!addressSearchQuery || addressSearchQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await searchPlaces(addressSearchQuery, 13.4124, 121.1834);
        setSuggestions(results);
      } catch (e) {
        console.warn("Place search error", e);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [addressSearchQuery]);

  const handleSelectSuggestion = (s: PlaceSuggestion) => {
    setPlaceAddress(s.address);
    setAddressSearchQuery(s.address);
    setPlaceCoords({ lat: s.lat, lng: s.lng });
    setSuggestions([]);
  };

  const handleConfirmMapLocation = (loc: { address: string; lat: number; lng: number }) => {
    setPlaceAddress(loc.address);
    setAddressSearchQuery(loc.address);
    setPlaceCoords({ lat: loc.lat, lng: loc.lng });
  };

  const handleSave = () => {
    const finalAddress = placeAddress.trim() || addressSearchQuery.trim();
    if (!placeName.trim() || !finalAddress) {
      const errMsg = language === "tl" ? "Kumpletuhin ang pangalan at lokasyon." : "Please complete place name and location.";
      if (onError) onError(errMsg);
      return;
    }

    onSave({
      id: initialPlace?.id,
      name: placeName.trim(),
      address: finalAddress,
      lat: placeCoords.lat,
      lng: placeCoords.lng,
      icon: selectedIcon,
    });
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        slotProps={{
          paper: {
            sx: { borderRadius: "20px", padding: "12px", maxWidth: "370px", width: "92%" },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: "18px", color: "#0F172A", fontFamily: "Poppins, sans-serif", pb: 1 }}>
          {initialPlace
            ? language === "tl"
              ? "I-edit ang Lugar"
              : "Edit Saved Location"
            : language === "tl"
            ? "Magdagdag ng Lugar"
            : "Add Saved Location"}
        </DialogTitle>
        <DialogContent sx={{ py: 1 }}>
          {/* Field 1: Pangalan ng Lugar */}
          <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#475569", mb: 0.5, fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Pangalan ng Lugar" : "Place Name"}
          </Typography>
          <TextField
            fullWidth
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            placeholder={language === "tl" ? "Hal. Bahay, Paaralan, Trabaho" : "e.g. Home, School, Work"}
            variant="outlined"
            size="small"
            sx={{
              mb: 1.5,
              "& .MuiOutlinedInput-root": { borderRadius: "12px", fontSize: "14px" },
            }}
          />

          {/* Field 1.5: Simbolo / Icon Selection */}
          <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#475569", mb: 0.75, fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Simbolo / Icon" : "Location Icon"}
          </Typography>
          <Box
            sx={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: "16px",
              p: "10px 8px",
              mb: 2,
            }}
          >
            {ICON_OPTIONS.map((opt) => {
              const isSelected = selectedIcon === opt.key;
              const IconComp = opt.icon;
              return (
                <Box
                  key={opt.key}
                  onClick={() => setSelectedIcon(opt.key)}
                  sx={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.5,
                    cursor: "pointer",
                  }}
                >
                  <Box
                    sx={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "12px",
                      backgroundColor: isSelected ? "#FF6B00" : "#FFFFFF",
                      color: isSelected ? "#FFFFFF" : "#64748B",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: isSelected ? "1.5px solid #FF6B00" : "1px solid #CBD5E1",
                      transition: "all 0.15s ease",
                      "&:hover": {
                        backgroundColor: isSelected ? "#E66000" : "#F1F5F9",
                      },
                    }}
                  >
                    <IconComp sx={{ fontSize: 20 }} />
                  </Box>
                  <Typography
                    sx={{
                      fontSize: "10px",
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? "#FF6B00" : "#64748B",
                      fontFamily: "Poppins, sans-serif",
                      textAlign: "center",
                    }}
                  >
                    {language === "tl" ? opt.labelTl : opt.labelEn}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {/* Field 2: Lokasyon */}
          <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#475569", mb: 0.5, fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Lokasyon" : "Location"}
          </Typography>

          {/* Option A: Search / type address */}
          <TextField
            fullWidth
            value={addressSearchQuery}
            onChange={(e) => {
              setAddressSearchQuery(e.target.value);
              setPlaceAddress(e.target.value);
            }}
            placeholder={language === "tl" ? "Ilagay ang address o landmark" : "Enter address or landmark"}
            variant="outlined"
            size="small"
            sx={{
              mb: 1,
              "& .MuiOutlinedInput-root": { borderRadius: "12px", fontSize: "14px" },
            }}
          />

          {/* Search Autocomplete Suggestions */}
          {suggestions.length > 0 && (
            <Paper elevation={2} sx={{ borderRadius: "12px", maxHeight: "140px", overflowY: "auto", mb: 2 }}>
              <List dense disablePadding>
                {suggestions.map((s, idx) => (
                  <ListItem
                    key={idx}
                    component="div"
                    onClick={() => handleSelectSuggestion(s)}
                    sx={{ cursor: "pointer", "&:hover": { backgroundColor: "#FFF7ED" } }}
                  >
                    <ListItemText
                      primary={<Typography sx={{ fontSize: "14px", fontWeight: 600 }}>{s.name || s.address}</Typography>}
                      secondary={<Typography sx={{ fontSize: "12px", color: "#64748B" }}>{s.address}</Typography>}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}

          {/* Divider "o" / "or" */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 1.5 }}>
            <Divider sx={{ flex: 1, borderColor: "#E2E8F0" }} />
            <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "#94A3B8" }}>
              {language === "tl" ? "o" : "or"}
            </Typography>
            <Divider sx={{ flex: 1, borderColor: "#E2E8F0" }} />
          </Box>

          {/* Option B: Pumili sa Mapa */}
          <Button
            fullWidth
            variant="outlined"
            startIcon={<MapOutlinedIcon sx={{ color: "#FF6B00" }} />}
            onClick={() => {
              setMapPickerOpen(true);
            }}
            sx={{
              borderColor: "#E2E8F0",
              color: "#0F172A",
              textTransform: "none",
              borderRadius: "12px",
              fontSize: "14px",
              fontWeight: 600,
              py: "8px",
              fontFamily: "Poppins, sans-serif",
              "&:hover": { borderColor: "#FF6B00", backgroundColor: "#FFF7ED" },
            }}
          >
            {language === "tl" ? "Pumili sa Mapa" : "Select on Map"}
          </Button>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2 }}>
          <Button onClick={onClose} sx={{ color: "#64748B", fontWeight: 600, textTransform: "none", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Kanselahin" : "Cancel"}
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!placeName.trim() || !(placeAddress.trim() || addressSearchQuery.trim())}
            sx={{
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "12px",
              fontWeight: 700,
              textTransform: "none",
              boxShadow: "none",
              fontFamily: "Poppins, sans-serif",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "I-save" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <MapLocationPicker
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        initialCoords={placeCoords}
        onConfirmLocation={handleConfirmMapLocation}
      />
    </>
  );
};

export default SavedPlaceModal;

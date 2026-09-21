import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon from "@mui/icons-material/Add";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import WorkOutlinedIcon from "@mui/icons-material/WorkOutlined";
import SchoolOutlinedIcon from "@mui/icons-material/SchoolOutlined";
import LocalMallOutlinedIcon from "@mui/icons-material/LocalMallOutlined";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import MapIcon from "@mui/icons-material/Map";
import NavigationIcon from "@mui/icons-material/Navigation";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";
import MapLocationPicker from "../../ride-booking/components/Dashboard/MapLocationPicker";

export interface SavedPlace {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  icon?: string;
}

const ICON_OPTIONS = [
  { key: "home", labelTl: "Bahay", labelEn: "Home", icon: HomeOutlinedIcon },
  { key: "work", labelTl: "Trabaho", labelEn: "Work", icon: WorkOutlinedIcon },
  { key: "school", labelTl: "Paaralan", labelEn: "School", icon: SchoolOutlinedIcon },
  { key: "mall", labelTl: "Mall", labelEn: "Mall", icon: LocalMallOutlinedIcon },
  { key: "favorite", labelTl: "Paborito", labelEn: "Favorite", icon: FavoriteBorderIcon },
  { key: "other", labelTl: "Iba pa", labelEn: "Other", icon: LocationOnOutlinedIcon },
];

const SavedPlacesPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(() => {
    try {
      const stored = localStorage.getItem("sakay_passenger_saved_places");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number }>({ lat: 13.4124, lng: 121.1834 });
  const [selectedIcon, setSelectedIcon] = useState<string>("other");

  useEffect(() => {
    try {
      localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(savedPlaces));
    } catch (e) {
      console.warn("Failed to persist saved places:", e);
    }
  }, [savedPlaces]);

  const handleOpenAdd = () => {
    setEditingPlaceId(null);
    setPlaceName("");
    setPlaceAddress("");
    setPlaceCoords({ lat: 13.4124, lng: 121.1834 });
    setSelectedIcon("other");
    setModalOpen(true);
  };

  const handleOpenEdit = (place: SavedPlace) => {
    setEditingPlaceId(place.id);
    setPlaceName(place.name);
    setPlaceAddress(place.address);
    setPlaceCoords({ lat: place.lat, lng: place.lng });
    setSelectedIcon(place.icon || "other");
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setSavedPlaces((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSaveModal = () => {
    if (!placeName.trim() || !placeAddress.trim()) return;

    if (editingPlaceId) {
      setSavedPlaces((prev) =>
        prev.map((p) =>
          p.id === editingPlaceId
            ? {
                ...p,
                name: placeName.trim(),
                address: placeAddress.trim(),
                lat: placeCoords.lat,
                lng: placeCoords.lng,
                icon: selectedIcon,
              }
            : p
        )
      );
    } else {
      const newPlace: SavedPlace = {
        id: `sp_${Date.now()}`,
        name: placeName.trim(),
        address: placeAddress.trim(),
        lat: placeCoords.lat,
        lng: placeCoords.lng,
        icon: selectedIcon,
      };
      setSavedPlaces((prev) => [...prev, newPlace]);
    }
    setModalOpen(false);
  };

  const handleBookRideTo = (place: SavedPlace) => {
    sessionStorage.setItem(
      "trip_dropoff",
      JSON.stringify({
        address: place.address,
        lat: place.lat,
        lng: place.lng,
      })
    );
    navigate("/new-trip");
  };

  const renderPlaceIcon = (iconKey?: string) => {
    const item = ICON_OPTIONS.find((o) => o.key === iconKey) || ICON_OPTIONS[5];
    const IconComp = item.icon;
    return <IconComp sx={{ fontSize: 22, color: "#FF6B00" }} />;
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#FAFAFA",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PageHeader
        title={language === "tl" ? "Mga Naka-save na Lugar" : "Saved Places"}
        onBack={() => navigate("/dashboard")}
      />

      <Box
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          p: 2.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleOpenAdd}
          sx={{
            backgroundColor: "#FF6B00",
            color: "#FFFFFF",
            borderRadius: "14px",
            height: "46px",
            fontSize: "14px",
            fontWeight: 700,
            textTransform: "none",
            fontFamily: "Poppins, sans-serif",
            boxShadow: "none",
            "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
          }}
        >
          {language === "tl" ? "Magdagdag ng Bagong Lugar" : "Add New Place"}
        </Button>

        {savedPlaces.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 4,
              textAlign: "center",
              borderRadius: "16px",
              backgroundColor: "#FFFFFF",
              border: "1px solid #F1F5F9",
              mt: 2,
            }}
          >
            <LocationOnOutlinedIcon sx={{ fontSize: 48, color: "#CBD5E1", mb: 1 }} />
            <Typography
              sx={{
                fontSize: "15px",
                fontWeight: 700,
                color: "#0F172A",
                fontFamily: "Poppins, sans-serif",
              }}
            >
              {language === "tl" ? "Wala pang naka-save na lugar" : "No saved places yet"}
            </Typography>
            <Typography
              sx={{
                fontSize: "13px",
                color: "#64748B",
                mt: 0.5,
                fontFamily: "Poppins, sans-serif",
              }}
            >
              {language === "tl"
                ? "I-save ang iyong bahay, trabaho, o mga madalas puntahan para sa mas mabilis na pag-book."
                : "Save your home, work, or frequent destinations for faster booking."}
            </Typography>
          </Paper>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {savedPlaces.map((place) => (
              <Paper
                key={place.id}
                elevation={0}
                sx={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  p: 2,
                  border: "1px solid #F1F5F9",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: "12px",
                      backgroundColor: "#FFF2E9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {renderPlaceIcon(place.icon)}
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: "14px",
                        fontWeight: 700,
                        color: "#0F172A",
                        fontFamily: "Poppins, sans-serif",
                      }}
                    >
                      {place.name}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: "12px",
                        color: "#64748B",
                        fontFamily: "Poppins, sans-serif",
                        lineHeight: 1.3,
                        mt: 0.25,
                      }}
                    >
                      {place.address}
                    </Typography>
                  </Box>

                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    <IconButton size="small" onClick={() => handleOpenEdit(place)} sx={{ color: "#64748B" }}>
                      <EditOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(place.id)} sx={{ color: "#EF4444" }}>
                      <DeleteOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Box>
                </Box>

                <Button
                  fullWidth
                  size="small"
                  variant="outlined"
                  startIcon={<NavigationIcon sx={{ fontSize: 16 }} />}
                  onClick={() => handleBookRideTo(place)}
                  sx={{
                    borderColor: "#FF6B00",
                    color: "#FF6B00",
                    borderRadius: "10px",
                    textTransform: "none",
                    fontSize: "12px",
                    fontWeight: 700,
                    fontFamily: "Poppins, sans-serif",
                    py: 0.75,
                    "&:hover": { borderColor: "#E66000", backgroundColor: "#FFF7ED" },
                  }}
                >
                  {language === "tl" ? "Mag-book ng Biyahe Dito" : "Book Ride to Location"}
                </Button>
              </Paper>
            ))}
          </Box>
        )}
      </Box>

      {/* Add / Edit Place Dialog */}
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        slotProps={{
          paper: {
            sx: { borderRadius: "20px", p: 1, width: "92%", maxWidth: "400px" },
          },
        }}
      >
        <DialogTitle sx={{ fontSize: "16px", fontWeight: 700, fontFamily: "Poppins, sans-serif" }}>
          {editingPlaceId
            ? language === "tl"
              ? "I-edit ang Lugar"
              : "Edit Place"
            : language === "tl"
            ? "Magdagdag ng Lugar"
            : "Add Place"}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            label={language === "tl" ? "Pangalan ng Lugar (hal. Bahay, Trabaho)" : "Place Name (e.g. Home, Work)"}
            fullWidth
            size="small"
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
          />

          <TextField
            label={language === "tl" ? "Address / Lokasyon" : "Address / Location"}
            fullWidth
            size="small"
            multiline
            rows={2}
            value={placeAddress}
            onChange={(e) => setPlaceAddress(e.target.value)}
          />

          <Button
            variant="outlined"
            startIcon={<MapIcon />}
            onClick={() => setMapPickerOpen(true)}
            sx={{
              borderColor: "#CBD5E1",
              color: "#0F172A",
              borderRadius: "12px",
              textTransform: "none",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "Poppins, sans-serif",
            }}
          >
            {language === "tl" ? "Pumili sa Mapa" : "Pick on Map"}
          </Button>

          <Box>
            <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "#64748B", mb: 1, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Pumili ng Icon:" : "Select Icon:"}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {ICON_OPTIONS.map((opt) => {
                const IconComponent = opt.icon;
                const isSel = selectedIcon === opt.key;
                return (
                  <Box
                    key={opt.key}
                    onClick={() => setSelectedIcon(opt.key)}
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: "12px",
                      backgroundColor: isSel ? "#FF6B00" : "#F1F5F9",
                      color: isSel ? "#FFFFFF" : "#64748B",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <IconComponent sx={{ fontSize: 20 }} />
                  </Box>
                );
              })}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setModalOpen(false)} sx={{ color: "#64748B" }}>
            {language === "tl" ? "Kanselahin" : "Cancel"}
          </Button>
          <Button
            onClick={handleSaveModal}
            variant="contained"
            disabled={!placeName.trim() || !placeAddress.trim()}
            sx={{
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "10px",
              fontWeight: 700,
              textTransform: "none",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "I-save" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Map Picker Integration */}
      <MapLocationPicker
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        initialCoords={placeCoords}
        onConfirmLocation={(loc) => {
          setPlaceAddress(loc.address);
          setPlaceCoords({ lat: loc.lat, lng: loc.lng });
        }}
      />
    </Box>
  );
};

export default SavedPlacesPage;

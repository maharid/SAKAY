import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon from "@mui/icons-material/Add";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import NavigationIcon from "@mui/icons-material/Navigation";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";
import SavedPlaceModal, { ICON_OPTIONS } from "../components/SavedPlaceModal";
import type { SavedPlaceItem } from "../components/SavedPlaceModal";

export type SavedPlace = SavedPlaceItem;

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
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(savedPlaces));
    } catch (e) {
      console.warn("Failed to persist saved places:", e);
    }
  }, [savedPlaces]);

  const handleOpenAdd = () => {
    setEditingPlace(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (place: SavedPlace) => {
    setEditingPlace(place);
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setSavedPlaces((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSaveModal = (data: { id?: string; name: string; address: string; lat: number; lng: number; icon: string }) => {
    if (data.id) {
      setSavedPlaces((prev) =>
        prev.map((p) =>
          p.id === data.id
            ? {
                ...p,
                name: data.name,
                address: data.address,
                lat: data.lat,
                lng: data.lng,
                icon: data.icon,
              }
            : p
        )
      );
    } else {
      const newPlace: SavedPlace = {
        id: `sp_${Date.now()}`,
        name: data.name,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        icon: data.icon,
      };
      setSavedPlaces((prev) => [...prev, newPlace]);
    }
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
    const item = ICON_OPTIONS.find((o) => o.key === iconKey) || ICON_OPTIONS[4];
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
        {/* Home-style Add Place Card */}
        <Paper
          elevation={0}
          onClick={handleOpenAdd}
          sx={{
            p: 2,
            borderRadius: "18px",
            backgroundColor: "#F4FBF7",
            border: "1.5px dashed #A7F3D0",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            cursor: "pointer",
            transition: "all 0.2s ease-in-out",
            "&:active": { transform: "scale(0.98)" },
            "&:hover": { backgroundColor: "#E6F4EA" },
          }}
        >
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: "12px",
              backgroundColor: "rgba(15, 23, 42, 0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AddIcon sx={{ color: "#0F172A", fontSize: 24 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography
              sx={{
                fontSize: "14px",
                fontWeight: 800,
                color: "#0F172A",
                fontFamily: "Poppins, sans-serif",
              }}
            >
              {language === "tl" ? "Magdagdag ng Lugar" : "Add Saved Location"}
            </Typography>
            <Typography
              sx={{
                fontSize: "12px",
                color: "#64748B",
                fontFamily: "Poppins, sans-serif",
                mt: 0.25,
              }}
            >
              {language === "tl" ? "I-save ang lokasyon para sa mabilis na pag-book" : "Save location for quick one-tap booking"}
            </Typography>
          </Box>
        </Paper>

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

      {/* Saved Place Modal */}
      <SavedPlaceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialPlace={editingPlace}
        onSave={handleSaveModal}
      />
    </Box>
  );
};

export default SavedPlacesPage;

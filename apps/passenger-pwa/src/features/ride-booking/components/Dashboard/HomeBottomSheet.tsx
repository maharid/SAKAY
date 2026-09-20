import React, { useState, useRef, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";

import { useLanguage } from "../../../../utils/LanguageContext";
import { searchPlaces } from "../../../../services/locationService";
import type { PlaceSuggestion } from "../../../../services/locationService";
import MapLocationPicker from "./MapLocationPicker";

export interface SavedPlace {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  isHome?: boolean;
}

interface HomeBottomSheetProps {
  firstName: string;
  onStartNewTrip: () => void;
  onHomeTrip: () => void;
  onSelectPlaceTrip?: (place: { address: string; lat: number; lng: number }) => void;
  onAddPlace: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  homeAddress?: string;
  onSetHomeAddress?: (address: string) => void;
  onHeightChange?: (height: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

const MAX_SHEET_HEIGHT = 220;
const MIN_SHEET_HEIGHT = 100;
const MAX_TRANSLATE = MAX_SHEET_HEIGHT - MIN_SHEET_HEIGHT; // 120px

const HomeBottomSheet: React.FC<HomeBottomSheetProps> = ({
  firstName,
  onStartNewTrip,
  onHomeTrip,
  onSelectPlaceTrip,
  isCollapsed = false,
  onToggleCollapse,
  homeAddress = "",
  onSetHomeAddress,
  onHeightChange,
  onDragStateChange,
}) => {
  const { language } = useLanguage();

  // Saved Custom Places state from localStorage
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(() => {
    try {
      const stored = localStorage.getItem("sakay_passenger_saved_places");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Unified Saved Location Modal State (Add & Edit)
  const [modalOpen, setModalOpen] = useState(false);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number }>({ lat: 13.4124, lng: 121.1834 });
  const [addressSearchQuery, setAddressSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Gesture tracking states for continuous bottom-sheet dragging
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartTimeRef = useRef<number>(0);

  // Calculate current translation and visible height strictly clamped between MIN_SHEET_HEIGHT and MAX_SHEET_HEIGHT
  const rawTranslate = isCollapsed ? MAX_TRANSLATE + dragOffsetY : dragOffsetY;
  const targetTranslate = Math.max(0, Math.min(MAX_TRANSLATE, rawTranslate));
  const currentVisibleHeight = MAX_SHEET_HEIGHT - targetTranslate;

  // Emit height changes & drag state to parent for real-time location button alignment
  useEffect(() => {
    if (onHeightChange) {
      onHeightChange(currentVisibleHeight);
    }
  }, [currentVisibleHeight, onHeightChange]);

  useEffect(() => {
    if (onDragStateChange) {
      onDragStateChange(isDragging);
    }
  }, [isDragging, onDragStateChange]);

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

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
    dragStartTimeRef.current = Date.now();
    setIsDragging(true);
    setDragOffsetY(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY;
    setDragOffsetY(deltaY);
  };

  const handleTouchEnd = () => {
    if (touchStartY === null) return;
    const dragDuration = Date.now() - dragStartTimeRef.current;
    const isFlick = dragDuration < 250 && Math.abs(dragOffsetY) > 20;

    if (!isCollapsed) {
      if (dragOffsetY > 40 || (isFlick && dragOffsetY > 0)) {
        if (onToggleCollapse) onToggleCollapse();
      }
    } else {
      if (dragOffsetY < -40 || (isFlick && dragOffsetY < 0)) {
        if (onToggleCollapse) onToggleCollapse();
      }
    }

    setTouchStartY(null);
    setDragOffsetY(0);
    setIsDragging(false);
  };

  // Open Unified Modal for Adding a Place
  const handleOpenAddModal = () => {
    setEditingPlaceId(null);
    setPlaceName("");
    setPlaceAddress("");
    setAddressSearchQuery("");
    setModalOpen(true);
  };

  // Open Unified Modal for Editing Home
  const handleOpenEditHome = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPlaceId("home");
    setPlaceName(language === "tl" ? "Bahay" : "Home");
    setPlaceAddress(homeAddress || "");
    setAddressSearchQuery(homeAddress || "");
    setModalOpen(true);
  };

  // Open Unified Modal for Editing a Saved Place
  const handleOpenEditPlace = (e: React.MouseEvent, place: SavedPlace) => {
    e.stopPropagation();
    setEditingPlaceId(place.id);
    setPlaceName(place.name);
    setPlaceAddress(place.address);
    setAddressSearchQuery(place.address);
    setPlaceCoords({ lat: place.lat, lng: place.lng });
    setModalOpen(true);
  };

  // Save Handler for Unified Modal
  const handleSavePlace = () => {
    const finalAddress = placeAddress.trim() || addressSearchQuery.trim();
    if (!placeName.trim() || !finalAddress) {
      setToastMessage(language === "tl" ? "Kumpletuhin ang pangalan at lokasyon." : "Please complete place name and location.");
      return;
    }

    if (editingPlaceId === "home") {
      if (onSetHomeAddress) onSetHomeAddress(finalAddress);
    } else if (editingPlaceId) {
      const updated = savedPlaces.map((p) =>
        p.id === editingPlaceId
          ? { ...p, name: placeName.trim(), address: finalAddress, lat: placeCoords.lat, lng: placeCoords.lng }
          : p
      );
      setSavedPlaces(updated);
      try {
        localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(updated));
      } catch {}
    } else {
      const newPlace: SavedPlace = {
        id: `place_${Date.now()}`,
        name: placeName.trim(),
        address: finalAddress,
        lat: placeCoords.lat,
        lng: placeCoords.lng,
      };
      const updated = [...savedPlaces, newPlace];
      setSavedPlaces(updated);
      try {
        localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(updated));
      } catch {}
    }

    setModalOpen(false);
  };

  const handleSelectSuggestion = (s: PlaceSuggestion) => {
    setPlaceAddress(s.address);
    setAddressSearchQuery(s.address);
    setPlaceCoords({ lat: s.lat, lng: s.lng });
    setSuggestions([]);
  };

  // Callback from MapLocationPicker when location is confirmed
  const handleConfirmMapLocation = (loc: { address: string; lat: number; lng: number }) => {
    setPlaceAddress(loc.address);
    setAddressSearchQuery(loc.address);
    setPlaceCoords({ lat: loc.lat, lng: loc.lng });
    setModalOpen(true);
  };

  const displayHomeSubtext = homeAddress && homeAddress.trim().length > 0
    ? homeAddress
    : (language === "tl" ? "I-set na" : "Set Now");

  return (
    <>
      {/* ANCHORED BOTTOM SHEET (Bottom edge remains anchored to bottom of viewport: bottom: 0) */}
      <Paper
        elevation={4}
        sx={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${MAX_SHEET_HEIGHT}px`,
          backgroundColor: "#F4FBF7",
          borderTopLeftRadius: "28px",
          borderTopRightRadius: "28px",
          padding: "10px 16px calc(var(--safe-area-bottom) + 12px) 16px",
          zIndex: 10,
          boxShadow: "0 -10px 30px rgba(15, 23, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          overflow: "hidden",
          transform: `translateY(${targetTranslate}px)`,
          transition: isDragging ? "none" : "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: "transform",
        }}
      >
        {/* Drag handle bar - moves together with sheet */}
        <Box
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={() => {
            if (Math.abs(dragOffsetY) < 5 && onToggleCollapse) {
              onToggleCollapse();
            }
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "grab",
            py: 0.75,
            width: "100%",
            userSelect: "none",
            touchAction: "none",
            "&:active": { cursor: "grabbing" },
          }}
        >
          <Box
            sx={{
              width: "48px",
              height: "5px",
              backgroundColor: "#CBD5E1",
              borderRadius: "3px",
            }}
          />
        </Box>

        {/* Personalized Greeting Text - moves together with sheet and accepts tap/drag */}
        <Box
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={() => {
            if (isCollapsed && Math.abs(dragOffsetY) < 5 && onToggleCollapse) {
              onToggleCollapse();
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: '4px',
            cursor: isCollapsed ? 'pointer' : 'grab',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          <Typography
            sx={{
              fontSize: "14px",
              color: "#0F172A",
              fontWeight: 400,
              lineHeight: 1.4,
              fontFamily: "Poppins, sans-serif",
            }}
          >
            {language === "tl" ? `Kamusta, ${firstName}! ` : `Hello, ${firstName}! `}
            <Box component="span" sx={{ fontWeight: 800 }}>
              {language === "tl" ? "Saan tayo pupunta?" : "Where are we going?"}
            </Box>
          </Typography>
        </Box>

        {/* Horizontal Action Cards Scrollable Row */}
        <Box
          className="hide-scrollbar"
          sx={{
            display: "flex",
            gap: "12px",
            overflowX: "auto",
            paddingBottom: "4px",
            width: "100%",
            opacity: isCollapsed ? 0.4 : 1,
            transition: "opacity 0.2s ease",
            pointerEvents: isCollapsed ? "none" : "auto",
          }}
        >
            {/* Card 1: Bagong Trip (Primary New Trip Action) */}
            <Box
              onClick={onStartNewTrip}
              role="button"
              tabIndex={0}
              sx={{
                flexShrink: 0,
                width: "130px",
                height: "130px",
                backgroundColor: "#FFF7ED",
                border: "1px solid #FFEDD5",
                borderRadius: "22px",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: "pointer",
                transition: "all 0.2s ease-in-out",
                "&:hover": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 8px 20px rgba(255, 107, 0, 0.14)",
                },
                "&:active": {
                  transform: "scale(0.97)",
                },
              }}
            >
              <Box
                sx={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  backgroundColor: "#FF6B00",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 10px rgba(255, 107, 0, 0.25)",
                }}
              >
                <LocationOnIcon sx={{ color: "#FFFFFF", fontSize: "22px" }} />
              </Box>

              <Box>
                <Typography
                  sx={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "#0F172A",
                    lineHeight: 1.2,
                    fontFamily: "Poppins, sans-serif",
                    letterSpacing: "-0.2px",
                  }}
                >
                  {language === "tl" ? "Bagong Trip" : "New Trip"}
                </Typography>
                <Typography
                  sx={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#64748B",
                    marginTop: "2px",
                    fontFamily: "Poppins, sans-serif",
                  }}
                >
                  {language === "tl" ? "Umpisahan" : "Get started"}
                </Typography>
              </Box>
            </Box>

            {/* Card 2: Home (Destination Shortcut) */}
            <Box
              onClick={() => {
                if (!homeAddress || homeAddress.trim().length === 0) {
                  setEditingPlaceId("home");
                  setPlaceName(language === "tl" ? "Bahay" : "Home");
                  setPlaceAddress("");
                  setAddressSearchQuery("");
                  setModalOpen(true);
                } else {
                  onHomeTrip();
                }
              }}
              role="button"
              tabIndex={0}
              sx={{
                flexShrink: 0,
                width: "130px",
                height: "130px",
                backgroundColor: "#F4FBF7",
                border: "1px solid #E2E8F0",
                borderRadius: "22px",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: "pointer",
                position: "relative",
                transition: "all 0.2s ease-in-out",
                "&:hover": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
                },
                "&:active": {
                  transform: "scale(0.97)",
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Box
                  sx={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "12px",
                    backgroundColor: "rgba(15, 23, 42, 0.04)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <HomeOutlinedIcon sx={{ color: "#0F172A", fontSize: "22px" }} />
                </Box>
                <IconButton
                  size="small"
                  onClick={handleOpenEditHome}
                  sx={{ color: '#64748B', p: '4px' }}
                >
                  <EditOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>

              <Box>
                <Typography
                  sx={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "#0F172A",
                    lineHeight: 1.2,
                    fontFamily: "Poppins, sans-serif",
                    letterSpacing: "-0.2px",
                  }}
                >
                  {language === "tl" ? "Bahay" : "Home"}
                </Typography>
                <Typography
                  sx={{
                    fontSize: "12px",
                    fontWeight: (!homeAddress || homeAddress.trim().length === 0) ? 700 : 500,
                    color: (!homeAddress || homeAddress.trim().length === 0) ? "#FF6B00" : "#64748B",
                    marginTop: "2px",
                    fontFamily: "Poppins, sans-serif",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayHomeSubtext}
                </Typography>
              </Box>
            </Box>

            {/* Custom Saved Places Cards */}
            {savedPlaces.map((place) => (
              <Box
                key={place.id}
                onClick={() => {
                  if (onSelectPlaceTrip) {
                    onSelectPlaceTrip({ address: place.address, lat: place.lat, lng: place.lng });
                  } else {
                    onStartNewTrip();
                  }
                }}
                role="button"
                tabIndex={0}
                sx={{
                  flexShrink: 0,
                  width: "130px",
                  height: "130px",
                  backgroundColor: "#F4FBF7",
                  border: "1px solid #E2E8F0",
                  borderRadius: "22px",
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "all 0.2s ease-in-out",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
                  },
                  "&:active": {
                    transform: "scale(0.97)",
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <Box
                    sx={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "12px",
                      backgroundColor: "rgba(15, 23, 42, 0.04)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <PlaceOutlinedIcon sx={{ color: "#0F172A", fontSize: "22px" }} />
                  </Box>
                  <IconButton
                    size="small"
                    onClick={(e) => handleOpenEditPlace(e, place)}
                    sx={{ color: '#64748B', p: '4px' }}
                  >
                    <EditOutlinedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>

                <Box>
                  <Typography
                    sx={{
                      fontSize: "14px",
                      fontWeight: 800,
                      color: "#0F172A",
                      lineHeight: 1.2,
                      fontFamily: "Poppins, sans-serif",
                      letterSpacing: "-0.2px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {place.name}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "#64748B",
                      marginTop: "2px",
                      fontFamily: "Poppins, sans-serif",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {place.address}
                  </Typography>
                </Box>
              </Box>
            ))}

            {/* Card 3: Magdagdag (Add Saved Location Action) */}
            <Box
              onClick={handleOpenAddModal}
              role="button"
              tabIndex={0}
              sx={{
                flexShrink: 0,
                width: "130px",
                height: "130px",
                backgroundColor: "#F4FBF7",
                border: "1px solid #E2E8F0",
                borderRadius: "22px",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: "pointer",
                transition: "all 0.2s ease-in-out",
                "&:hover": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
                },
                "&:active": {
                  transform: "scale(0.97)",
                },
              }}
            >
              <Box
                sx={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  backgroundColor: "rgba(15, 23, 42, 0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AddIcon sx={{ color: "#0F172A", fontSize: "24px" }} />
              </Box>

              <Box>
                <Typography
                  sx={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "#0F172A",
                    lineHeight: 1.2,
                    fontFamily: "Poppins, sans-serif",
                    whiteSpace: "nowrap",
                    letterSpacing: "-0.2px",
                  }}
                >
                  {language === "tl" ? "Magdagdag" : "Add Place"}
                </Typography>
                <Typography
                  sx={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#64748B",
                    marginTop: "2px",
                    fontFamily: "Poppins, sans-serif",
                  }}
                >
                  {language === "tl" ? "Bagong lugar" : "New location"}
                </Typography>
              </Box>
            </Box>
          </Box>
      </Paper>

      {/* UNIFIED SAVED PLACE CREATION & EDITING MODAL */}
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        slotProps={{
          paper: {
            sx: { borderRadius: '20px', padding: '12px', maxWidth: '370px', width: '92%' },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '18px', color: '#0F172A', fontFamily: 'Poppins, sans-serif', pb: 1 }}>
          {editingPlaceId
            ? (language === 'tl' ? 'I-edit ang Lugar' : 'Edit Saved Location')
            : (language === 'tl' ? 'Magdagdag ng Lugar' : 'Add Saved Location')}
        </DialogTitle>
        <DialogContent sx={{ py: 1 }}>
          {/* Field 1: Pangalan ng Lugar */}
          <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#475569', mb: 0.5, fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Pangalan ng Lugar' : 'Place Name'}
          </Typography>
          <TextField
            fullWidth
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            placeholder={language === 'tl' ? 'Hal. Bahay, Paaralan, Trabaho' : 'e.g. Home, School, Work'}
            variant="outlined"
            size="small"
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': { borderRadius: '12px', fontSize: '14px' },
            }}
          />

          {/* Field 2: Lokasyon with Clear Two-Way Entry: Option A vs Option B */}
          <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#475569', mb: 0.5, fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Lokasyon' : 'Location'}
          </Typography>

          {/* Option A: Search / type address */}
          <TextField
            fullWidth
            value={addressSearchQuery}
            onChange={(e) => {
              setAddressSearchQuery(e.target.value);
              setPlaceAddress(e.target.value);
            }}
            placeholder={language === 'tl' ? 'Ilagay ang address o landmark' : 'Enter address or landmark'}
            variant="outlined"
            size="small"
            sx={{
              mb: 1,
              '& .MuiOutlinedInput-root': { borderRadius: '12px', fontSize: '14px' },
            }}
          />

          {/* Search Autocomplete Suggestions */}
          {suggestions.length > 0 && (
            <Paper elevation={2} sx={{ borderRadius: '12px', maxHeight: '140px', overflowY: 'auto', mb: 2 }}>
              <List dense disablePadding>
                {suggestions.map((s, idx) => (
                  <ListItem
                    key={idx}
                    component="div"
                    onClick={() => handleSelectSuggestion(s)}
                    sx={{ cursor: 'pointer', '&:hover': { backgroundColor: '#FFF7ED' } }}
                  >
                    <ListItemText
                      primary={<Typography sx={{ fontSize: '14px', fontWeight: 600 }}>{s.name || s.address}</Typography>}
                      secondary={<Typography sx={{ fontSize: '12px', color: '#64748B' }}>{s.address}</Typography>}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}

          {/* Divider "o" / "or" */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, my: 1.5 }}>
            <Divider sx={{ flex: 1, borderColor: '#E2E8F0' }} />
            <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#94A3B8' }}>
              {language === 'tl' ? 'o' : 'or'}
            </Typography>
            <Divider sx={{ flex: 1, borderColor: '#E2E8F0' }} />
          </Box>

          {/* Option B: Pumili sa Mapa (Opens dedicated MapLocationPicker overlay) */}
          <Button
            fullWidth
            variant="outlined"
            startIcon={<MapOutlinedIcon sx={{ color: '#FF6B00' }} />}
            onClick={() => {
              setModalOpen(false);
              setMapPickerOpen(true);
            }}
            sx={{
              borderColor: '#E2E8F0',
              color: '#0F172A',
              textTransform: 'none',
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: 600,
              py: '8px',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
            }}
          >
            {language === 'tl' ? 'Pumili sa Mapa' : 'Select on Map'}
          </Button>
        </DialogContent>

        <DialogActions sx={{ px: 2, pb: 2, pt: 1, display: 'flex', gap: '8px' }}>
          <Button onClick={() => setModalOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontFamily: 'Poppins, sans-serif', width: '50%', fontSize: '14px' }}>
            {language === 'tl' ? 'Kanselahin' : 'Cancel'}
          </Button>
          <Button
            onClick={handleSavePlace}
            variant="contained"
            sx={{
              width: '50%',
              backgroundColor: '#FF6B00',
              textTransform: 'none',
              borderRadius: '12px',
              fontWeight: 700,
              fontSize: '14px',
              fontFamily: 'Poppins, sans-serif',
              boxShadow: 'none',
              '&:hover': { backgroundColor: '#E66000', boxShadow: 'none' },
            }}
          >
            {language === 'tl' ? 'I-save' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* DEDICATED MAP LOCATION PICKER OVERLAY */}
      <MapLocationPicker
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        initialCoords={placeCoords}
        onConfirmLocation={handleConfirmMapLocation}
      />

      {/* Transient Validation Toast */}
      <Snackbar
        open={Boolean(toastMessage)}
        autoHideDuration={4000}
        onClose={() => setToastMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setToastMessage(null)} severity="warning" sx={{ width: '100%', borderRadius: '12px', fontWeight: 600 }}>
          {toastMessage}
        </Alert>
      </Snackbar>
    </>
  );
};

export default HomeBottomSheet;

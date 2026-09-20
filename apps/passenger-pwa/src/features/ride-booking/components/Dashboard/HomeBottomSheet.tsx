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
import LocationOnIcon from "@mui/icons-material/LocationOn";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";

import { useLanguage } from "../../../../utils/LanguageContext";
import { searchPlaces } from "../../../../services/locationService";
import type { PlaceSuggestion } from "../../../../services/locationService";

export interface SavedPlace {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
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
}

const HomeBottomSheet: React.FC<HomeBottomSheetProps> = ({
  firstName,
  onStartNewTrip,
  onHomeTrip,
  onSelectPlaceTrip,
  onAddPlace,
  isCollapsed = false,
  onToggleCollapse,
  homeAddress = "",
  onSetHomeAddress,
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

  // Modal States
  const [editHomeOpen, setEditHomeOpen] = useState(false);
  const [inputHome, setInputHome] = useState(homeAddress);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceAddress, setNewPlaceAddress] = useState("");
  const [newPlaceCoords, setNewPlaceCoords] = useState<{ lat: number; lng: number }>({ lat: 13.4124, lng: 121.1834 });
  const [addressSearchQuery, setAddressSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  // Transient Toast Validation State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Real-time gesture tracking states for continuous finger drag
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartTimeRef = useRef<number>(0);

  // Debounced search for Add Location address input
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

    if (!isCollapsed && deltaY < 0) {
      setDragOffsetY(deltaY * 0.25);
    } else if (isCollapsed && deltaY > 0) {
      setDragOffsetY(deltaY * 0.25);
    } else {
      setDragOffsetY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (touchStartY === null) return;
    const dragDuration = Date.now() - dragStartTimeRef.current;
    const isFlick = dragDuration < 250 && Math.abs(dragOffsetY) > 20;

    if (!isCollapsed) {
      if (dragOffsetY > 45 || (isFlick && dragOffsetY > 0)) {
        if (onToggleCollapse) onToggleCollapse();
      }
    } else {
      if (dragOffsetY < -45 || (isFlick && dragOffsetY < 0)) {
        if (onToggleCollapse) onToggleCollapse();
      }
    }

    setTouchStartY(null);
    setDragOffsetY(0);
    setIsDragging(false);
  };

  const handleSaveHome = () => {
    if (!inputHome.trim()) {
      setToastMessage(language === "tl" ? "Hindi pa kumpleto ang impormasyon." : "Information is incomplete.");
      return;
    }
    if (onSetHomeAddress) {
      onSetHomeAddress(inputHome.trim());
    }
    setEditHomeOpen(false);
  };

  const handleSaveNewPlace = () => {
    if (!newPlaceName.trim() || (!newPlaceAddress.trim() && !addressSearchQuery.trim())) {
      setToastMessage(language === "tl" ? "Hindi pa kumpleto ang impormasyon." : "Information is incomplete.");
      return;
    }

    const resolvedAddress = newPlaceAddress.trim() || addressSearchQuery.trim() || "Calapan City";
    const newPlace: SavedPlace = {
      id: `place_${Date.now()}`,
      name: newPlaceName.trim(),
      address: resolvedAddress,
      lat: newPlaceCoords.lat,
      lng: newPlaceCoords.lng,
    };

    const updated = [...savedPlaces, newPlace];
    setSavedPlaces(updated);
    try {
      localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(updated));
    } catch {}

    setAddModalOpen(false);
    setNewPlaceName("");
    setNewPlaceAddress("");
    setAddressSearchQuery("");
  };

  const handleSelectSuggestion = (s: PlaceSuggestion) => {
    setNewPlaceAddress(s.address);
    setAddressSearchQuery(s.address);
    setNewPlaceCoords({ lat: s.lat, lng: s.lng });
    setSuggestions([]);
  };

  const displayHomeSubtext = homeAddress && homeAddress.trim().length > 0
    ? homeAddress
    : (language === "tl" ? "I-set na" : "Set Now");

  return (
    <>
      <Paper
        elevation={4}
        sx={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "#F4FBF7", // Soft mint background
          borderTopLeftRadius: "28px",
          borderTopRightRadius: "28px",
          padding: "10px 20px calc(var(--safe-area-bottom) + 16px) 20px",
          zIndex: 10,
          boxShadow: "0 -10px 30px rgba(15, 23, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: isCollapsed ? "4px" : "14px",
          transform: `translateY(${dragOffsetY}px)`,
          transition: isDragging ? "none" : "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
        }}
      >
        {/* Drag handle bar with touch gesture listeners */}
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

        {/* Personalized Greeting Text */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: '4px' }}>
          <Typography
            sx={{
              fontSize: "14.5px",
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

        {/* Horizontal Action Cards Scrollable Row (Hidden when Collapsed) */}
        {!isCollapsed && (
          <Box
            className="hide-scrollbar"
            sx={{
              display: "flex",
              gap: "12px",
              overflowX: "auto",
              paddingBottom: "4px",
              width: "100%",
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
                    fontSize: "13px",
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
                    fontSize: "11.5px",
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
                  setInputHome(homeAddress);
                  setEditHomeOpen(true);
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setInputHome(homeAddress);
                    setEditHomeOpen(true);
                  }}
                  sx={{ color: '#64748B', p: '4px' }}
                >
                  <EditOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>

              <Box>
                <Typography
                  sx={{
                    fontSize: "13px",
                    fontWeight: 800,
                    color: "#0F172A",
                    lineHeight: 1.2,
                    fontFamily: "Poppins, sans-serif",
                    letterSpacing: "-0.2px",
                  }}
                >
                  Home
                </Typography>
                <Typography
                  sx={{
                    fontSize: "11px",
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

            {/* Custom Saved Places Cards (Same component structure, typography & destination shortcut behavior) */}
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

                <Box>
                  <Typography
                    sx={{
                      fontSize: "13px",
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
                      fontSize: "11px",
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
              onClick={() => {
                setNewPlaceName("");
                setNewPlaceAddress("");
                setAddressSearchQuery("");
                setAddModalOpen(true);
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
                    fontSize: "13px",
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
                    fontSize: "11px",
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
        )}
      </Paper>

      {/* Dialog 1: Set Home Address */}
      <Dialog
        open={editHomeOpen}
        onClose={() => setEditHomeOpen(false)}
        slotProps={{
          paper: {
            sx: { borderRadius: '20px', padding: '8px', maxWidth: '360px', width: '100%' },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
          {language === 'tl' ? 'I-set ang Home Location' : 'Set Home Location'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '12.5px', color: '#64748B', mb: 2, fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Ilagay ang address ng iyong tirahan para sa mabilis na pag-book.'
              : 'Enter your home address for quick booking.'}
          </Typography>
          <TextField
            fullWidth
            label={language === 'tl' ? 'Home Address' : 'Home Address'}
            value={inputHome}
            onChange={(e) => setInputHome(e.target.value)}
            placeholder="e.g. San Vicente, Calapan City"
            variant="outlined"
            sx={{
              '& .MuiOutlinedInput-root': { borderRadius: '12px' },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditHomeOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Kanselahin' : 'Cancel'}
          </Button>
          <Button
            onClick={handleSaveHome}
            variant="contained"
            sx={{
              backgroundColor: '#FF6B00',
              textTransform: 'none',
              borderRadius: '12px',
              fontWeight: 700,
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            {language === 'tl' ? 'I-save' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog 2: Magdagdag ng Lugar (Add Saved Location Flow) */}
      <Dialog
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        slotProps={{
          paper: {
            sx: { borderRadius: '20px', padding: '12px', maxWidth: '370px', width: '92%' },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A', fontFamily: 'Poppins, sans-serif', pb: 1 }}>
          {language === 'tl' ? 'Magdagdag ng Lugar' : 'Add Saved Location'}
        </DialogTitle>
        <DialogContent sx={{ py: 1 }}>
          <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#475569', mb: 0.5, fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Pangalan ng Lugar' : 'Place Name'}
          </Typography>
          <TextField
            fullWidth
            value={newPlaceName}
            onChange={(e) => setNewPlaceName(e.target.value)}
            placeholder={language === 'tl' ? 'e.g. Work, School, Palengke, Lola’s House' : 'e.g. Work, School, Market'}
            variant="outlined"
            size="small"
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': { borderRadius: '12px', fontSize: '13px' },
            }}
          />

          <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#475569', mb: 0.5, fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Lokasyon (Address / Landmark)' : 'Location (Address / Landmark)'}
          </Typography>
          <TextField
            fullWidth
            value={addressSearchQuery}
            onChange={(e) => {
              setAddressSearchQuery(e.target.value);
              setNewPlaceAddress(e.target.value);
            }}
            placeholder={language === 'tl' ? 'Ilagay ang address o landmark' : 'Enter address or landmark'}
            variant="outlined"
            size="small"
            sx={{
              mb: 1,
              '& .MuiOutlinedInput-root': { borderRadius: '12px', fontSize: '13px' },
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
                      primary={<Typography sx={{ fontSize: '12px', fontWeight: 600 }}>{s.name || s.address}</Typography>}
                      secondary={<Typography sx={{ fontSize: '10.5px', color: '#64748B' }}>{s.address}</Typography>}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}

          {/* Map Pin Option Button */}
          <Button
            fullWidth
            variant="outlined"
            startIcon={<MapOutlinedIcon sx={{ color: '#FF6B00' }} />}
            onClick={() => {
              setAddModalOpen(false);
              onAddPlace();
            }}
            sx={{
              mt: 1,
              borderColor: '#E2E8F0',
              color: '#0F172A',
              textTransform: 'none',
              borderRadius: '12px',
              fontSize: '12.5px',
              fontWeight: 600,
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
            }}
          >
            {language === 'tl' ? 'Pumili sa Mapa' : 'Select on Map'}
          </Button>
        </DialogContent>

        <DialogActions sx={{ px: 2, pb: 2, pt: 1, display: 'flex', gap: '8px' }}>
          <Button onClick={() => setAddModalOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontFamily: 'Poppins, sans-serif', width: '50%' }}>
            {language === 'tl' ? 'Kanselahin' : 'Cancel'}
          </Button>
          <Button
            onClick={handleSaveNewPlace}
            variant="contained"
            sx={{
              width: '50%',
              backgroundColor: '#FF6B00',
              textTransform: 'none',
              borderRadius: '12px',
              fontWeight: 700,
              fontSize: '13px',
              fontFamily: 'Poppins, sans-serif',
              boxShadow: 'none',
              '&:hover': { backgroundColor: '#E66000', boxShadow: 'none' },
            }}
          >
            {language === 'tl' ? 'I-save ang Lugar' : 'Save Location'}
          </Button>
        </DialogActions>
      </Dialog>

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

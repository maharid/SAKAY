import React, { useState, useRef, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Button from "@mui/material/Button";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import WorkOutlinedIcon from "@mui/icons-material/WorkOutlined";
import SchoolOutlinedIcon from "@mui/icons-material/SchoolOutlined";
import FavoriteBorderOutlinedIcon from "@mui/icons-material/FavoriteBorderOutlined";

import { useLanguage } from "../../../../utils/LanguageContext";
import SakayToast from "../../../../common/components/SakayToast";
import SavedPlaceModal from "../../../account-management/components/SavedPlaceModal";
import type { SavedPlaceItem } from "../../../account-management/components/SavedPlaceModal";

export type SavedPlace = SavedPlaceItem & { isHome?: boolean };

interface HomeBottomSheetProps {
  firstName: string;
  onStartNewTrip: () => void;
  onHomeTrip?: () => void;
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
const MIN_SHEET_HEIGHT = 72;
const MAX_TRANSLATE = MAX_SHEET_HEIGHT - MIN_SHEET_HEIGHT; // 148px

const HomeBottomSheet: React.FC<HomeBottomSheetProps> = ({
  firstName,
  onStartNewTrip,
  onSelectPlaceTrip,
  isCollapsed = false,
  onToggleCollapse,
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
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);

  // Long press & Action Dialog State for Saved Places
  const [actionPlace, setActionPlace] = useState<SavedPlace | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState<boolean>(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStartPlace = (place: SavedPlace) => {
    longPressTimerRef.current = setTimeout(() => {
      setActionPlace(place);
      setActionDialogOpen(true);
    }, 500);
  };

  const handleTouchEndPlace = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleDeletePlace = (placeId: string) => {
    const updated = savedPlaces.filter((p) => p.id !== placeId);
    setSavedPlaces(updated);
    try {
      localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(updated));
    } catch {}
    setToastMessage(language === "tl" ? "Matagumpay na nabura ang lugar." : "Saved place deleted.");
    setActionDialogOpen(false);
  };

  const renderPlaceIcon = (iconKey?: string) => {
    switch (iconKey) {
      case "home":
        return <HomeOutlinedIcon sx={{ color: "#0F172A", fontSize: "22px" }} />;
      case "work":
        return <WorkOutlinedIcon sx={{ color: "#0F172A", fontSize: "22px" }} />;
      case "school":
        return <SchoolOutlinedIcon sx={{ color: "#0F172A", fontSize: "22px" }} />;
      case "favorite":
        return <FavoriteBorderOutlinedIcon sx={{ color: "#0F172A", fontSize: "22px" }} />;
      default:
        return <PlaceOutlinedIcon sx={{ color: "#0F172A", fontSize: "22px" }} />;
    }
  };

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
    setEditingPlace(null);
    setModalOpen(true);
  };

  // Open Unified Modal for Editing a Saved Place
  const handleOpenEditPlace = (e: React.MouseEvent, place: SavedPlace) => {
    e.stopPropagation();
    setEditingPlace(place);
    setModalOpen(true);
  };

  // Save Handler for Unified Modal
  const handleSavePlace = (data: { id?: string; name: string; address: string; lat: number; lng: number; icon: string }) => {
    if (data.id) {
      const updated = savedPlaces.map((p) =>
        p.id === data.id
          ? { ...p, name: data.name, address: data.address, lat: data.lat, lng: data.lng, icon: data.icon }
          : p
      );
      setSavedPlaces(updated);
      try {
        localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(updated));
      } catch {}
    } else {
      const newPlace: SavedPlace = {
        id: `place_${Date.now()}`,
        name: data.name,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        icon: data.icon,
      };
      const updated = [...savedPlaces, newPlace];
      setSavedPlaces(updated);
      try {
        localStorage.setItem("sakay_passenger_saved_places", JSON.stringify(updated));
      } catch {}
    }
  };

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
                flex: "1 1 0px",
                minWidth: "130px",
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

            {/* Custom Saved Places Cards */}
            {savedPlaces.map((place) => (
              <Box
                key={place.id}
                onTouchStart={() => handleTouchStartPlace(place)}
                onTouchEnd={handleTouchEndPlace}
                onMouseDown={() => handleTouchStartPlace(place)}
                onMouseUp={handleTouchEndPlace}
                onMouseLeave={handleTouchEndPlace}
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
                  flex: "1 1 0px",
                  minWidth: "130px",
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
                    {renderPlaceIcon(place.icon)}
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

            {/* Card 2: Magdagdag (Add Saved Location Action) */}
            <Box
              onClick={handleOpenAddModal}
              role="button"
              tabIndex={0}
              sx={{
                flex: "1 1 0px",
                minWidth: "130px",
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

      {/* UNIFIED SAVED PLACE MODAL */}
      <SavedPlaceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialPlace={editingPlace}
        onSave={handleSavePlace}
      />

      {/* Long-Press Action Dialog (Edit & Delete options) */}
      <Dialog
        open={actionDialogOpen}
        onClose={() => setActionDialogOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderRadius: "20px",
              padding: "16px",
              maxWidth: "320px",
              width: "90%",
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: "16px", p: 0, mb: 1, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
          {actionPlace?.name || (language === "tl" ? "Opsyon sa Lugar" : "Place Options")}
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <Button
            fullWidth
            variant="outlined"
            onClick={(e) => {
              if (actionPlace) handleOpenEditPlace(e as any, actionPlace);
              setActionDialogOpen(false);
            }}
            sx={{
              borderRadius: "12px",
              borderColor: "#CBD5E1",
              color: "#0F172A",
              fontWeight: 700,
              textTransform: "none",
              height: "44px",
              justifyContent: "flex-start",
              px: 2,
              fontFamily: "Poppins, sans-serif",
            }}
          >
            ✏️ {language === "tl" ? "I-edit ang Lugar" : "Edit Place"}
          </Button>

          <Button
            fullWidth
            variant="outlined"
            onClick={() => {
              if (actionPlace) handleDeletePlace(actionPlace.id);
            }}
            sx={{
              borderRadius: "12px",
              borderColor: "#FCA5A5",
              color: "#EF4444",
              fontWeight: 700,
              textTransform: "none",
              height: "44px",
              justifyContent: "flex-start",
              px: 2,
              fontFamily: "Poppins, sans-serif",
              "&:hover": { backgroundColor: "#FEF2F2", borderColor: "#EF4444" },
            }}
          >
            🗑️ {language === "tl" ? "Burahin ang Lugar" : "Delete Place"}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Transient Validation Toast */}
      <SakayToast
        open={Boolean(toastMessage)}
        message={toastMessage}
        severity="warning"
        onClose={() => setToastMessage(null)}
      />
    </>
  );
};

export default HomeBottomSheet;

import React, { useState } from "react";
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
import LocationOnIcon from "@mui/icons-material/LocationOn";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";

import { useLanguage } from "../../../../utils/LanguageContext";

interface HomeBottomSheetProps {
  firstName: string;
  onStartNewTrip: () => void;
  onHomeTrip: () => void;
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
  onAddPlace,
  isCollapsed = false,
  onToggleCollapse,
  homeAddress = "",
  onSetHomeAddress,
}) => {
  const { language } = useLanguage();
  const [editHomeOpen, setEditHomeOpen] = useState(false);
  const [inputHome, setInputHome] = useState(homeAddress);

  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return;
    const diffY = e.changedTouches[0].clientY - touchStartY;
    if (diffY > 30) {
      if (onToggleCollapse && !isCollapsed) onToggleCollapse();
    } else if (diffY < -30) {
      if (onToggleCollapse && isCollapsed) onToggleCollapse();
    } else if (Math.abs(diffY) < 5) {
      if (onToggleCollapse) onToggleCollapse();
    }
    setTouchStartY(null);
  };

  const handleSaveHome = () => {
    if (inputHome.trim() && onSetHomeAddress) {
      onSetHomeAddress(inputHome.trim());
    }
    setEditHomeOpen(false);
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
          backgroundColor: "#F4FBF7", // Soft mint background matching reference UI
          borderTopLeftRadius: "28px",
          borderTopRightRadius: "28px",
          padding: "10px 20px calc(var(--safe-area-bottom) + 16px) 20px",
          zIndex: 10,
          boxShadow: "0 -10px 30px rgba(15, 23, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: isCollapsed ? "4px" : "14px",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Drag handle bar (Life360 style draggable bottom sheet) */}
        <Box
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={onToggleCollapse}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "grab",
            py: 0.75,
            width: "100%",
            userSelect: "none",
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
              fontSize: "15px",
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
                width: "135px",
                height: "135px",
                backgroundColor: "#FFF7ED", // Warm cream peach tint
                border: "1px solid #FFEDD5",
                borderRadius: "24px",
                padding: "16px",
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
                  width: "44px",
                  height: "44px",
                  borderRadius: "14px",
                  backgroundColor: "#FF6B00",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 10px rgba(255, 107, 0, 0.25)",
                }}
              >
                <LocationOnIcon sx={{ color: "#FFFFFF", fontSize: "24px" }} />
              </Box>

              <Box>
                <Typography
                  sx={{
                    fontSize: "13.5px",
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

            {/* Card 2: Home (Set Now or Saved Address) */}
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
                width: "135px",
                height: "135px",
                backgroundColor: "#F4FBF7",
                border: "1px solid #E2E8F0",
                borderRadius: "24px",
                padding: "16px",
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
                    width: "44px",
                    height: "44px",
                    borderRadius: "14px",
                    backgroundColor: "rgba(15, 23, 42, 0.04)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <HomeOutlinedIcon sx={{ color: "#0F172A", fontSize: "24px" }} />
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
                    fontSize: "13.5px",
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
                    fontSize: "11.5px",
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

            {/* Card 3: Magdagdag (Add Custom Saved Place - Single Line!) */}
            <Box
              onClick={onAddPlace}
              role="button"
              tabIndex={0}
              sx={{
                flexShrink: 0,
                width: "135px",
                height: "135px",
                backgroundColor: "#F4FBF7",
                border: "1px solid #E2E8F0",
                borderRadius: "24px",
                padding: "16px",
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
                  width: "44px",
                  height: "44px",
                  borderRadius: "14px",
                  backgroundColor: "rgba(15, 23, 42, 0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AddIcon sx={{ color: "#0F172A", fontSize: "26px" }} />
              </Box>

              <Box>
                <Typography
                  sx={{
                    fontSize: "13.5px",
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
        )}
      </Paper>

      {/* Dialog for Manually Setting Home Location */}
      <Dialog
        open={editHomeOpen}
        onClose={() => setEditHomeOpen(false)}
        slotProps={{
          paper: {
            sx: { borderRadius: '20px', padding: '8px', maxWidth: '360px', width: '100%' },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '18px', color: '#0F172A' }}>
          {language === 'tl' ? 'I-set ang Home Location' : 'Set Home Location'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: '#64748B', mb: 2 }}>
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
          <Button onClick={() => setEditHomeOpen(false)} sx={{ textTransform: 'none', color: '#64748B' }}>
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
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            {language === 'tl' ? 'I-save' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default HomeBottomSheet;

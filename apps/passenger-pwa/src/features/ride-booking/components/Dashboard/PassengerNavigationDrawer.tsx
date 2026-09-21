import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import HeadsetMicIcon from "@mui/icons-material/HeadsetMic";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { useLanguage } from "../../../../utils/LanguageContext";
import LogoutConfirmDialog from "../../../../common/components/LogoutConfirmDialog";

export interface PassengerNavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  profileName: string;
  profilePhoto?: string;
  contactNumber?: string;
  onNavigateNewTrip?: () => void;
  onNavigateProfile?: () => void;
  onOpenTulong?: () => void;
  onLogout: () => void;
}

const PassengerNavigationDrawer: React.FC<PassengerNavigationDrawerProps> = ({
  isOpen,
  onClose,
  profileName,
  profilePhoto,
  onNavigateProfile,
  onLogout,
}) => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = React.useState(false);

  const handleProfileClick = () => {
    onClose();
    if (onNavigateProfile) {
      onNavigateProfile();
    } else {
      navigate("/profile");
    }
  };

  const handleNavigate = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <>
      {/* Dark translucent overlay backdrop constrained to mobile viewport */}
      <Box
        onClick={onClose}
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.4)",
          backdropFilter: "blur(2px)",
          zIndex: 1000,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      />

      {/* Slide-out Mobile Navigation Drawer constrained inside mobile viewport */}
      <Box
        className="hide-scrollbar"
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: "78%",
          maxWidth: "310px",
          backgroundColor: "#FFFFFF",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          boxShadow: "8px 0 32px rgba(15, 23, 42, 0.2)",
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          overflowY: "auto",
        }}
      >
        {/* Top Header Card matching SIDEBAR MENU.png (Vibrant Orange Header respecting safe area) */}
        <Box
          onClick={handleProfileClick}
          sx={{
            background: "linear-gradient(135deg, #FF6B00 0%, #FF8533 100%)",
            padding: "calc(var(--safe-area-top) + 20px) 20px 20px 20px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            cursor: "pointer",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Avatar Circle */}
          <Avatar
            src={profilePhoto || undefined}
            sx={{
              width: "52px",
              height: "52px",
              backgroundColor: "#FFFFFF",
              color: "#FF6B00",
              fontWeight: 800,
              fontSize: "19px",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
              border: "2px solid #FFFFFF",
            }}
          >
            {profileName ? profileName.charAt(0).toUpperCase() : "P"}
          </Avatar>

          {/* User Name & Arrow */}
          <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Typography
              sx={{
                fontSize: "17px",
                fontWeight: 800,
                color: "#FFFFFF",
                letterSpacing: "-0.2px",
                fontFamily: "Poppins, sans-serif",
              }}
            >
              {profileName || (language === "tl" ? "Pasahero" : "Passenger")}
            </Typography>
            <ArrowForwardIcon sx={{ color: "#FFFFFF", fontSize: "18px" }} />
          </Box>
        </Box>

        {/* Menu Items List */}
        <List disablePadding sx={{ flexGrow: 1, paddingTop: "6px" }}>
          {/* Item 1: History */}
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => handleNavigate("/history")}
              sx={{
                padding: "14px 22px",
                "&:hover": { backgroundColor: "#FFF7ED" },
              }}
            >
              <ListItemIcon sx={{ color: "#0F172A", minWidth: "40px" }}>
                <AccessTimeIcon sx={{ fontSize: "21px" }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    sx={{ fontSize: "15px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}
                  >
                    {language === "tl" ? "Kasaysayan (History)" : "History"}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ borderColor: "#F1F5F9", marginX: "22px" }} />

          {/* Item 2: Nai-save na Lugar */}
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => handleNavigate("/saved-places")}
              sx={{
                padding: "14px 22px",
                "&:hover": { backgroundColor: "#FFF7ED" },
              }}
            >
              <ListItemIcon sx={{ color: "#0F172A", minWidth: "40px" }}>
                <BookmarkBorderIcon sx={{ fontSize: "21px" }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    sx={{ fontSize: "15px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}
                  >
                    {language === "tl" ? "Nai-save na Lugar" : "Saved Places"}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ borderColor: "#F1F5F9", marginX: "22px" }} />

          {/* Item 3: Support */}
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => handleNavigate("/support")}
              sx={{
                padding: "14px 22px",
                "&:hover": { backgroundColor: "#FFF7ED" },
              }}
            >
              <ListItemIcon sx={{ color: "#0F172A", minWidth: "40px" }}>
                <HeadsetMicIcon sx={{ fontSize: "21px" }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    sx={{ fontSize: "15px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}
                  >
                    {language === "tl" ? "Tulong at Suporta" : "Support"}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ borderColor: "#F1F5F9", marginX: "22px" }} />

          {/* Item 6: Settings */}
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => handleNavigate("/settings")}
              sx={{
                padding: "14px 22px",
                "&:hover": { backgroundColor: "#FFF7ED" },
              }}
            >
              <ListItemIcon sx={{ color: "#0F172A", minWidth: "40px" }}>
                <SettingsOutlinedIcon sx={{ fontSize: "21px" }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    sx={{ fontSize: "15px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}
                  >
                    {language === "tl" ? "Mga Setting" : "Settings"}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ borderColor: "#F1F5F9", marginX: "22px" }} />
        </List>

        {/* Bottom Item: Logout */}
        <Box sx={{ paddingBottom: "calc(var(--safe-area-bottom) + 16px)" }}>
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => setLogoutConfirmOpen(true)}
              sx={{
                padding: "14px 22px",
                "&:hover": { backgroundColor: "#FEF2F2" },
              }}
            >
              <ListItemIcon sx={{ color: "#EF4444", minWidth: "40px" }}>
                <ExitToAppIcon sx={{ fontSize: "21px", color: "#EF4444" }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    sx={{ fontSize: "15px", fontWeight: 700, color: "#EF4444", fontFamily: "Poppins, sans-serif" }}
                  >
                    {language === "tl" ? "Mag-logout" : "Log out"}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
        </Box>
      </Box>

      {/* Logout Confirmation Dialog */}
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          onClose();
          onLogout();
        }}
      />
    </>
  );
};

export default PassengerNavigationDrawer;

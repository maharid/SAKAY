import React, { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { DRIVER_CANCEL_REASONS, type DriverCancelReason, activateWithKeyboard } from "@sakay/shared";
import { useLanguage } from "../../utils/LanguageContext";

export interface DriverCancelModalProps {
  open: boolean;
  onClose: () => void;
  /** The reason CODE is what the database records (Rules 12.3 / 12.4); the text is what the driver read. */
  onConfirmCancel: (reasonCode: DriverCancelReason, reasonText: string) => void | Promise<void>;
  language?: "tl" | "en";
  loading?: boolean;
}

const CANCEL_LABELS: Record<DriverCancelReason, { tl: string; en: string }> = {
  vehicle_breakdown: { tl: "Nasiraan ng sasakyan", en: "Vehicle breakdown / technical issue" },
  personal_emergency: { tl: "Dahilang pangkagipitan", en: "Personal emergency" },
  passenger_unreachable: { tl: "Hindi maabot ang pasahero", en: "Passenger unreachable" },
  wrong_pickup_location: { tl: "Mali o hindi maabot ang pickup", en: "Wrong or unreachable pickup location" },
  safety_concern: { tl: "Alalahanin sa kaligtasan", en: "Safety concern" },
  road_closure_or_traffic: { tl: "Trapik o sarado ang daan", en: "Heavy traffic or road closure" },
  other: { tl: "Iba pa", en: "Other reason" },
};

// The choices are exactly the reasons the database accepts (the drift test checks the list).
const DRIVER_CANCEL_OPTIONS = DRIVER_CANCEL_REASONS.map((id) => ({ id, ...CANCEL_LABELS[id] }));

/**
 * DriverCancelModal - Aesthetic cancel booking modal for Driver PWA
 * Features balanced typography sizing, smooth option highlights, and Apple/SAKAY styling.
 */
export const DriverCancelModal: React.FC<DriverCancelModalProps> = ({
  open,
  onClose,
  onConfirmCancel,
  language: propLanguage,
  loading = false,
}) => {
  const { language: contextLanguage } = useLanguage();
  const effectiveLanguage = propLanguage || contextLanguage || "tl";

  const [selectedOptionId, setSelectedOptionId] = useState<DriverCancelReason>(DRIVER_CANCEL_REASONS[0]);

  if (!open) return null;

  const handleConfirm = async () => {
    const selected = DRIVER_CANCEL_OPTIONS.find((opt) => opt.id === selectedOptionId);
    const reasonText = selected
      ? effectiveLanguage === "tl"
        ? selected.tl
        : selected.en
      : "Cancelled by Driver";

    await onConfirmCancel(selectedOptionId, reasonText);
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(6px)",
        zIndex: 2500,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        p: "calc(var(--safe-area-top) + 16px) 16px calc(var(--safe-area-bottom) + 20px) 16px",
        boxSizing: "border-box",
        overflowY: "auto",
        "& > *": { flexShrink: 0 },
        animation: "fadeIn 0.2s ease-out",
      }}
    >
      {/* 1. Top-Left Close Button */}
      <Box sx={{ display: "flex", justifyContent: "flex-start", width: "100%", pt: 0.5 }}>
        <IconButton
          onClick={onClose}
          disabled={loading}
          aria-label="close"
          sx={{
            width: 42,
            height: 42,
            borderRadius: "14px",
            backgroundColor: "#FFFFFF",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            color: "#0F172A",
            border: "1px solid #F1F5F9",
            transition: "all 0.15s ease",
            "&:hover": {
              backgroundColor: "#F8FAFC",
              transform: "scale(1.02)",
            },
            "&:active": {
              transform: "scale(0.96)",
            },
          }}
        >
          <CloseIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      {/* 2. Aesthetic White Reasons Card */}
      <Box
        sx={{
          backgroundColor: "#FFFFFF",
          borderRadius: "24px",
          p: { xs: "22px 18px", sm: "24px 22px" },
          width: "100%",
          maxWidth: "380px",
          mx: "auto",
          my: "auto",
          boxShadow: "0 20px 45px rgba(15, 23, 42, 0.12)",
          border: "1px solid #F1F5F9",
          boxSizing: "border-box",
        }}
      >
        {/* Header Title */}
        <Typography
          sx={{
            fontSize: "17px",
            fontWeight: 700,
            color: "#0F172A",
            textAlign: "center",
            fontFamily: "Poppins, sans-serif",
            mb: "16px",
            letterSpacing: "-0.2px",
          }}
        >
          {effectiveLanguage === "tl" ? "Bakit mo gustong i-cancel?" : "Why do you want to cancel?"}
        </Typography>

        {/* Divider */}
        <Box sx={{ height: "1px", backgroundColor: "#F1F5F9", mb: "12px" }} />

        {/* Radio Options List */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {DRIVER_CANCEL_OPTIONS.map((option) => {
            const isSelected = selectedOptionId === option.id;
            const label = effectiveLanguage === "tl" ? option.tl : option.en;

            return (
              <Box
                key={option.id}
                role="radio"
                tabIndex={0}
                onKeyDown={activateWithKeyboard}
                aria-checked={selectedOptionId === option.id}
                onClick={() => !loading && setSelectedOptionId(option.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  py: "10px",
                  px: "14px",
                  cursor: loading ? "default" : "pointer",
                  userSelect: "none",
                  borderRadius: "14px",
                  backgroundColor: isSelected ? "#FFF7ED" : "#FFFFFF",
                  border: isSelected ? "1.5px solid #FF6600" : "1px solid #F1F5F9",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    backgroundColor: isSelected ? "#FFF7ED" : "#F8FAFC",
                  },
                  "&:active": {
                    transform: loading ? "none" : "scale(0.99)",
                  },
                }}
              >
                {/* Option Text */}
                <Typography
                  sx={{
                    fontSize: "14px",
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? "#0F172A" : "#475569",
                    fontFamily: "Poppins, sans-serif",
                    pr: 1,
                    lineHeight: 1.35,
                  }}
                >
                  {label}
                </Typography>

                {/* Styled Radio Indicator */}
                {isSelected ? (
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: "2px solid #FF6600",
                      backgroundColor: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: "#FF6600",
                      }}
                    />
                  </Box>
                ) : (
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: "2px solid #CBD5E1",
                      backgroundColor: "transparent",
                      flexShrink: 0,
                    }}
                  />
                )}
              </Box>
            );
          })}
        </Box>

        {/* Divider */}
        <Box sx={{ height: "1px", backgroundColor: "#F1F5F9", mt: "14px", mb: "14px" }} />

        {/* Reminder Box */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            p: "10px 12px",
            borderRadius: "12px",
            backgroundColor: "#F8FAFC",
            border: "1px solid #F1F5F9",
            mb: "18px",
          }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 18, color: "#64748B", flexShrink: 0 }} />
          <Typography
            sx={{
              fontSize: "12px",
              color: "#64748B",
              lineHeight: 1.4,
              fontFamily: "Poppins, sans-serif",
            }}
          >
            <Box component="span" sx={{ fontWeight: 700, color: "#475569" }}>
              {effectiveLanguage === "tl" ? "PAALALA:" : "REMINDER:"}
            </Box>{" "}
            {effectiveLanguage === "tl"
              ? "Ang pag-cancel pagkatapos tumanggap ay may strike: 1 kung wala ka pang 50 m na naibiyahe papunta sa pasahero, 2 kung mayroon na. Ibabalik ang booking sa paghahanap ng ibang drayber. Nasa pickup ka na at wala pa ang pasahero? Huwag magkansela: hintayin ang oras, saka pindutin ang \"Hindi sumakay ang pasahero\". Kung nasira ang sasakyan mo, piliin ang \"Nasiraan ng sasakyan\": pansamantala ang strike at maaari itong alisin ng TODA Administrator sa loob ng 48 oras."
              : "Cancelling after you accepted adds a strike: 1 if you have not yet travelled 50 m toward the passenger, 2 if you have. The booking goes back to the search for another driver. Already at the pickup and the passenger has not come? Do not cancel: wait for the timer, then tap \"Passenger did not board\". If your vehicle broke down, choose \"Vehicle breakdown\": that strike is provisional and your TODA Administrator may waive it within 48 hours."}
          </Typography>
        </Box>

        {/* Action Button */}
        <Button
          fullWidth
          onClick={handleConfirm}
          disabled={loading}
          sx={{
            height: "48px",
            borderRadius: "14px",
            backgroundColor: "#FF6600",
            color: "#1A1A1A",
            fontWeight: 700,
            fontSize: "15px",
            textTransform: "none",
            fontFamily: "Poppins, sans-serif",
            boxShadow: "0 4px 14px rgba(255, 102, 0, 0.25)",
            transition: "all 0.15s ease",
            "&:hover": {
              backgroundColor: "#E65C00",
              boxShadow: "0 6px 18px rgba(255, 102, 0, 0.35)",
            },
            "&:active": {
              transform: "scale(0.98)",
            },
            "&.Mui-disabled": {
              backgroundColor: "#FFB380",
              color: "#1A1A1A",
            },
          }}
        >
          {loading ? (
            <CircularProgress size={22} sx={{ color: "#FFFFFF" }} />
          ) : effectiveLanguage === "tl" ? (
            "Ikansela ang biyahe"
          ) : (
            "Cancel trip"
          )}
        </Button>
      </Box>

      {/* Bottom Spacer */}
      <Box sx={{ height: 12 }} />
    </Box>
  );
};

export default DriverCancelModal;

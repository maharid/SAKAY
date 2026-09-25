import React, { useEffect, useState } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";

export interface SakayToastProps {
  open?: boolean;
  message: string | null;
  severity?: "success" | "info" | "warning" | "error";
  onClose: () => void;
  autoHideDuration?: number;
  anchorOrigin?: {
    vertical: "top" | "bottom";
    horizontal: "left" | "center" | "right";
  };
}

export const SakayToast: React.FC<SakayToastProps> = ({
  open = true,
  message,
  severity = "info",
  onClose,
  autoHideDuration = 4000,
  anchorOrigin = { vertical: "top", horizontal: "center" },
}) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (open) {
      setProgress(100);
      const timer = setTimeout(() => {
        setProgress(0);
      }, 50);

      return () => clearTimeout(timer);
    } else {
      setProgress(100);
    }
  }, [open, message, autoHideDuration]);

  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === "clickaway") {
      return;
    }
    onClose();
  };

  if (!message) return null;

  const getBackgroundColor = () => {
    switch (severity) {
      case "success":
        return "#10B981";
      case "warning":
        return "#F59E0B";
      case "error":
        return "#EF4444";
      case "info":
      default:
        return "#FF6B00";
    }
  };

  const getShadowColor = () => {
    switch (severity) {
      case "success":
        return "0 10px 28px rgba(16, 185, 129, 0.35)";
      case "warning":
        return "0 10px 28px rgba(245, 158, 11, 0.35)";
      case "error":
        return "0 10px 28px rgba(239, 68, 68, 0.35)";
      case "info":
      default:
        return "0 10px 28px rgba(255, 107, 0, 0.35)";
    }
  };

  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={handleClose}
      anchorOrigin={anchorOrigin}
      sx={{
        zIndex: 9999,
        width: "calc(100% - 32px)",
        maxWidth: "420px",
        left: "50% !important",
        right: "auto !important",
        transform: "translateX(-50%) !important",
        top: anchorOrigin.vertical === "top" ? "calc(var(--safe-area-top) + 12px) !important" : undefined,
        bottom: anchorOrigin.vertical === "bottom" ? "calc(var(--safe-area-bottom) + 16px) !important" : undefined,
      }}
    >
      <Alert
        severity={severity}
        variant="filled"
        action={
          <IconButton
            size="small"
            aria-label="close"
            color="inherit"
            onClick={onClose}
            sx={{
              p: 0.5,
              ml: 1,
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              borderRadius: "50%",
              "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.3)" },
            }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        }
        sx={{
          width: "100%",
          borderRadius: "16px",
          backgroundColor: `${getBackgroundColor()} !important`,
          color: "#FFFFFF !important",
          fontFamily: "Poppins, sans-serif",
          fontSize: "13.5px",
          fontWeight: 700,
          boxShadow: getShadowColor(),
          position: "relative",
          overflow: "hidden",
          py: 1,
          px: 2,
          alignItems: "center",
          border: "1px solid rgba(255, 255, 255, 0.25)",
          "& .MuiAlert-icon": {
            fontSize: "22px",
            color: "#FFFFFF",
            mr: 1.25,
          },
        }}
      >
        <Box sx={{ pr: 0.5, lineHeight: 1.35 }}>{message}</Box>

        {/* Animated Progress Timer Bar */}
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: "3.5px",
            width: `${progress}%`,
            backgroundColor: "rgba(255, 255, 255, 0.75)",
            borderRadius: "0 999px 999px 0",
            transition: open ? `width ${autoHideDuration}ms linear` : "none",
          }}
        />
      </Alert>
    </Snackbar>
  );
};

export default SakayToast;

import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { TYPOGRAPHY_TOKENS } from "@sakay/shared";

interface PageHeaderProps {
  title: string;
  onBack: () => void;
  rightAction?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  onBack,
  rightAction,
}) => {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        pt: "calc(var(--safe-area-top) + 12px)",
        pb: 1.5,
        px: 2,
        backgroundColor: "#FFFFFF",
        borderBottom: "1px solid #F1F5F9",
        flexShrink: 0,
      }}
    >
      {/* Back Button matching Edit Profile header */}
      <IconButton
        onClick={onBack}
        aria-label="Go back"
        sx={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E2E8F0",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
          color: "#1A1A1A",
          borderRadius: "14px",
          width: "44px",
          height: "44px",
          "&:hover": { backgroundColor: "#F8FAFC" },
        }}
      >
        <ArrowBackIcon sx={{ fontSize: 20 }} />
      </IconButton>

      {/* Centered Page Title */}
      <Typography
        sx={{
          fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle,
          fontWeight: TYPOGRAPHY_TOKENS.fontWeight.bold,
          color: "#0F172A",
          fontFamily: "Poppins, sans-serif",
          textAlign: "center",
        }}
      >
        {title}
      </Typography>

      {/* Right Balance Spacer or Action */}
      <Box sx={{ width: "44px", display: "flex", justifyContent: "flex-end" }}>
        {rightAction || null}
      </Box>
    </Box>
  );
};

export default PageHeader;

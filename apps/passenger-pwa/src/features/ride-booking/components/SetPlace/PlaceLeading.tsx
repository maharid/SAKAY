import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface PlaceLeadingProps {
  /** The icon drawn inside the round badge */
  icon: React.ReactNode;
  /** "230 m" / "4.9 km": shown under the badge, never split across lines */
  distance?: string;
}

/**
 * The left column of a place row. A fixed width keeps every row's text starting at the same x, and the distance sits centred under the
 * badge on ONE line: the number and its unit are joined with a no-break space, so "4.9 km" can never wrap into "4.9" / "km".
 */
const PlaceLeading: React.FC<PlaceLeadingProps> = ({ icon, distance }) => (
  <Box
    sx={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "2px",
      width: "50px",
      flexShrink: 0,
    }}
  >
    <Box
      sx={{
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        backgroundColor: "#F1F5F9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {icon}
    </Box>
    {distance && (
      <Typography
        sx={{
          width: "100%",
          fontSize: "12px",
          fontWeight: 500,
          lineHeight: 1.3,
          textAlign: "center",
          whiteSpace: "nowrap",
          color: "#64748B",
          fontFamily: "Poppins, sans-serif",
        }}
      >
        {distance.replace(/\s+/g, "\u00A0")}
      </Typography>
    )}
  </Box>
);

export default PlaceLeading;

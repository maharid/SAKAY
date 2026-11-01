import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import PlaceIcon from "@mui/icons-material/Place";

interface TripRouteProps {
  pickup: string;
  dropoff: string;
  /** one line each, cut with an ellipsis (the list); otherwise the whole address, wrapping (the detail screen) */
  truncate?: boolean;
  /** the full address on hover / long press, when it is cut */
  language?: "en" | "tl";
}

const MARKER = 20;

// read out by a screen reader, not drawn: the markers say which end is which to the eye
const HIDDEN: React.CSSProperties = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

const addressSx = (truncate: boolean) =>
  ({
    fontSize: "14px",
    fontWeight: 600,
    color: "#0F172A",
    fontFamily: "Poppins, sans-serif",
    lineHeight: "20px",
    minWidth: 0,
    ...(truncate ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : { overflowWrap: "anywhere" }),
  }) as const;

// Where the trip started and where it ended: a hollow ring for the pickup and a pin for the destination (SAKAY orange), joined by a dotted line.
export const TripRoute: React.FC<TripRouteProps> = ({ pickup, dropoff, truncate = false, language = "en" }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
    <Box sx={{ position: "relative", display: "flex", alignItems: "flex-start", gap: "12px", minWidth: 0, "&::after": { content: '""', position: "absolute", left: `${MARKER / 2 - 1}px`, top: `${MARKER + 1}px`, bottom: "-9px", borderLeft: "2px dotted #FFD8BE" } }}>
      <Box aria-hidden sx={{ width: MARKER, height: MARKER, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Box sx={{ width: 14, height: 14, borderRadius: "50%", border: "3px solid #FF6600", backgroundColor: "#FFFFFF", boxSizing: "border-box" }} />
      </Box>
      <Typography title={truncate ? pickup : undefined} sx={addressSx(truncate)}>
        <span style={HIDDEN}>{language === "tl" ? "Pinanggalingan" : "Pickup"}: </span>
        {pickup}
      </Typography>
    </Box>
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: "12px", minWidth: 0 }}>
      <Box aria-hidden sx={{ width: MARKER, height: MARKER, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <PlaceIcon sx={{ fontSize: 22, color: "#FF6600" }} />
      </Box>
      <Typography title={truncate ? dropoff : undefined} sx={addressSx(truncate)}>
        <span style={HIDDEN}>{language === "tl" ? "Destinasyon" : "Drop-off"}: </span>
        {dropoff}
      </Typography>
    </Box>
  </Box>
);

export default TripRoute;

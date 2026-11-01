import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { TripRoute, TripStatusChip, formatShortBookingId, formatTripWhen } from "@sakay/shared";
import appIconImg from "@sakay/shared/src/assets/icons/app-icon-toto.webp";

import type { HistoryTrip } from "../../../services/tripService";
import { tripTypeLabel } from "../tripFormat";
import type { Lang } from "../tripFormat";

interface TripHistoryCardProps {
  trip: HistoryTrip;
  language: Lang;
  /** Starts a new booking from this trip's route (nothing is submitted) */
  onRebook: (trip: HistoryTrip) => void;
  /** Opens THIS trip's details */
  onDetails: (trip: HistoryTrip) => void;
}

const actionSx = {
  height: 44,
  borderRadius: 0,
  textTransform: "none",
  fontWeight: 700,
  fontSize: "14px",
  fontFamily: "Poppins, sans-serif",
  color: "#E65C00",
  "&:hover": { backgroundColor: "#FFF7ED" },
  "&:focus-visible": { outline: "2px solid #E65C00", outlineOffset: -2 },
} as const;

// One trip in the history: who and what (reference number, status), where (pickup and destination, each cut to one line), what to do with it (Rebook, See Details), and the facts
// of the trip in a quiet row at the bottom (its kind, when, the fare). The card is for reading; every action has its own button.
export const TripHistoryCard: React.FC<TripHistoryCardProps> = ({ trip, language, onRebook, onDetails }) => {
  const tl = language === "tl";
  return (
    <Paper
      elevation={0}
      component="article"
      sx={{ backgroundColor: "#FFFFFF", border: "1px solid #E8ECF1", borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      {/* the trip: reference, status, route */}
      <Box sx={{ p: "14px 16px 6px", display: "flex", flexDirection: "column", gap: "12px", cursor: "pointer" }} onClick={() => onDetails(trip)}>
        <Box sx={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <Box component="img" src={appIconImg} alt="" aria-hidden sx={{ width: 30, height: 30, objectFit: "contain", flexShrink: 0 }} />
          <Typography component="h3" sx={{ flex: 1, minWidth: 0, fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {formatShortBookingId(trip.id)}
          </Typography>
          <TripStatusChip status={trip.status} language={language} />
        </Box>
        <TripRoute pickup={trip.pickup} dropoff={trip.dropoff} truncate language={language} />
      </Box>

      {/* Rebook and See Details, side by side */}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", alignItems: "center", mt: "4px" }}>
        <Button onClick={() => onRebook(trip)} sx={actionSx}>
          {tl ? "Muling Mag-book" : "Rebook"}
        </Button>
        <Box aria-hidden sx={{ width: "1px", height: 24, backgroundColor: "#E2E8F0" }} />
        <Button onClick={() => onDetails(trip)} sx={actionSx}>
          {tl ? "Tignan ang Detalye" : "See Details"}
        </Button>
      </Box>

      {/* the facts: the kind of trip, when, the fare */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", px: "16px", py: "11px", borderTop: "1px solid #EEF1F5" }}>
        <Typography component="span" sx={{ fontSize: "12px", fontWeight: 700, color: trip.type === "Share" ? "#1E8E3E" : "#E65C00", fontFamily: "Poppins, sans-serif", whiteSpace: "nowrap", flexShrink: 0 }}>
          {tripTypeLabel(trip.type, language)}
        </Typography>
        <Typography component="span" sx={{ fontSize: "12px", color: "#475569", fontFamily: "Poppins, sans-serif", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
          {formatTripWhen(trip)}
        </Typography>
        <Typography component="span" sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
          {trip.price}
        </Typography>
      </Box>
    </Paper>
  );
};

export default TripHistoryCard;

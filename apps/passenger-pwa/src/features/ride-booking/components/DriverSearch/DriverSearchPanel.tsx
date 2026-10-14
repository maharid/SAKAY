import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import totoHeadImg from "@sakay/shared/src/assets/icons/toto-head.webp";
import { TripDetailsPanel, type TripDetailsView } from "@sakay/shared";

import type { Language } from "../../../../utils/LanguageContext";

export type DriverSearchOutcome = "searching" | "noDriver";

interface DriverSearchPanelProps {
  language: Language;
  /** searching: looking for a driver; noDriver: the search ended without one */
  outcome: DriverSearchOutcome;
  /** The search has grown past the area around the pickup (nobody close by accepted) */
  widening: boolean;
  /** When this search round began (ms since epoch); falls back to when the panel opened */
  startedAt?: number | null;
  /** Shown above the buttons, e.g. when a cancellation could not be saved */
  errorMessage?: string;
  /** The booking's pickup, destination, ride type and estimate (buildTripDetails), so they stay in reach while a driver is being found */
  details?: TripDetailsView | null;
  onCancel: () => void;
  onRetry: () => void;
  /** Rule 29.9: the pickup may be changed while the search is running (offered only then; the database refuses once a driver has accepted) */
  onChangePickup?: () => void;
  /** Ride-sharing (Rule 14.2.1): what a Shared booking is told while a driver on a trip nearby is being asked to take it (SharedMatchPanel) */
  sharedMatch?: React.ReactNode;
}

const FONT = "Poppins, sans-serif";

const formatElapsed = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

/** The seconds since this search round began (ticking once a second). */
const useSearchClock = (startedAt: number | null | undefined): number => {
  const [openedAt] = useState<number>(() => Date.now());
  const roundStart = startedAt ?? openedAt;
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return Math.max(0, Math.floor((now - roundStart) / 1000));
};

const DriverSearchPanel: React.FC<DriverSearchPanelProps> = ({
  language,
  outcome,
  widening,
  startedAt,
  errorMessage,
  details,
  onCancel,
  onRetry,
  onChangePickup,
  sharedMatch,
}) => {
  const isTagalog = language === "tl";
  const elapsedSeconds = useSearchClock(startedAt);

  const tripDetails = details ? <TripDetailsPanel view={details} language={language} /> : null;

  if (outcome === "noDriver") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", py: 1, gap: 1.5 }}>
        <Box
          role="alert"
          sx={{
            width: "100%",
            p: 2,
            backgroundColor: "#FEF2F2",
            borderRadius: "16px",
            border: "1.5px solid #FCA5A5",
            textAlign: "center",
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: "16px", color: "#991B1B", fontFamily: FONT }}>
            {isTagalog ? "Walang available na drayber sa ngayon" : "No driver available right now"}
          </Typography>
          <Typography sx={{ fontSize: "13px", color: "#7F1D1D", mt: 0.5, fontFamily: FONT, lineHeight: 1.5 }}>
            {isTagalog
              ? "Maaaring offline o may biyahe ang mga drayber sa iyong lugar. Maaari kang mag-search muli o bumalik sa Home. Walang bayad o parusa."
              : "Nearby drivers may be offline or on trips. You can search again or go back home. There is no charge or penalty."}
          </Typography>
        </Box>
        {tripDetails}
        {errorMessage && (
          <Alert severity="warning" sx={{ width: "100%", borderRadius: "12px", py: 0.5, fontFamily: FONT }}>
            {errorMessage}
          </Alert>
        )}
        <Box sx={{ display: "flex", gap: 1.5, width: "100%" }}>
          {/* Retry is what most people want: the one filled button. Leaving is quieter (and not red: it is not destructive). */}
          <Button
            variant="outlined"
            fullWidth
            onClick={onCancel}
            sx={{
              minHeight: 52,
              borderRadius: "16px",
              textTransform: "none",
              fontWeight: 600,
              fontSize: "15px",
              fontFamily: FONT,
              color: "#334155",
              borderColor: "#CBD5E1",
              "&:hover": { backgroundColor: "#F1F5F9", borderColor: "#94A3B8" },
            }}
          >
            {isTagalog ? "Bumalik sa Home" : "Back to Home"}
          </Button>
          <Button
            variant="contained"
            fullWidth
            onClick={onRetry}
            sx={{
              minHeight: 52,
              borderRadius: "16px",
              backgroundColor: "#FF6600",
              textTransform: "none",
              fontWeight: 700,
              fontSize: "15px",
              fontFamily: FONT,
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E65C00", boxShadow: "none" },
            }}
          >
            {isTagalog ? "Subukan Muli" : "Retry Search"}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", py: 1, gap: 1.5 }}>
      {/* Toto, waiting with you (one gentle pulse; none for people who prefer less motion) */}
      <Box
        aria-hidden
        sx={{
          alignSelf: "center",
          width: 84,
          height: 84,
          borderRadius: "50%",
          backgroundColor: "#FFE5D4",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: "pulseRing 2s infinite ease-in-out",
          "@keyframes pulseRing": {
            "0%": { transform: "scale(0.96)", opacity: 0.9 },
            "50%": { transform: "scale(1.05)", opacity: 1 },
            "100%": { transform: "scale(0.96)", opacity: 0.9 },
          },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        <Box sx={{ width: 60, height: 60, borderRadius: "50%", backgroundColor: "#FF6600", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Box component="img" src={totoHeadImg} alt="" sx={{ width: 40, height: 40, objectFit: "contain" }} />
        </Box>
      </Box>

      <Box sx={{ textAlign: "center" }} role="status" aria-live="polite">
        <Typography sx={{ fontSize: "17px", fontWeight: 700, color: "#0F172A", fontFamily: FONT }}>
          {isTagalog ? "Naghahanap ng Drayber malapit sayo..." : "Finding a driver near you..."}
        </Typography>
        <Typography sx={{ fontSize: "13px", color: "#475569", mt: 0.5, fontFamily: FONT, lineHeight: 1.5 }}>
          {widening
            ? isTagalog
              ? "Walang malapit na tumanggap pa. Pinalalawak namin ang paghahanap."
              : "No one nearby has accepted yet. We're widening the search."
            : isTagalog
            ? "Sinusuri ang pinakamalapit na terminal ng TODA."
            : "Checking the nearest TODA terminal."}
        </Typography>
      </Box>

      {/* How long this search has been running: the one number to watch, large and steady (digits do not jiggle as they change) */}
      <Box sx={{ textAlign: "center" }}>
        <Typography
          role="timer"
          aria-live="off"
          sx={{ fontSize: "32px", fontWeight: 700, lineHeight: 1.1, color: "#0F172A", fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}
        >
          {formatElapsed(elapsedSeconds)}
        </Typography>
        <Typography sx={{ fontSize: "12px", color: "#475569", fontFamily: FONT, mt: 0.25 }}>
          {isTagalog ? "Tagal ng paghahanap" : "Time spent searching"}
        </Typography>
      </Box>

      <LinearProgress
        aria-label={isTagalog ? "Naghahanap ng drayber" : "Finding a driver"}
        sx={{
          height: 6,
          borderRadius: 3,
          backgroundColor: "#E5E7EB",
          "& .MuiLinearProgress-bar": { backgroundColor: "#FF6600", borderRadius: 3 },
        }}
      />

      {sharedMatch}

      {tripDetails}

      {errorMessage && (
        <Alert severity="warning" sx={{ width: "100%", borderRadius: "12px", py: 0.5, fontFamily: FONT }}>
          {errorMessage}
        </Alert>
      )}

      {onChangePickup && (
        <Button
          fullWidth
          variant="text"
          onClick={onChangePickup}
          sx={{ minHeight: 44, borderRadius: "14px", textTransform: "none", fontWeight: 600, fontSize: "14px", color: "#334155", fontFamily: FONT, "&:hover": { backgroundColor: "#F1F5F9" } }}
        >
          {isTagalog ? "Mali ang pickup? Baguhin" : "Wrong pickup? Change it"}
        </Button>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75 }}>
        <Button
          fullWidth
          variant="outlined"
          onClick={onCancel}
          sx={{
            minHeight: 52,
            borderRadius: "16px",
            borderColor: "#FCA5A5",
            color: "#B91C1C",
            fontWeight: 700,
            fontSize: "15px",
            textTransform: "none",
            fontFamily: FONT,
            "&:hover": { backgroundColor: "#FEF2F2", borderColor: "#F87171" },
          }}
        >
          {isTagalog ? "Ikansel ang Booking" : "Cancel Booking"}
        </Button>
        <Typography sx={{ fontSize: "12px", color: "#475569", fontFamily: FONT, textAlign: "center" }}>
          {isTagalog ? "Libre ang pagkansela bago may tumanggap na drayber." : "Free to cancel until a driver accepts."}
        </Typography>
      </Box>
    </Box>
  );
};

export default DriverSearchPanel;

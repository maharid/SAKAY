import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import SearchIcon from "@mui/icons-material/Search";

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
  onCancel: () => void;
  onRetry: () => void;
}

const FONT = "Poppins, sans-serif";

const formatElapsed = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

/** The moment this search round began, and the seconds since then (ticking once a second). */
const useSearchClock = (startedAt: number | null | undefined): { roundStart: number; elapsedSeconds: number } => {
  const [openedAt] = useState<number>(() => Date.now());
  const roundStart = startedAt ?? openedAt;
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return { roundStart, elapsedSeconds: Math.max(0, Math.floor((now - roundStart) / 1000)) };
};

const DriverSearchPanel: React.FC<DriverSearchPanelProps> = ({
  language,
  outcome,
  widening,
  startedAt,
  errorMessage,
  onCancel,
  onRetry,
}) => {
  const isTagalog = language === "tl";
  const { roundStart, elapsedSeconds } = useSearchClock(startedAt);

  // "Keep Searching" only dismisses the notice for this search round: the search itself never pauses. A Retry starts a new round.
  const [dismissedRound, setDismissedRound] = useState<number | null>(null);
  const showWideningNotice = widening && dismissedRound !== roundStart;

  const dragHandle = (
    <Box sx={{ width: "40px", height: "4px", backgroundColor: "#E2E8F0", borderRadius: "2px", mb: 1 }} />
  );

  if (outcome === "noDriver") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 2, gap: 2 }}>
        {dragHandle}
        <Box
          sx={{
            width: "100%",
            p: 2,
            backgroundColor: "#FEF2F2",
            borderRadius: "16px",
            border: "1.5px solid #FCA5A5",
            textAlign: "center",
          }}
        >
          <Typography sx={{ fontWeight: 800, fontSize: "16px", color: "#991B1B", fontFamily: FONT }}>
            {isTagalog ? "Walang available na drayber sa ngayon" : "No driver available right now"}
          </Typography>
          <Typography sx={{ fontSize: "12.5px", color: "#B91C1C", mt: 0.5, fontFamily: FONT }}>
            {isTagalog
              ? "Maaaring offline o may biyahe ang mga drayber sa iyong lugar. Maaari kang mag-search muli o kanselahin ang booking. Walang bayad o parusa."
              : "Nearby drivers may be offline or on trips. You can search again or cancel the booking. There is no charge or penalty."}
          </Typography>
        </Box>
        {errorMessage && (
          <Alert severity="warning" sx={{ width: "100%", borderRadius: "12px", py: 0.5, fontFamily: FONT }}>
            {errorMessage}
          </Alert>
        )}
        <Box sx={{ display: "flex", gap: 1.5, width: "100%" }}>
          <Button
            variant="outlined"
            fullWidth
            onClick={onCancel}
            sx={{
              height: "50px",
              borderRadius: "16px",
              textTransform: "none",
              fontWeight: 700,
              fontSize: "15px",
              fontFamily: FONT,
              color: "#EF4444",
              borderColor: "#FCA5A5",
              "&:hover": { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" },
            }}
          >
            {isTagalog ? "Ikansel ang Booking" : "Cancel Booking"}
          </Button>
          <Button
            variant="contained"
            fullWidth
            onClick={onRetry}
            sx={{
              height: "50px",
              borderRadius: "16px",
              backgroundColor: "#FF6B00",
              textTransform: "none",
              fontWeight: 700,
              fontSize: "15px",
              fontFamily: FONT,
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {isTagalog ? "Subukan Muli" : "Retry Search"}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 2, gap: 2 }}>
      {dragHandle}

      {/* Large Concentric Search Circle with Pulsing Animation */}
      <Box
        sx={{
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
        }}
      >
        <Box
          sx={{
            width: 60,
            height: 60,
            borderRadius: "50%",
            backgroundColor: "#FF6B00",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SearchIcon sx={{ color: "#FFFFFF", fontSize: 32 }} />
        </Box>
      </Box>

      <Box sx={{ textAlign: "center", mt: 1 }}>
        <Typography sx={{ fontSize: "17px", fontWeight: 800, color: "#0F172A", fontFamily: FONT }}>
          {isTagalog ? "Naghahanap ng Drayber malapit sayo..." : "Finding a driver near you..."}
        </Typography>
        <Typography sx={{ fontSize: "13px", color: "#64748B", mt: 0.5, fontFamily: FONT }}>
          {widening
            ? isTagalog
              ? "Walang malapit na tumanggap pa. Pinalalawak namin ang paghahanap."
              : "No one nearby has accepted yet. We're widening the search."
            : isTagalog
            ? "Sinusuri ang pinakamalapit na terminal ng TODA."
            : "Checking the nearest TODA terminal."}
        </Typography>
        <Typography sx={{ fontSize: "12px", color: "#94A3B8", mt: 0.5, fontFamily: FONT }}>
          {isTagalog ? "Naghahanap na sa loob ng" : "Searching for"} {formatElapsed(elapsedSeconds)}
        </Typography>
      </Box>

      <Box sx={{ width: "100%", px: 1, mt: 1 }}>
        <LinearProgress
          sx={{
            height: 6,
            borderRadius: 3,
            backgroundColor: "#E5E7EB",
            "& .MuiLinearProgress-bar": { backgroundColor: "#FF6B00", borderRadius: 3 },
          }}
        />
      </Box>

      {errorMessage && (
        <Alert severity="warning" sx={{ width: "100%", borderRadius: "12px", py: 0.5, fontFamily: FONT }}>
          {errorMessage}
        </Alert>
      )}

      {showWideningNotice ? (
        <Box sx={{ display: "flex", gap: 1.5, width: "100%", mt: 1 }}>
          <Button
            fullWidth
            onClick={onCancel}
            sx={{
              height: "50px",
              borderRadius: "16px",
              backgroundColor: "#FEE2E2",
              border: "1px solid #FCA5A5",
              color: "#EF4444",
              fontWeight: 700,
              fontSize: "15px",
              textTransform: "none",
              fontFamily: FONT,
              boxShadow: "none",
              "&:hover": { backgroundColor: "#FECACA", boxShadow: "none" },
            }}
          >
            {isTagalog ? "Ikansel ang Paghahanap" : "Cancel Search"}
          </Button>
          <Button
            fullWidth
            variant="contained"
            onClick={() => setDismissedRound(roundStart)}
            sx={{
              height: "50px",
              borderRadius: "16px",
              backgroundColor: "#FF6B00",
              fontWeight: 700,
              fontSize: "15px",
              textTransform: "none",
              fontFamily: FONT,
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {isTagalog ? "Ituloy ang Paghahanap" : "Keep Searching"}
          </Button>
        </Box>
      ) : (
        <Button
          fullWidth
          onClick={onCancel}
          sx={{
            mt: 2,
            height: "50px",
            borderRadius: "16px",
            backgroundColor: "#FEE2E2",
            border: "1px solid #FCA5A5",
            color: "#EF4444",
            fontWeight: 700,
            fontSize: "15px",
            textTransform: "none",
            fontFamily: FONT,
            boxShadow: "none",
            "&:hover": { backgroundColor: "#FECACA", boxShadow: "none" },
          }}
        >
          {isTagalog ? "Ikansel ang Booking" : "Cancel Booking"}
        </Button>
      )}
    </Box>
  );
};

export default DriverSearchPanel;

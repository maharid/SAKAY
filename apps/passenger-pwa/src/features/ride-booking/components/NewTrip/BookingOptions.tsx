import React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ChatOutlinedIcon from "@mui/icons-material/ChatOutlined";
import { extendTapArea } from "@sakay/shared";

type TripKind = "Solo" | "Shared";

interface BookingOptionsProps {
  language: "tl" | "en";
  tripType: TripKind;
  passengers: number;
  /** 4 for a Solo trip, 2 for a Shared one */
  maxPassengers: number;
  /** The driver note typed so far ("" when none) */
  note: string;
  onTripTypeChange: (next: TripKind) => void;
  onPassengersChange: (next: number) => void;
  onOpenNote: () => void;
  onOpenTripTypeInfo: () => void;
}

const FONT = "Poppins, sans-serif";
const CONTROL_HEIGHT = 44;

const fieldLabelSx = { fontSize: "12px", fontWeight: 600, color: "#64748B", fontFamily: FONT, lineHeight: 1.3 } as const;

/**
 * The three choices under the destination: Solo or Shared, how many passengers, and an optional note for the driver.
 * Trip type has the full width to itself (two clear halves, no squeezed columns); passengers and the note share the row below,
 * each with its label above, so nothing needs to wrap or shrink on a 320px phone.
 */
const BookingOptions: React.FC<BookingOptionsProps> = ({
  language,
  tripType,
  passengers,
  maxPassengers,
  note,
  onTripTypeChange,
  onPassengersChange,
  onOpenNote,
  onOpenTripTypeInfo,
}) => {
  const tl = language === "tl";
  const options: Array<{ value: TripKind; label: string }> = [
    { value: "Solo", label: "Solo" },
    { value: "Shared", label: "Shared" },
  ];

  const handleRadioKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onTripTypeChange("Shared");
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onTripTypeChange("Solo");
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Trip type: the full-width segmented control */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: "6px", mb: "6px" }}>
          <Typography id="trip-type-label" sx={fieldLabelSx}>
            {tl ? "Uri ng biyahe" : "Trip type"}
          </Typography>
          <IconButton
            size="small"
            onClick={onOpenTripTypeInfo}
            aria-label={tl ? "Impormasyon sa uri ng biyahe" : "About trip types"}
            sx={{ p: 0, color: "#64748B", ...extendTapArea(14) }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
        <Box
          role="radiogroup"
          aria-labelledby="trip-type-label"
          onKeyDown={handleRadioKey}
          sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", p: "2px", borderRadius: "14px", backgroundColor: "#F1F5F9" }}
        >
          {options.map((option) => {
            const selected = tripType === option.value;
            return (
              <ButtonBase
                key={option.value}
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTripTypeChange(option.value)}
                sx={{
                  height: CONTROL_HEIGHT - 4,
                  borderRadius: "10px",
                  fontFamily: FONT,
                  fontSize: "14px",
                  fontWeight: selected ? 700 : 500,
                  color: selected ? "#0F172A" : "#64748B",
                  backgroundColor: selected ? "#FFFFFF" : "transparent",
                  boxShadow: selected ? "0 1px 3px rgba(15, 23, 42, 0.12)" : "none",
                  transition: "background-color 0.15s ease, color 0.15s ease",
                }}
              >
                {option.label}
              </ButtonBase>
            );
          })}
        </Box>
      </Box>

      {/* Passengers and the driver note, side by side */}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography id="passengers-label" sx={{ ...fieldLabelSx, mb: "6px" }}>
            {tl ? "Pasahero" : "Passengers"}
          </Typography>
          <Box
            role="group"
            aria-labelledby="passengers-label"
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: CONTROL_HEIGHT,
              borderRadius: "12px",
              backgroundColor: "#F1F5F9",
            }}
          >
            <IconButton
              disabled={passengers <= 1}
              onClick={() => onPassengersChange(Math.max(1, passengers - 1))}
              aria-label={tl ? "Bawasan ang pasahero" : "Fewer passengers"}
              sx={{ width: CONTROL_HEIGHT, height: CONTROL_HEIGHT, color: "#0F172A" }}
            >
              <RemoveIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <Typography aria-live="polite" sx={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", fontFamily: FONT, minWidth: "1ch", textAlign: "center" }}>
              {passengers}
            </Typography>
            <IconButton
              disabled={passengers >= maxPassengers}
              onClick={() => onPassengersChange(Math.min(maxPassengers, passengers + 1))}
              aria-label={tl ? "Dagdagan ang pasahero" : "More passengers"}
              sx={{ width: CONTROL_HEIGHT, height: CONTROL_HEIGHT, color: "#0F172A" }}
            >
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Typography id="driver-note-label" sx={{ ...fieldLabelSx, mb: "6px" }}>
            {tl ? "Tala para sa drayber" : "Note for driver"}
          </Typography>
          <ButtonBase
            onClick={onOpenNote}
            aria-labelledby="driver-note-label"
            aria-describedby="driver-note-value"
            sx={{
              width: "100%",
              height: CONTROL_HEIGHT,
              px: "12px",
              gap: "8px",
              justifyContent: "flex-start",
              borderRadius: "12px",
              backgroundColor: note ? "#FFF7ED" : "#F1F5F9",
              border: note ? "1px solid #FDBA74" : "1px solid transparent",
              fontFamily: FONT,
              textAlign: "left",
            }}
          >
            <ChatOutlinedIcon sx={{ fontSize: 18, flexShrink: 0, color: note ? "#C2410C" : "#64748B" }} />
            <Typography
              id="driver-note-value"
              noWrap
              sx={{ minWidth: 0, fontSize: "13px", fontWeight: note ? 600 : 500, color: note ? "#7C2D12" : "#64748B", fontFamily: FONT }}
            >
              {note || (tl ? "Magdagdag" : "Add note")}
            </Typography>
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
};

export default BookingOptions;

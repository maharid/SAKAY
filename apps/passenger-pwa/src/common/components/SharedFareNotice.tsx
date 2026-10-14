import React, { useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { RIDE_SHARING_CUTOFF_PERCENT, formatPeso } from "@sakay/shared";

interface SharedFareNoticeProps {
  language: "tl" | "en";
  /** Matched Shared Fare Estimate, from the database quote (Rule 6.5) */
  matchedEstimate: number;
  /** Maximum Unmatched Fare = the Solo Trip Fare, from the database quote (Rule 6.5) */
  maxUnmatchedFare: number;
  /** How many more passengers the estimate assumes (from the quote, never typed here) */
  partnerAssumptionPassengers: number;
  /** "light" for the booking sheet, "dark" for the dark fare card */
  tone?: "light" | "dark";
}

const PALETTE = {
  light: {
    panelBg: "#EFF6FF",
    panelBorder: "1px solid #BFDBFE",
    tileBg: "#FFFFFF",
    tileBorder: "1px solid #DBEAFE",
    title: "#1E40AF",
    caption: "#475569",
    text: "#1E3A8A",
    matched: "#15803D",
    unmatched: "#FF6600",
    link: "#1D4ED8",
  },
  dark: {
    panelBg: "rgba(52, 168, 83, 0.08)",
    panelBorder: "none",
    tileBg: "rgba(255, 255, 255, 0.06)",
    tileBorder: "1px solid rgba(255, 255, 255, 0.08)",
    title: "#81C784",
    caption: "#CBD5E1",
    text: "#A5D6A7",
    matched: "#4ADE80",
    unmatched: "#FFB27A",
    link: "#81C784",
  },
} as const;

const FONT = "Poppins, sans-serif";

/**
 * What a passenger must see before confirming a Shared Trip (Rule 6.5): the Matched Shared Fare Estimate AND the Maximum Unmatched Fare,
 * that matching runs until the ride-sharing cutoff, and what happens if nobody is matched. Every figure arrives as a prop from the
 * database quote.
 *
 * The two fares and the one sentence that matters are always on screen; the full conditions sit one tap away under "How sharing works"
 * (collapsed by default), so the notice no longer fills the whole sheet.
 */
const SharedFareNotice: React.FC<SharedFareNoticeProps> = ({
  language,
  matchedEstimate,
  maxUnmatchedFare,
  partnerAssumptionPassengers,
  tone = "light",
}) => {
  const c = PALETTE[tone];
  const tl = language === "tl";
  const [open, setOpen] = useState(false);

  const tiles: Array<{ key: string; caption: string; value: number; color: string }> = [
    { key: "matched", caption: tl ? "Kung may makapares" : "Matched estimate", value: matchedEstimate, color: c.matched },
    { key: "unmatched", caption: tl ? "Pinakamataas kung wala" : "Maximum if unmatched", value: maxUnmatchedFare, color: c.unmatched },
  ];

  const summary = tl
    ? `Hahanapan ng kapares habang wala pang ${RIDE_SHARING_CUTOFF_PERCENT}% ng biyahe ang natatapos. Kung wala, ang Solo fare ang babayaran mo.`
    : `We look for a match while less than ${RIDE_SHARING_CUTOFF_PERCENT}% of the trip is done. If there is none, you pay the Solo fare.`;

  // The full conditions (unchanged in meaning), including the two fares under their rule names
  const details = tl
    ? [
        `Tinatayang Shared Fare (kung may makapares): ${formatPeso(matchedEstimate)}. Pinakamataas na Pamasahe (kung walang makapares, Solo rate): ${formatPeso(maxUnmatchedFare)}.`,
        `Ang estimasyon ay para sa ${partnerAssumptionPassengers} karagdagang pasaherong kasabay mo.`,
        `Tuloy ang paghahanap ng kapares hanggang sa ride-sharing cutoff, habang wala pang ${RIDE_SHARING_CUTOFF_PERCENT}% ng biyahe ang natatapos.`,
        "Kung walang makapares bago ang cutoff, o umalis ang kapares at walang pumalit, awtomatikong magiging Solo Trip ang booking at ang Pinakamataas na Pamasahe ang sisingilin.",
        "Sa pagpindot ng Mag-book, tinatanggap mo ang mga kundisyong ito at ang posibilidad na makasabay ang isa pang Mobile-Verified na pasahero. Magiging may-bisa ito sa inyo ng drayber kapag tinanggap ng drayber ang booking.",
      ]
    : [
        `Matched Shared Fare Estimate: ${formatPeso(matchedEstimate)}. Maximum Unmatched Fare (Solo rate): ${formatPeso(maxUnmatchedFare)}.`,
        `The estimate assumes ${partnerAssumptionPassengers} more passenger sharing the ride.`,
        `Matching continues until the ride-sharing cutoff, while less than ${RIDE_SHARING_CUTOFF_PERCENT}% of the trip is completed.`,
        "If no compatible passenger is matched before the cutoff, or a matched passenger cancels and is not replaced, the booking automatically continues as a Solo Trip and the Maximum Unmatched Fare applies.",
        "By tapping Book you accept these fare conditions and the possibility of being matched with another Mobile-Verified passenger. They become binding on you and the driver once a driver accepts the booking.",
      ];

  return (
    <Box>
      <ButtonBase
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        sx={{
          width: "100%",
          p: "10px 14px",
          borderRadius: "14px",
          backgroundColor: c.panelBg,
          border: c.panelBorder,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          textAlign: "left",
          transition: "all 0.15s ease",
          "&:hover": {
            backgroundColor: tone === "dark" ? "rgba(255, 255, 255, 0.1)" : "#E0EDFF",
          },
          "&:focus-visible": {
            outline: "2px solid #FF6600",
            outlineOffset: "2px",
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flex: 1 }}>
          <InfoOutlinedIcon sx={{ color: c.title, fontSize: 20, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: "13px", fontWeight: 700, color: c.title, fontFamily: FONT, lineHeight: 1.2 }}>
              {tl ? "Pamasahe sa Shared Trip" : "Shared Trip Fare Info"}
            </Typography>
            <Typography sx={{ fontSize: "12px", color: c.caption, fontFamily: FONT, lineHeight: 1.2, mt: 0.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {formatPeso(matchedEstimate)} ({tl ? "may kapares" : "matched"}) • {formatPeso(maxUnmatchedFare)} max
            </Typography>
          </Box>
        </Box>
        <Typography
          sx={{
            fontSize: "12px",
            fontWeight: 700,
            color: c.link,
            fontFamily: FONT,
            flexShrink: 0,
            lineHeight: 1.2,
          }}
        >
          {tl ? "Tingnan" : "Details"} &rsaquo;
        </Typography>
      </ButtonBase>

      {/* Compact Fare Breakdown Modal */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="xs"
        slotProps={{
          paper: {
            sx: {
              borderRadius: "24px",
              p: 2.5,
              m: 2,
              maxHeight: "85vh",
            },
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
          <Typography sx={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", fontFamily: FONT }}>
            {tl ? "Paano gumagana ang Shared Trip?" : "How Shared Trips Work"}
          </Typography>
          <IconButton size="small" onClick={() => setOpen(false)} aria-label={tl ? "Isara" : "Close"}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", my: 0.5 }}>
            {tiles.map((tile) => (
              <Box
                key={tile.key}
                sx={{ minWidth: 0, p: "10px", borderRadius: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: "2px" }}
              >
                <Typography sx={{ fontSize: "11px", color: "#64748B", fontFamily: FONT, lineHeight: 1.3 }}>{tile.caption}</Typography>
                <Typography sx={{ fontSize: "17px", fontWeight: 700, color: tile.color, fontFamily: FONT, lineHeight: 1.3 }}>
                  {formatPeso(tile.value)}
                </Typography>
              </Box>
            ))}
          </Box>

          <Typography sx={{ fontSize: "12px", color: "#475569", fontFamily: FONT, lineHeight: 1.45, fontStyle: "italic", px: 0.5 }}>
            {summary}
          </Typography>

          <Box component="ul" sx={{ m: 0, pl: 2.5, display: "flex", flexDirection: "column", gap: "8px" }}>
            {details.map((line, i) => (
              <Typography key={i} component="li" sx={{ fontSize: "12px", color: "#334155", lineHeight: 1.5, fontFamily: FONT }}>
                {line}
              </Typography>
            ))}
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 0, pt: 2 }}>
          <Button
            variant="contained"
            fullWidth
            onClick={() => setOpen(false)}
            sx={{
              borderRadius: "14px",
              backgroundColor: "#FF6600",
              color: "#FFFFFF",
              fontWeight: 700,
              fontSize: "14px",
              height: "44px",
              textTransform: "none",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E55C00", boxShadow: "none" },
            }}
          >
            {tl ? "Naintindihan ko" : "Got it"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

interface SharedAcknowledgementProps {
  language: "tl" | "en";
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * The tick that must be set before a Shared booking can be made. The whole sentence is the tap target (not just the small box). What
 * the person is accepting (both fares and what happens with no match) is in the notice just above it, so this stays to one short line.
 */
export const SharedAcknowledgement: React.FC<SharedAcknowledgementProps> = ({ language, checked, onChange }) => {
  const tl = language === "tl";
  const label = tl
    ? "Tinatanggap ko ang kundisyon ng shared fare."
    : "I accept the shared fare conditions.";
  return (
    <Box sx={{ borderRadius: "14px", backgroundColor: "#EFF6FF", border: "1px solid #BFDBFE", pr: "12px" }}>
      <FormControlLabel
        sx={{ m: 0, width: "100%", alignItems: "flex-start", gap: "2px", "& .MuiFormControlLabel-label": { fontSize: "12px", lineHeight: 1.45, color: "#1E3A8A", fontFamily: FONT, py: "11px" } }}
        control={
          <Checkbox
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            sx={{ p: "10px", color: "#2563EB", "&.Mui-checked": { color: "#2563EB" } }}
          />
        }
        label={label}
      />
    </Box>
  );
};

export default SharedFareNotice;

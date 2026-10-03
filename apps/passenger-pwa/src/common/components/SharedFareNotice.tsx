import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { RIDE_SHARING_CUTOFF_PERCENT } from "@sakay/shared";

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
    title: "#1E40AF",
    label: "#1E3A8A",
    text: "#1E3A8A",
    matched: "#15803D",
    unmatched: "#C2410C",
  },
  dark: {
    panelBg: "rgba(52, 168, 83, 0.08)",
    panelBorder: "none",
    title: "#81C784",
    label: "#94A3B8",
    text: "#A5D6A7",
    matched: "#34A853",
    unmatched: "#FFA726",
  },
} as const;

/**
 * What a passenger must see before confirming a Shared Trip (Rule 6.5): the Matched Shared Fare Estimate AND
 * the Maximum Unmatched Fare, that matching runs until the ride-sharing cutoff, and that tapping Book is the
 * acknowledgement. Every figure arrives as a prop from the database quote.
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
  const rows: Array<{ label: string; value: number; color: string }> = [
    {
      label: tl ? "Tinatayang Shared Fare (kung may makapares)" : "Matched Shared Fare Estimate",
      value: matchedEstimate,
      color: c.matched,
    },
    {
      label: tl ? "Pinakamataas na Pamasahe (kung walang makapares, Solo rate)" : "Maximum Unmatched Fare (Solo rate)",
      value: maxUnmatchedFare,
      color: c.unmatched,
    },
  ];
  const lines = tl
    ? [
        `Ang estimasyon ay para sa ${partnerAssumptionPassengers} karagdagang pasaherong kasabay mo.`,
        `Tuloy ang paghahanap ng kapares hanggang sa ride-sharing cutoff, habang wala pang ${RIDE_SHARING_CUTOFF_PERCENT}% ng biyahe ang natatapos.`,
        "Kung walang makapares bago ang cutoff, o umalis ang kapares at walang pumalit, awtomatikong magiging Solo Trip ang booking at ang Pinakamataas na Pamasahe ang sisingilin.",
        "Sa pagpindot ng Mag-book, tinatanggap mo ang mga kundisyong ito at ang posibilidad na makasabay ang isa pang Mobile-Verified na pasahero. Magiging may-bisa ito sa inyo ng drayber kapag tinanggap ng drayber ang booking.",
      ]
    : [
        `The estimate assumes ${partnerAssumptionPassengers} more passenger sharing the ride.`,
        `Matching continues until the ride-sharing cutoff, while less than ${RIDE_SHARING_CUTOFF_PERCENT}% of the trip is completed.`,
        "If no compatible passenger is matched before the cutoff, or a matched passenger cancels and is not replaced, the booking automatically continues as a Solo Trip and the Maximum Unmatched Fare applies.",
        "By tapping Book you accept these fare conditions and the possibility of being matched with another Mobile-Verified passenger. They become binding on you and the driver once a driver accepts the booking.",
      ];

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: "14px",
        backgroundColor: c.panelBg,
        border: c.panelBorder,
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
      }}
    >
      <Typography sx={{ fontSize: "12px", fontWeight: 700, color: c.title, fontFamily: "Poppins, sans-serif" }}>
        {tl ? "Pamasahe sa Shared Trip" : "Shared Trip fare"}
      </Typography>
      {rows.map((row) => (
        <Box key={row.label} sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
          <Typography sx={{ fontSize: "11.5px", color: c.label, fontFamily: "Poppins, sans-serif" }}>{row.label}</Typography>
          <Typography sx={{ fontSize: "13px", fontWeight: 800, color: row.color, fontFamily: "Poppins, sans-serif", whiteSpace: "nowrap" }}>
            ₱{row.value.toFixed(2)}
          </Typography>
        </Box>
      ))}
      <Box component="ul" sx={{ m: 0, pl: 2, display: "flex", flexDirection: "column", gap: 0.25 }}>
        {lines.map((line) => (
          <Typography
            key={line}
            component="li"
            sx={{ fontSize: "10.5px", color: c.text, lineHeight: 1.4, fontFamily: "Poppins, sans-serif" }}
          >
            {line}
          </Typography>
        ))}
      </Box>
    </Box>
  );
};

export default SharedFareNotice;

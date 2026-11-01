import React from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CallIcon from "@mui/icons-material/Call";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import PersonOutlineIcon from "@mui/icons-material/PersonOutlined";
import { phoneHref } from "@sakay/shared";

import type { HistoryTrip } from "../../../services/tripService";
import { driverSummary } from "../tripFormat";
import type { Lang } from "../tripFormat";

interface DriverCardProps {
  trip: Pick<HistoryTrip, "driverName" | "todaName" | "plateNumber" | "bodyNumber">;
  language: Lang;
  /** The driver's number, only when the server gave it for this trip. After a trip it does not (the number is not shared), so no call or message button is drawn then. */
  phone?: string;
  /** A short-lived link to the driver's photo, only when there is one (the photo is not kept for the passenger after the trip) */
  photoUrl?: string;
}

const contactSx = (bg: string, fg: string, hover: string) =>
  ({ width: 44, height: 44, backgroundColor: bg, color: fg, borderRadius: "14px", "&:hover": { backgroundColor: hover }, "&:focus-visible": { outline: `2px solid ${fg}`, outlineOffset: 2 } }) as const;

// Who drove the trip, first on the detail screen: the photo (or a plain avatar), the name, the TODA, the vehicle, and the call and message buttons when the number is available.
// Nothing is drawn for what the record does not have, and a trip with no driver says so instead of showing empty fields.
export const DriverCard: React.FC<DriverCardProps> = ({ trip, language, phone = "", photoUrl }) => {
  const tl = language === "tl";
  const d = driverSummary(trip, language);
  const href = phoneHref(phone);
  return (
    <Paper component="section" aria-label={tl ? "Drayber" : "Driver"} elevation={0} sx={{ backgroundColor: "#FFFFFF", border: "1px solid #E8ECF1", borderRadius: "16px", p: "14px 16px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Avatar
          src={photoUrl || undefined}
          alt={d.hasDriver ? d.name : ""}
          sx={{ width: 56, height: 56, flexShrink: 0, backgroundColor: d.hasDriver ? "#FF6600" : "#E2E8F0", color: d.hasDriver ? "#FFFFFF" : "#64748B", fontWeight: 700, fontSize: "22px", fontFamily: "Poppins, sans-serif" }}
        >
          {d.hasDriver ? d.name.charAt(0).toUpperCase() : <PersonOutlineIcon />}
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: "15px", fontWeight: 700, color: d.hasDriver ? "#0F172A" : "#64748B", fontFamily: "Poppins, sans-serif", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>
            {d.name}
          </Typography>
          {d.hasDriver && d.todaName && (
            <Typography noWrap title={d.todaName} sx={{ fontSize: "12.5px", color: "#475569", fontFamily: "Poppins, sans-serif", lineHeight: 1.4 }}>
              {d.todaName}
            </Typography>
          )}
          {d.hasDriver && d.vehicleLine && (
            <Typography noWrap title={d.vehicleLine} sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif", lineHeight: 1.4 }}>
              {d.vehicleLine}
            </Typography>
          )}
          {!d.hasDriver && (
            <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif", lineHeight: 1.4 }}>
              {tl ? "Walang drayber na tumanggap ng biyaheng ito." : "No driver accepted this booking."}
            </Typography>
          )}
        </Box>

        {d.hasDriver && href && (
          <Box sx={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <IconButton component="a" href={`tel:${href}`} aria-label={tl ? "Tawagan ang drayber" : "Call driver"} sx={contactSx("#E6F4EA", "#166534", "#D1EBD7")}>
              <CallIcon fontSize="small" />
            </IconButton>
            <IconButton component="a" href={`sms:${href}`} aria-label={tl ? "Magpadala ng mensahe sa drayber" : "Message driver"} sx={contactSx("#FFF1E6", "#C2410C", "#FFE6D2")}>
              <ChatBubbleIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
      </Box>

      {d.hasDriver && !href && (
        <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif", mt: "10px", pt: "10px", borderTop: "1px solid #EEF1F5" }}>
          {tl ? "Hindi na ibinabahagi ang numero ng drayber pagkatapos ng biyahe." : "The driver's number is not shared after the trip."}
        </Typography>
      )}
    </Paper>
  );
};

export default DriverCard;

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

import type { HistoryTrip } from "../../../services/tripService";
import { fetchTripHistory } from "../../../services/tripService";
import { useLanguage } from "../../../utils/LanguageContext";
import PageHeader from "../../../common/components/PageHeader";
import { stashRebook } from "../tripFormat";
import { TripHistoryCard } from "./TripHistoryCard";

const PassengerHistory: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<HistoryTrip[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchTripHistory()
      .then((data) => setTrips(data))
      .finally(() => setLoading(false));
  }, []);

  // Rebook: this trip's own pickup and destination go to the new-trip screen; the passenger still confirms the booking there
  const handleRebook = (trip: HistoryTrip) => {
    stashRebook(trip);
    navigate("/new-trip");
  };

  // See Details: always THIS trip (its id is in the address, and the trip itself travels with the navigation so the screen opens at once)
  const handleDetails = (trip: HistoryTrip) => navigate(`/trip-details/${encodeURIComponent(trip.id)}`, { state: { trip } });

  // Group trips chronologically into Today, Yesterday, Earlier This Week, Previous
  const groupTripsChronologically = (tripsList: HistoryTrip[]) => {
    const now = new Date();
    const todayStr = now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const groups: {
      today: HistoryTrip[];
      yesterday: HistoryTrip[];
      thisWeek: HistoryTrip[];
      previous: HistoryTrip[];
    } = {
      today: [],
      yesterday: [],
      thisWeek: [],
      previous: [],
    };

    tripsList.forEach((trip) => {
      let tripDate = trip.dateString ? new Date(trip.dateString) : now;
      if (isNaN(tripDate.getTime())) tripDate = now;

      const tripDateStr = tripDate.toDateString();
      if (tripDateStr === todayStr || trip.dateGroup === "NGAYONG ARAW") {
        groups.today.push(trip);
      } else if (tripDateStr === yesterdayStr) {
        groups.yesterday.push(trip);
      } else if (tripDate >= sevenDaysAgo) {
        groups.thisWeek.push(trip);
      } else {
        groups.previous.push(trip);
      }
    });

    return groups;
  };

  const grouped = groupTripsChronologically(trips);

  const renderSection = (title: string, items: HistoryTrip[]) => {
    if (!items || items.length === 0) return null;

    return (
      <Box key={title} component="section" aria-label={title} sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Typography
          sx={{
            fontSize: "12px",
            fontWeight: 700,
            color: "#64748B",
            fontFamily: "Poppins, sans-serif",
          }}
        >
          {title}
        </Typography>

        {items.map((trip) => (
          <TripHistoryCard key={trip.id} trip={trip} language={language} onRebook={handleRebook} onDetails={handleDetails} />
        ))}
      </Box>
    );
  };

  const hasTrips = trips.length > 0;

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#FAFAFA",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Standardized Reusable Page Header */}
      <PageHeader
        title={language === "tl" ? "Kasaysayan ng Biyahe" : "Trip History"}
        onBack={() => navigate("/dashboard")}
      />

      {/* Scrollable Content Container */}
      <Box
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          "& > *": { flexShrink: 0 },
          padding: "16px 20px calc(var(--safe-area-bottom) + 32px) 20px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "40px" }}>
            <CircularProgress sx={{ color: "#FF6600" }} />
          </Box>
        ) : !hasTrips ? (
          <Box sx={{ textAlign: "center", py: 8, px: 2 }}>
            <Typography sx={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Wala pang nakaraang biyahe" : "No past trips yet"}
            </Typography>
            <Typography sx={{ fontSize: "13px", color: "#64748B", mt: 1, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl"
                ? "Mag-book ng iyong biyahe upang makita ang iyong history rito."
                : "Book a ride to see your trip history here."}
            </Typography>
            <Button
              variant="contained"
              onClick={() => navigate("/new-trip")}
              sx={{
                mt: 3,
                backgroundColor: "#FF6600",
                color: "#FFFFFF",
                borderRadius: "14px",
                fontWeight: 700,
                textTransform: "none",
                boxShadow: "none",
                fontFamily: "Poppins, sans-serif",
                "&:hover": { backgroundColor: "#E65C00", boxShadow: "none" },
              }}
            >
              {language === "tl" ? "Mag-book ng Biyahe" : "Book a Ride"}
            </Button>
          </Box>
        ) : (
          <>
            {renderSection(language === "tl" ? "Ngayong araw" : "Today", grouped.today)}
            {renderSection(language === "tl" ? "Kahapon" : "Yesterday", grouped.yesterday)}
            {renderSection(language === "tl" ? "Mas maaga sa linggong ito" : "Earlier this week", grouped.thisWeek)}
            {renderSection(language === "tl" ? "Nakaraang mga biyahe" : "Previous trips", grouped.previous)}
          </>
        )}
      </Box>
    </Box>
  );
};

export default PassengerHistory;

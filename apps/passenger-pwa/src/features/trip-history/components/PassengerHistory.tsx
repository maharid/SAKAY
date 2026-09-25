import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";

import type { HistoryTrip } from "../../../services/tripService";
import { fetchTripHistory } from "../../../services/tripService";
import { useLanguage } from "../../../utils/LanguageContext";
import PageHeader from "../../../common/components/PageHeader";

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

  const handleRebook = (trip: HistoryTrip) => {
    sessionStorage.setItem(
      "trip_pickup",
      JSON.stringify({
        address: trip.pickup,
        lat: trip.pickupLat,
        lng: trip.pickupLng,
      })
    );
    sessionStorage.setItem(
      "trip_dropoff",
      JSON.stringify({
        address: trip.dropoff,
        lat: trip.dropoffLat,
        lng: trip.dropoffLng,
      })
    );
    navigate("/new-trip");
  };

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
      <Box key={title} sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Typography
          sx={{
            fontSize: "12px",
            fontWeight: 700,
            color: "#64748B",
            letterSpacing: "0.5px",
            fontFamily: "Poppins, sans-serif",
            textTransform: "uppercase",
          }}
        >
          {title}
        </Typography>

        {items.map((trip) => (
          <Paper
            key={trip.id}
            elevation={0}
            onClick={() => navigate(`/trip-details/${trip.id}`, { state: { trip } })}
            sx={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #F1F5F9",
              borderRadius: "20px",
              padding: "16px",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              "&:hover": { borderColor: "#CBD5E1" },
            }}
          >
            {/* Upper Details Row */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
              }}
            >
              {/* Left Timeline & Locations */}
              <Box sx={{ display: "flex", gap: "12px", flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: "4px",
                    flexShrink: 0,
                  }}
                >
                  <Box
                    sx={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      border: "2px solid #64748B",
                      backgroundColor: "#FFFFFF",
                    }}
                  />
                  <Box
                    sx={{
                      width: "1.5px",
                      height: "26px",
                      backgroundColor: "#CBD5E1",
                      margin: "2px 0",
                    }}
                  />
                  <Box
                    sx={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: "#FF6B00",
                    }}
                  />
                </Box>

                <Box sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
                  <Box sx={{ marginBottom: "10px" }}>
                    <Typography sx={{ fontSize: "11px", color: "#64748B", fontWeight: 500, fontFamily: "Poppins, sans-serif" }}>
                      {language === "tl" ? "Pickup" : "Pickup"}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: "14px",
                        fontWeight: 800,
                        color: "#0F172A",
                        fontFamily: "Poppins, sans-serif",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {trip.pickup}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: "11px", color: "#64748B", fontWeight: 500, fontFamily: "Poppins, sans-serif" }}>
                      {language === "tl" ? "Destinasyon" : "Drop-off"}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: "14px",
                        fontWeight: 800,
                        color: "#0F172A",
                        fontFamily: "Poppins, sans-serif",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {trip.dropoff}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Right Price, Mode & Distance */}
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "4px",
                  flexShrink: 0,
                }}
              >
                <Typography
                  sx={{
                    fontSize: "18px",
                    fontWeight: 800,
                    color: "#FF6B00",
                    fontFamily: "Poppins, sans-serif",
                  }}
                >
                  {trip.price}
                </Typography>

                <Chip
                  label={trip.type === "Share" ? (language === "tl" ? "Shared Trip" : "Shared Trip") : (language === "tl" ? "Solo Trip" : "Solo Trip")}
                  size="small"
                  sx={{
                    backgroundColor: trip.type === "Share" ? "#E6F4EA" : "#FFF5EB",
                    color: trip.type === "Share" ? "#1E8E3E" : "#FF6B00",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    height: "22px",
                    fontFamily: "Poppins, sans-serif",
                  }}
                />

                <Typography
                  sx={{
                    fontSize: "11px",
                    color: "#64748B",
                    fontWeight: 500,
                    marginTop: "2px",
                    fontFamily: "Poppins, sans-serif",
                  }}
                >
                  {trip.time} {trip.distanceKm ? `• ${trip.distanceKm.toFixed(1)} km` : ''}
                </Typography>
              </Box>
            </Box>

            {/* Bottom Buttons Row */}
            <Box sx={{ display: "flex", gap: "10px" }} onClick={(e) => e.stopPropagation()}>
              <Button
                variant="contained"
                onClick={() => handleRebook(trip)}
                endIcon={<ArrowForwardIcon />}
                sx={{
                  flexGrow: 1,
                  backgroundColor: "#FF5B00",
                  color: "#FFFFFF",
                  borderRadius: "14px",
                  fontWeight: 700,
                  fontSize: "13px",
                  textTransform: "none",
                  height: "42px",
                  boxShadow: "none",
                  fontFamily: "Poppins, sans-serif",
                  "&:hover": { backgroundColor: "#E05000" },
                }}
              >
                {language === "tl" ? "Muling Mag-book" : "Rebook"}
              </Button>

              <Button
                variant="contained"
                onClick={() => navigate(`/trip-details/${trip.id}`, { state: { trip } })}
                sx={{
                  flexGrow: 1,
                  backgroundColor: "#F1F5F9",
                  color: "#475569",
                  borderRadius: "14px",
                  fontWeight: 600,
                  fontSize: "13px",
                  textTransform: "none",
                  height: "42px",
                  boxShadow: "none",
                  fontFamily: "Poppins, sans-serif",
                  "&:hover": { backgroundColor: "#E2E8F0" },
                }}
              >
                {language === "tl" ? "Tignan ang Detalye" : "See Details"}
              </Button>
            </Box>
          </Paper>
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
          padding: "16px 20px calc(var(--safe-area-bottom) + 32px) 20px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "40px" }}>
            <CircularProgress sx={{ color: "#FF6B00" }} />
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
                backgroundColor: "#FF6B00",
                color: "#FFFFFF",
                borderRadius: "14px",
                fontWeight: 700,
                textTransform: "none",
                boxShadow: "none",
                fontFamily: "Poppins, sans-serif",
                "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
              }}
            >
              {language === "tl" ? "Mag-book ng Biyahe" : "Book a Ride"}
            </Button>
          </Box>
        ) : (
          <>
            {renderSection(language === "tl" ? "NGAYONG ARAW" : "TODAY", grouped.today)}
            {renderSection(language === "tl" ? "KAHAPON" : "YESTERDAY", grouped.yesterday)}
            {renderSection(language === "tl" ? "MAS MAAGA SA LINGGONG ITO" : "EARLIER THIS WEEK", grouped.thisWeek)}
            {renderSection(language === "tl" ? "NAKARAANG MGA BIYAHE" : "PREVIOUS TRIPS", grouped.previous)}
          </>
        )}
      </Box>
    </Box>
  );
};

export default PassengerHistory;

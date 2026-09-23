import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CircularProgress from "@mui/material/CircularProgress";
import Rating from "@mui/material/Rating";
import Divider from "@mui/material/Divider";
import Avatar from "@mui/material/Avatar";
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
  const [selectedDetails, setSelectedDetails] = useState<HistoryTrip | null>(null);
  const [selectedRatingDetail, setSelectedRatingDetail] = useState<HistoryTrip | null>(null);
  const [activeTab, setActiveTab] = useState<"trips" | "ratings">("trips");

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

  const todayTrips = trips.filter((t) => t.dateGroup === "NGAYONG ARAW");
  const pastTrips = trips.filter((t) => t.dateGroup === "NAKARAANG ARAW");

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
      {/* Shared Standardized Reusable Page Header */}
      <PageHeader
        title={language === "tl" ? "Kasaysayan ng Biyahe" : "Trip History"}
        onBack={() => navigate("/dashboard")}
      />

      {/* Segmented Control / Tabs */}
      <Box sx={{ px: 2.5, pt: 1.5, pb: 0.5 }}>
        <Box
          sx={{
            display: "flex",
            backgroundColor: "#F1F5F9",
            borderRadius: "14px",
            p: 0.5,
            gap: 0.5,
          }}
        >
          <Button
            fullWidth
            disableRipple
            onClick={() => setActiveTab("trips")}
            sx={{
              py: 0.75,
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: activeTab === "trips" ? 700 : 500,
              fontFamily: "Poppins, sans-serif",
              textTransform: "none",
              backgroundColor: activeTab === "trips" ? "#FFFFFF" : "transparent",
              color: activeTab === "trips" ? "#FF6B00" : "#64748B",
              boxShadow: activeTab === "trips" ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
              "&:hover": { backgroundColor: activeTab === "trips" ? "#FFFFFF" : "rgba(0,0,0,0.02)" },
            }}
          >
            {language === "tl" ? "Mga Biyahe" : "Past Trips"}
          </Button>
          <Button
            fullWidth
            disableRipple
            onClick={() => setActiveTab("ratings")}
            sx={{
              py: 0.75,
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: activeTab === "ratings" ? 700 : 500,
              fontFamily: "Poppins, sans-serif",
              textTransform: "none",
              backgroundColor: activeTab === "ratings" ? "#FFFFFF" : "transparent",
              color: activeTab === "ratings" ? "#FF6B00" : "#64748B",
              boxShadow: activeTab === "ratings" ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
              "&:hover": { backgroundColor: activeTab === "ratings" ? "#FFFFFF" : "rgba(0,0,0,0.02)" },
            }}
          >
            {language === "tl" ? "Mga Rating" : "Driver Ratings"}
          </Button>
        </Box>
      </Box>

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
        ) : activeTab === "ratings" ? (
          <Paper
            elevation={0}
            sx={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #F1F5F9",
              borderRadius: "20px",
              overflow: "hidden",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
            }}
          >
            {trips.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, px: 2 }}>
                <Typography sx={{ fontSize: "14px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Wala pang nabibigay na rating sa drayber." : "No driver ratings submitted yet."}
                </Typography>
              </Box>
            ) : (
              trips.map((trip, idx) => (
                <React.Fragment key={`rating-${trip.id}`}>
                  {idx > 0 && <Divider sx={{ borderColor: "#F1F5F9" }} />}
                  <Box
                    onClick={() => setSelectedRatingDetail(trip)}
                    sx={{
                      p: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2,
                      cursor: "pointer",
                      transition: "background-color 0.15s ease",
                      "&:hover": { backgroundColor: "#F8FAFC" },
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {trip.driverName || "Juan Dela Cruz"} ({trip.bodyNumber || "T-1024"})
                        </Typography>
                        <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontFamily: "Poppins, sans-serif", flexShrink: 0, ml: 1 }}>
                          {trip.dateString}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Rating value={5} readOnly size="small" sx={{ color: "#FF6B00", fontSize: 16 }} />
                        <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#FF6B00", fontFamily: "Poppins, sans-serif" }}>
                          5.0 / 5.0
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif", fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", mt: 0.5 }}>
                        {language === "tl"
                          ? '"Ligtas at maayos ang biyahe. Mabait at magalang ang drayber."'
                          : '"Safe and smooth ride. The driver was kind and courteous."'}
                      </Typography>
                    </Box>
                  </Box>
                </React.Fragment>
              ))
            )}
          </Paper>
        ) : (
          <>
            {/* Section 1: NGAYONG ARAW */}
            {todayTrips.length > 0 && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <Typography
                  sx={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#64748B",
                    letterSpacing: "0.5px",
                    fontFamily: "Poppins, sans-serif",
                  }}
                >
                  {language === 'tl' ? 'NGAYONG ARAW' : 'TODAY'}
                </Typography>

                {todayTrips.map((trip) => (
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
                    {/* Upper Details Row with 16px horizontal spacing */}
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
                            <Typography sx={{ fontSize: "11px", color: "#64748B", fontWeight: 500 }}>
                              Pickup
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: "14px",
                                fontWeight: 800,
                                color: "#0F172A",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {trip.pickup}
                            </Typography>
                          </Box>

                          <Box>
                            <Typography sx={{ fontSize: "11px", color: "#64748B", fontWeight: 500 }}>
                              Drop-off
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: "14px",
                                fontWeight: 800,
                                color: "#0F172A",
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

                      {/* Right Price & Badge */}
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

                        <Box
                          sx={{
                            backgroundColor: "#FFF5EB",
                            color: "#FF6B00",
                            fontSize: "12px",
                            fontWeight: 600,
                            padding: "2px 14px",
                            borderRadius: "12px",
                            fontFamily: "Poppins, sans-serif",
                          }}
                        >
                          {trip.type}
                        </Box>

                        <Typography
                          sx={{
                            fontSize: "11px",
                            color: "#94A3B8",
                            fontWeight: 500,
                            marginTop: "2px",
                          }}
                        >
                          {trip.time}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Bottom Buttons Row: Rebook -> & See Details */}
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
                          "&:hover": { backgroundColor: "#E05000" },
                        }}
                      >
                        Rebook
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
                          "&:hover": { backgroundColor: "#E2E8F0" },
                        }}
                      >
                        See Details
                      </Button>
                    </Box>
                  </Paper>
                ))}
              </Box>
            )}

            {/* Section 2: NAKARAANG ARAW */}
            {pastTrips.length > 0 && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <Typography
                  sx={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#64748B",
                    letterSpacing: "0.5px",
                    fontFamily: "Poppins, sans-serif",
                  }}
                >
                  {language === 'tl' ? 'NAKARAANG MGA BIYAHE' : 'PAST TRIPS'}
                </Typography>

                {pastTrips.map((trip) => (
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
                    {/* Upper Details Row with 16px horizontal spacing */}
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
                            <Typography sx={{ fontSize: "11px", color: "#64748B", fontWeight: 500 }}>
                              Pickup
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: "14px",
                                fontWeight: 800,
                                color: "#0F172A",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {trip.pickup}
                            </Typography>
                          </Box>

                          <Box>
                            <Typography sx={{ fontSize: "11px", color: "#64748B", fontWeight: 500 }}>
                              Drop-off
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: "14px",
                                fontWeight: 800,
                                color: "#0F172A",
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

                      {/* Right Price & Badge */}
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

                        <Box
                          sx={{
                            backgroundColor: "#FFF5EB",
                            color: "#FF6B00",
                            fontSize: "12px",
                            fontWeight: 600,
                            padding: "2px 14px",
                            borderRadius: "12px",
                            fontFamily: "Poppins, sans-serif",
                          }}
                        >
                          {trip.type}
                        </Box>

                        <Typography
                          sx={{
                            fontSize: "11px",
                            color: "#94A3B8",
                            fontWeight: 500,
                            marginTop: "2px",
                          }}
                        >
                          {trip.time}
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
                          "&:hover": { backgroundColor: "#E05000" },
                        }}
                      >
                        Rebook
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
                          "&:hover": { backgroundColor: "#E2E8F0" },
                        }}
                      >
                        See Details
                      </Button>
                    </Box>
                  </Paper>
                ))}
              </Box>
            )}

            {todayTrips.length === 0 && pastTrips.length === 0 && (
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
            )}
          </>
        )}
      </Box>

      {/* Trip Details Modal */}
      <Dialog
        open={Boolean(selectedDetails)}
        onClose={() => setSelectedDetails(null)}
        slotProps={{
          paper: {
            sx: { borderRadius: "20px", padding: "8px", width: "90%", maxWidth: "340px" },
          },
        }}
      >
        {selectedDetails && (
          <>
            <DialogTitle sx={{ fontWeight: 800, fontSize: "16px", color: "#0F172A" }}>
              {language === 'tl' ? 'Detalye ng Biyahe' : 'Trip Details'}
            </DialogTitle>
            <DialogContent sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                ID: <strong>{selectedDetails.id}</strong>
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                {language === 'tl' ? 'Petsa:' : 'Date:'} <strong>{selectedDetails.dateString} ({selectedDetails.time})</strong>
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                Pickup: <strong>{selectedDetails.pickup}</strong>
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                Drop-off: <strong>{selectedDetails.dropoff}</strong>
              </Typography>
              {selectedDetails.driverName && (
                <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                  {language === 'tl' ? 'Drayber:' : 'Driver:'} <strong>{selectedDetails.driverName} ({selectedDetails.bodyNumber})</strong>
                </Typography>
              )}
              {selectedDetails.type === "Share" && (
                <Box sx={{ p: 1, borderRadius: "10px", backgroundColor: "#E6F4EA", border: "1px solid #A7F3D0" }}>
                  <Typography sx={{ fontSize: "11px", color: "#1E8E3E", fontWeight: 700 }}>
                    ✓ Final Proportionate Shared Tariff Applied
                  </Typography>
                  <Typography sx={{ fontSize: "12px", color: "#065F46" }}>
                    {language === 'tl'
                      ? 'Pinagsamang carpool fare base sa aktwal na sakay sa ruta.'
                      : 'Combined carpool fare based on actual riders on route.'}
                  </Typography>
                </Box>
              )}
              <Typography sx={{ fontSize: "14px", fontWeight: 800, color: "#FF6B00", marginTop: "6px" }}>
                {language === 'tl' ? 'Bayad:' : 'Fare:'} {selectedDetails.price} ({selectedDetails.type === "Share" ? (language === 'tl' ? "Shared Ride" : "Shared Ride") : (language === 'tl' ? "Solo Charter" : "Solo Charter")})
              </Typography>

              {/* Previously Submitted Rating & Feedback */}
              <Box sx={{ p: 1.5, borderRadius: "12px", backgroundColor: "#FFF8F0", border: "1px solid #FFD6B3", mt: 0.5 }}>
                <Typography sx={{ fontSize: "11px", color: "#FF6B00", fontWeight: 800, textTransform: "uppercase" }}>
                  {language === 'tl' ? 'Iyong Naibigay na Rating at Feedback' : 'Your Rating & Feedback'}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 0.5 }}>
                  <Rating value={5} readOnly size="small" />
                  <Typography sx={{ fontSize: "12px", fontWeight: 800, color: "#0F172A" }}>
                    5.0 / 5.0
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: "11px", color: "#475569", fontStyle: "italic" }}>
                  {language === 'tl'
                    ? '"Ligtas at maayos ang biyahe. Mabait at magalang ang drayber."'
                    : '"Safe and smooth ride. The driver was kind and courteous."'}
                </Typography>
              </Box>
            </DialogContent>
            <DialogActions sx={{ display: "flex", justifyContent: "space-between", px: 2, pb: 1.5 }}>
              <Button
                size="small"
                onClick={() => {
                  const targetTrip = selectedDetails;
                  setSelectedDetails(null);
                  navigate('/incident-report', {
                    state: {
                      from: '/history',
                      franchiseNo: targetTrip.bodyNumber,
                      bookingId: targetTrip.id,
                    },
                  });
                }}
                sx={{ color: "#EF4444", fontWeight: 600, fontSize: "12px", textTransform: "none" }}
              >
                {language === 'tl' ? 'I-ulat ang Biyahe' : 'Report Trip'}
              </Button>
              <Button
                onClick={() => setSelectedDetails(null)}
                sx={{ color: "#FF6B00", fontWeight: 700 }}
              >
                {language === 'tl' ? 'Isara' : 'Close'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Full-Screen Driver Rating Detail Modal (Rate-the-App format) */}
      <Dialog
        fullScreen
        open={Boolean(selectedRatingDetail)}
        onClose={() => setSelectedRatingDetail(null)}
        sx={{ "& .MuiDialog-paper": { backgroundColor: "#FAFAFA" } }}
      >
        {selectedRatingDetail && (
          <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
            <PageHeader
              title={language === "tl" ? "Rating sa Drayber" : "Driver Rating"}
              onBack={() => setSelectedRatingDetail(null)}
            />

            <Box
              className="hide-scrollbar"
              sx={{
                flexGrow: 1,
                overflowY: "auto",
                p: 2.5,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                pb: "calc(var(--safe-area-bottom) + 24px)",
              }}
            >
              {/* Card 1: Driver Info & Non-editable Score */}
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  borderRadius: "20px",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #F1F5F9",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: 1.5,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                  <Avatar sx={{ width: 52, height: 52, backgroundColor: "#FF6B00", fontWeight: 800, fontSize: "20px" }}>
                    {(selectedRatingDetail.driverName || "Juan Dela Cruz").charAt(0)}
                  </Avatar>
                  <Box sx={{ textAlign: "left" }}>
                    <Typography sx={{ fontSize: "16px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                      {selectedRatingDetail.driverName || "Juan Dela Cruz"}
                    </Typography>
                    <Typography sx={{ fontSize: "12.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                      Tricycle Body No. {selectedRatingDetail.bodyNumber || "T-1024"} • {selectedRatingDetail.dateString}
                    </Typography>
                  </Box>
                </Box>

                <Divider sx={{ width: "100%", borderColor: "#F1F5F9" }} />

                <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", mt: 0.5 }}>
                  {language === "tl" ? "Naibigay mong Rating sa Drayber:" : "Your Rating for this Driver:"}
                </Typography>

                <Rating
                  value={5}
                  readOnly
                  sx={{
                    my: 1,
                    color: "#FF6B00",
                    "& .MuiRating-icon": {
                      fontSize: "40px",
                      mx: 0.5,
                    },
                  }}
                />

                <Chip
                  label="5.0 / 5.0 - Napakahusay (Excellent)"
                  sx={{
                    backgroundColor: "#FFF7ED",
                    color: "#FF6B00",
                    fontWeight: 800,
                    fontSize: "13px",
                    height: "32px",
                    border: "1px solid #FFD6B3",
                  }}
                />
              </Paper>

              {/* Card 2: Selected Compliments */}
              <Paper
                elevation={0}
                sx={{
                  p: 2.5,
                  borderRadius: "20px",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #F1F5F9",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Naibigay na Komplimento" : "Selected Compliments"}
                </Typography>

                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {[
                    language === "tl" ? "✓ Magalang na Drayber" : "✓ Polite Driver",
                    language === "tl" ? "✓ Ligtas Magmaneho" : "✓ Safe Driving",
                    language === "tl" ? "✓ Malinis ang Sakayan" : "✓ Clean Vehicle",
                    language === "tl" ? "✓ Sa Oras Dumating" : "✓ On-Time Arrival",
                  ].map((badge, bIdx) => (
                    <Chip
                      key={bIdx}
                      label={badge}
                      size="small"
                      sx={{
                        backgroundColor: "#F8FAFC",
                        border: "1px solid #E2E8F0",
                        color: "#0F172A",
                        fontWeight: 600,
                        fontSize: "12px",
                        py: 1.5,
                      }}
                    />
                  ))}
                </Box>
              </Paper>

              {/* Card 3: Submitted Feedback Comments */}
              <Paper
                elevation={0}
                sx={{
                  p: 2.5,
                  borderRadius: "20px",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #F1F5F9",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Iyong Komento o Mensahe" : "Your Additional Comments"}
                </Typography>

                <Box
                  sx={{
                    p: 2,
                    borderRadius: "14px",
                    backgroundColor: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                  }}
                >
                  <Typography sx={{ fontSize: "13px", color: "#334155", fontFamily: "Poppins, sans-serif", fontStyle: "italic", lineHeight: 1.5 }}>
                    {language === "tl"
                      ? '"Ligtas at maayos ang biyahe. Mabait at magalang ang drayber."'
                      : '"Safe and smooth ride. The driver was kind and courteous."'}
                  </Typography>
                </Box>
              </Paper>
            </Box>
          </Box>
        )}
      </Dialog>
    </Box>
  );
};

export default PassengerHistory;

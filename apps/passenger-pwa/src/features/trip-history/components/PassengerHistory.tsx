import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

interface HistoryTrip {
  id: string;
  pickup: string;
  pickupLat: number;
  pickupLng: number;
  dropoff: string;
  dropoffLat: number;
  dropoffLng: number;
  price: string;
  type: "Solo" | "Share";
  time: string;
  dateGroup: "NGAYONG ARAW" | "NAKARAANG ARAW";
  driverName?: string;
  bodyNumber?: string;
  dateString?: string;
}

const MOCK_HISTORY_TRIPS: HistoryTrip[] = [
  {
    id: "TRIP-2026-0813-01",
    pickup: "Calapan Port",
    pickupLat: 13.4248,
    pickupLng: 121.1812,
    dropoff: "Xentro Mall Calapan",
    dropoffLat: 13.4130,
    dropoffLng: 121.1790,
    price: "₱66.40",
    type: "Solo",
    time: "2:30 PM",
    dateGroup: "NGAYONG ARAW",
    driverName: "Juan Dela Cruz",
    bodyNumber: "TODA-104",
    dateString: "August 13, 2026",
  },
  {
    id: "TRIP-2026-0813-02",
    pickup: "Calapan City Hall",
    pickupLat: 13.3980,
    pickupLng: 121.1824,
    dropoff: "Filipiniana Hotel Calapan",
    dropoffLat: 13.4100,
    dropoffLng: 121.1780,
    price: "₱64.40",
    type: "Solo",
    time: "9:15 AM",
    dateGroup: "NGAYONG ARAW",
    driverName: "Pedro Penduko",
    bodyNumber: "TODA-088",
    dateString: "August 13, 2026",
  },
  {
    id: "TRIP-2026-0812-01",
    pickup: "Puregold -Calapan",
    pickupLat: 13.4120,
    pickupLng: 121.1800,
    dropoff: "Santo Niño Cathedral (Dioc...",
    dropoffLat: 13.4128,
    dropoffLng: 121.1830,
    price: "₱20.00",
    type: "Share",
    time: "5:45 PM",
    dateGroup: "NAKARAANG ARAW",
    driverName: "Mario Reyes",
    bodyNumber: "TODA-215",
    dateString: "August 12, 2026",
  },
];

const PassengerHistory: React.FC = () => {
  const navigate = useNavigate();
  const [selectedDetails, setSelectedDetails] = useState<HistoryTrip | null>(null);

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

  const todayTrips = MOCK_HISTORY_TRIPS.filter((t) => t.dateGroup === "NGAYONG ARAW");
  const pastTrips = MOCK_HISTORY_TRIPS.filter((t) => t.dateGroup === "NAKARAANG ARAW");

  return (
    <Box className="app-container">
      <Box
        component="main"
        className="phone-simulator hide-scrollbar"
        sx={{
          backgroundColor: "#FAFAFA",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          userSelect: "none",
        }}
      >
        {/* Top Header Card matching PASSENGER HISTORY.png */}
        <Box
          sx={{
            background: "linear-gradient(135deg, #FF5B00 0%, #FF6D00 100%)",
            padding: "24px 20px 20px 20px",
            display: "flex",
            alignItems: "center",
            boxShadow: "0 4px 16px rgba(255, 91, 0, 0.25)",
            position: "relative",
          }}
        >
          <IconButton
            onClick={() => navigate("/dashboard")}
            sx={{
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              color: "#FFFFFF",
              width: "44px",
              height: "44px",
              borderRadius: "14px",
              "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.3)" },
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography
            sx={{
              flexGrow: 1,
              textAlign: "center",
              fontSize: "22px",
              fontWeight: 800,
              color: "#FFFFFF",
              marginRight: "44px",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            History
          </Typography>
        </Box>

        {/* Scrollable Content Container */}
        <Box
          className="hide-scrollbar"
          sx={{
            flexGrow: 1,
            overflowY: "auto",
            padding: "16px 20px 32px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {/* Section 1: NGAYONG ARAW */}
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
              NGAYONG ARAW
            </Typography>

            {todayTrips.map((trip) => (
              <Paper
                key={trip.id}
                elevation={0}
                sx={{
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #F1F5F9",
                  borderRadius: "20px",
                  padding: "16px",
                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {/* Upper Details Row */}
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  {/* Left Timeline & Locations */}
                  <Box sx={{ display: "flex", gap: "12px", flexGrow: 1, overflow: "hidden" }}>
                    {/* Timeline dots & line */}
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        paddingTop: "4px",
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

                    {/* Locations text */}
                    <Box sx={{ flexGrow: 1, overflow: "hidden" }}>
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
                <Box sx={{ display: "flex", gap: "10px" }}>
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
                    onClick={() => setSelectedDetails(trip)}
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

          {/* Section 2: NAKARAANG ARAW */}
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
              NAKARAANG ARAW
            </Typography>

            {pastTrips.map((trip) => (
              <Paper
                key={trip.id}
                elevation={0}
                sx={{
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #F1F5F9",
                  borderRadius: "20px",
                  padding: "16px",
                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {/* Upper Details Row */}
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  {/* Left Timeline & Locations */}
                  <Box sx={{ display: "flex", gap: "12px", flexGrow: 1, overflow: "hidden" }}>
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        paddingTop: "4px",
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

                    <Box sx={{ flexGrow: 1, overflow: "hidden" }}>
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
                <Box sx={{ display: "flex", gap: "10px" }}>
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
                    onClick={() => setSelectedDetails(trip)}
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
                Detalye ng Biyahe
              </DialogTitle>
              <DialogContent sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                  ID: <strong>{selectedDetails.id}</strong>
                </Typography>
                <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                  Petsa: <strong>{selectedDetails.dateString} ({selectedDetails.time})</strong>
                </Typography>
                <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                  Pickup: <strong>{selectedDetails.pickup}</strong>
                </Typography>
                <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                  Drop-off: <strong>{selectedDetails.dropoff}</strong>
                </Typography>
                <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                  Drayber: <strong>{selectedDetails.driverName} ({selectedDetails.bodyNumber})</strong>
                </Typography>
                <Typography sx={{ fontSize: "14px", fontWeight: 800, color: "#FF6B00", marginTop: "6px" }}>
                  Bayad: {selectedDetails.price} ({selectedDetails.type})
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={() => setSelectedDetails(null)}
                  sx={{ color: "#FF6B00", fontWeight: 700 }}
                >
                  Isara
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      </Box>
    </Box>
  );
};

export default PassengerHistory;

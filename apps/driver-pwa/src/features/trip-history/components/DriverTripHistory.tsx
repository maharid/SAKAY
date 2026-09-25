import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  IconButton,
  Chip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Rating as MuiRating,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PlaceIcon from '@mui/icons-material/Place';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import StarIcon from '@mui/icons-material/Star';

import PageHeader from '../../../common/components/PageHeader';
import { fetchDriverTrips } from '../../../services/driverApiService';
import { useLanguage } from '../../../utils/LanguageContext';
import { formatShortBookingId } from '@sakay/shared';
import { DriverFeedbackModal } from '../../feedback/components/DriverFeedbackModal';

export interface TripRecord {
  id: string;
  bookingCode: string;
  passengerName: string;
  pickupLocation: string;
  dropoffLocation: string;
  distanceKm: number;
  fareAmount: number;
  tripMode: 'Single Commuter' | 'Shared Ride';
  status: string;
  date: string;
  time: string;
}

export const DriverTripHistory: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState<TripRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'trips' | 'ratings'>('trips');
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [selectedTripToRate, setSelectedTripToRate] = useState<TripRecord | null>(null);
  const [givenRatings, setGivenRatings] = useState<any[]>([]);

  const loadGivenRatings = () => {
    try {
      const raw = localStorage.getItem('sakay_driver_passenger_ratings');
      setGivenRatings(raw ? JSON.parse(raw) : []);
    } catch {
      setGivenRatings([]);
    }
  };

  useEffect(() => {
    loadGivenRatings();
    const driverId = localStorage.getItem('sakay_driver_id') || undefined;
    fetchDriverTrips(driverId)
      .then((data) => {
        const mapped: TripRecord[] = (data || []).map((b: any) => ({
          id: b.id,
          bookingCode: formatShortBookingId(b.bookingCode || b.id),
          passengerName: b.passengerName || b.passenger_name || 'Juan Dela Cruz',
          pickupLocation: b.pickupLocation || 'Calapan City',
          dropoffLocation: b.dropoffLocation || 'Calapan City',
          distanceKm: b.distanceKm || 0,
          fareAmount: b.fareAmount || 0,
          tripMode: b.tripMode || 'Single Commuter',
          status: b.status || 'Completed',
          date: b.date || 'Recent',
          time: b.time || '',
        }));
        setTrips(mapped);
      })
      .catch((err) => console.warn('[DriverTripHistory] Fetch error:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleOpenRateModal = (trip: TripRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedTripToRate(trip);
    setRatingModalOpen(true);
  };

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* Header matching Alerts header style */}
      <PageHeader
        title={language === 'tl' ? 'Kasaysayan ng Biyahe' : 'Trip History'}
        onBack={() => navigate('/driver/home')}
      />

      {/* Segmented Control / Tabs matching Passenger History */}
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
        <Box
          sx={{
            display: 'flex',
            backgroundColor: '#E2E8F0',
            borderRadius: '14px',
            p: 0.5,
            gap: 0.5,
          }}
        >
          <Button
            fullWidth
            disableRipple
            onClick={() => setActiveTab('trips')}
            sx={{
              py: 0.75,
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: activeTab === 'trips' ? 700 : 500,
              fontFamily: 'Poppins, sans-serif',
              textTransform: 'none',
              backgroundColor: activeTab === 'trips' ? '#FFFFFF' : 'transparent',
              color: activeTab === 'trips' ? '#FF6B00' : '#64748B',
              boxShadow: activeTab === 'trips' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
              '&:hover': { backgroundColor: activeTab === 'trips' ? '#FFFFFF' : 'rgba(0,0,0,0.02)' },
            }}
          >
            {language === 'tl' ? 'Mga Biyahe' : 'Past Rides'}
          </Button>
          <Button
            fullWidth
            disableRipple
            onClick={() => {
              loadGivenRatings();
              setActiveTab('ratings');
            }}
            sx={{
              py: 0.75,
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: activeTab === 'ratings' ? 700 : 500,
              fontFamily: 'Poppins, sans-serif',
              textTransform: 'none',
              backgroundColor: activeTab === 'ratings' ? '#FFFFFF' : 'transparent',
              color: activeTab === 'ratings' ? '#FF6B00' : '#64748B',
              boxShadow: activeTab === 'ratings' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
              '&:hover': { backgroundColor: activeTab === 'ratings' ? '#FFFFFF' : 'rgba(0,0,0,0.02)' },
            }}
          >
            {language === 'tl' ? 'Rating sa Pasahero' : 'Passenger Ratings'}
          </Button>
        </Box>
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, pb: 4 }}>
        {loading ? (
          <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <CircularProgress size={32} sx={{ color: '#FF6B00' }} />
          </Box>
        ) : activeTab === 'ratings' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {givenRatings.length === 0 ? (
              <Paper
                elevation={0}
                sx={{
                  p: 4,
                  borderRadius: '16px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  textAlign: 'center',
                }}
              >
                <StarIcon sx={{ fontSize: 44, color: '#CBD5E1', mb: 1 }} />
                <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', mb: 0.5 }}>
                  {language === 'tl' ? 'Wala pang naitatalang rating sa pasahero' : 'No passenger ratings submitted yet'}
                </Typography>
                <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                  {language === 'tl'
                    ? 'Lilitaw dito ang mga rating at feedback na ibinigay mo sa iyong mga pasahero.'
                    : 'Ratings and feedback submitted for your passengers will appear here.'}
                </Typography>
              </Paper>
            ) : (
              givenRatings.map((r, i) => (
                <Paper
                  key={i}
                  elevation={0}
                  sx={{
                    p: 2,
                    borderRadius: '16px',
                    border: '1px solid #E2E8F0',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography sx={{ fontSize: '14px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                      {r.passengerName || 'Calapan Commuter'}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'Poppins, sans-serif' }}>
                      {r.date}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <MuiRating value={r.stars || 5} readOnly size="small" sx={{ color: '#FF6B00' }} />
                    <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#FF6B00' }}>
                      {(r.stars || 5).toFixed(1)} / 5.0
                    </Typography>
                  </Box>

                  {r.tags && r.tags.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {r.tags.map((t: string) => (
                        <Chip
                          key={t}
                          label={t}
                          size="small"
                          sx={{ fontSize: '10.5px', backgroundColor: '#FFF8F0', color: '#FF6B00', height: 22 }}
                        />
                      ))}
                    </Box>
                  )}

                  {r.comment && (
                    <Typography sx={{ fontSize: '12px', color: '#475569', fontStyle: 'italic', mt: 0.5 }}>
                      "{r.comment}"
                    </Typography>
                  )}
                </Paper>
              ))
            )}
          </Box>
        ) : trips.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 4,
              borderRadius: '16px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              textAlign: 'center',
              mt: 2,
            }}
          >
            <TwoWheelerIcon sx={{ fontSize: 44, color: '#CBD5E1', mb: 1 }} />
            <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', mb: 0.5 }}>
              {language === 'tl' ? 'Walang nahanap na biyahe' : 'No trips found yet'}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
              {language === 'tl'
                ? 'Lilitaw dito ang kumpletong rekord ng iyong mga natapos na biyahe.'
                : 'Your completed trip records will appear here once you finish a ride.'}
            </Typography>
          </Paper>
        ) : (
          trips.map((trip) => (
            <Paper
              key={trip.id}
              elevation={0}
              onClick={() => navigate(`/driver/trip-detail/${trip.id}`, { state: { trip } })}
              sx={{
                p: 2,
                borderRadius: '16px',
                border: '1px solid #E2E8F0',
                backgroundColor: '#FFFFFF',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                cursor: 'pointer',
                transition: 'transform 0.15s ease',
                '&:hover': {
                  transform: 'scale(1.01)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 800, color: '#0F172A' }}>
                    {trip.bookingCode}
                  </Typography>
                  <Chip
                    label={trip.tripMode}
                    size="small"
                    sx={{
                      fontSize: '10px',
                      fontWeight: 700,
                      backgroundColor: trip.tripMode === 'Shared Ride' ? '#E6F4EA' : '#FFF8F0',
                      color: trip.tripMode === 'Shared Ride' ? '#1E8E3E' : '#FF6B00',
                    }}
                  />
                </Box>
                <Typography sx={{ fontSize: '16px', fontWeight: 900, color: '#FF6B00' }}>
                  ₱{trip.fareAmount.toFixed(2)}
                </Typography>
              </Box>

              <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                {language === 'tl' ? 'Pasahero:' : 'Passenger:'} <strong>{trip.passengerName}</strong> {trip.distanceKm > 0 ? `• ${trip.distanceKm} km` : ''} • {trip.date}{trip.time ? `, ${trip.time}` : ''}
              </Typography>

              <Divider sx={{ my: 0.5 }} />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <RadioButtonUncheckedIcon sx={{ color: '#FF6B00', fontSize: 16, stroke: '#FF6B00', strokeWidth: 1.5 }} />
                  <Typography sx={{ fontSize: '12px', color: '#334155' }}>{trip.pickupLocation}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PlaceIcon sx={{ color: '#FF6B00', fontSize: 18 }} />
                  <Typography sx={{ fontSize: '12px', color: '#334155' }}>{trip.dropoffLocation}</Typography>
                </Box>
              </Box>

              {/* Action row to rate passenger */}
              <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                {(() => {
                  const savedRating = givenRatings.find(
                    (r: any) => r.bookingId === trip.id || r.bookingId === trip.bookingCode || r.id === trip.id
                  );
                  if (savedRating) {
                    return (
                      <Chip
                        icon={<StarIcon sx={{ fontSize: '13px !important', color: '#FF6B00 !important' }} />}
                        label={`${language === 'tl' ? 'Na-rate:' : 'Rated:'} ${(savedRating.stars || 5).toFixed(1)} ★`}
                        size="small"
                        sx={{
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: '#FFF8F0',
                          color: '#FF6B00',
                          height: '24px',
                          fontFamily: 'Poppins, sans-serif',
                        }}
                      />
                    );
                  }
                  return (
                    <Button
                      size="small"
                      startIcon={<StarIcon sx={{ fontSize: 15 }} />}
                      onClick={(e) => handleOpenRateModal(trip, e)}
                      sx={{
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: '#FF6B00',
                        textTransform: 'none',
                        py: 0.5,
                        px: 1.2,
                        borderRadius: '8px',
                        backgroundColor: '#FFF8F0',
                        '&:hover': { backgroundColor: '#FFE4D6' },
                      }}
                    >
                      {language === 'tl' ? 'I-rate ang Pasahero' : 'Rate Passenger'}
                    </Button>
                  );
                })()}
              </Box>
            </Paper>
          ))
        )}
      </Box>

      {/* Trip Details Dialog Modal */}
      {selectedTrip && (
        <Dialog
          open={Boolean(selectedTrip)}
          onClose={() => setSelectedTrip(null)}
          slotProps={{
            paper: {
              sx: {
                borderRadius: '20px',
                padding: '8px',
                backgroundColor: '#FFFFFF',
                maxWidth: '360px',
              },
            },
          }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ReceiptLongIcon sx={{ color: '#FF6B00' }} />
              <Typography sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A' }}>
                Trip Details
              </Typography>
            </Box>
            <Chip
              label={selectedTrip.tripMode}
              size="small"
              sx={{ backgroundColor: '#FF6B00', color: '#FFFFFF', fontWeight: 800 }}
            />
          </DialogTitle>
          <DialogContent sx={{ py: 1 }}>
            <Box sx={{ p: 1.5, borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', mb: 2 }}>
              <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700 }}>BOOKING CODE</Typography>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A' }}>{selectedTrip.bookingCode}</Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748B', mt: 0.5 }}>
                Date: {selectedTrip.date} {selectedTrip.time ? `• ${selectedTrip.time}` : ''}
              </Typography>
            </Box>

            <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#0F172A', mb: 0.5 }}>
              PASSENGER
            </Typography>
            <Typography sx={{ fontSize: '14px', color: '#334155', mb: 1.5 }}>
              {selectedTrip.passengerName}
            </Typography>

            <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#0F172A', mb: 0.5 }}>
              ROUTE & DISTANCE
            </Typography>
            <Typography sx={{ fontSize: '13px', color: '#334155', mb: 0.5 }}>
              <strong>From:</strong> {selectedTrip.pickupLocation}
            </Typography>
            <Typography sx={{ fontSize: '13px', color: '#334155', mb: 1.5 }}>
              <strong>To:</strong> {selectedTrip.dropoffLocation} {selectedTrip.distanceKm > 0 ? `(${selectedTrip.distanceKm} km)` : ''}
            </Typography>

            <Divider sx={{ my: 1.5 }} />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
                Total Fare:
              </Typography>
              <Typography sx={{ fontSize: '18px', fontWeight: 900, color: '#FF6B00' }}>
                ₱{selectedTrip.fareAmount.toFixed(2)}
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<StarIcon />}
              onClick={() => {
                const tripToRate = selectedTrip;
                setSelectedTrip(null);
                handleOpenRateModal(tripToRate);
              }}
              sx={{
                height: 44,
                borderRadius: '12px',
                backgroundColor: '#FF6B00',
                fontWeight: 700,
                textTransform: 'none',
                '&:hover': { backgroundColor: '#E05000' },
              }}
            >
              {language === 'tl' ? 'I-rate ang Pasahero' : 'Rate Passenger'}
            </Button>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => setSelectedTrip(null)}
              sx={{
                height: 40,
                borderRadius: '12px',
                borderColor: '#CBD5E1',
                color: '#64748B',
                fontWeight: 600,
                textTransform: 'none',
              }}
            >
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Driver -> Passenger Feedback Rating Modal */}
      {selectedTripToRate && (
        <DriverFeedbackModal
          open={ratingModalOpen}
          onClose={() => setRatingModalOpen(false)}
          booking={{
            booking_id: selectedTripToRate.id,
            id: selectedTripToRate.id,
            passenger_name: selectedTripToRate.passengerName,
            passengerName: selectedTripToRate.passengerName,
          }}
          onSubmitted={() => {
            loadGivenRatings();
          }}
        />
      )}
    </Box>
  );
};

export default DriverTripHistory;

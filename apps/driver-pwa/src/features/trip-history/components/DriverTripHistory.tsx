import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Divider,
  Button,
  CircularProgress,
} from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
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
  tripMode: 'Solo Trip' | 'Shared Ride';
  status: string;
  date: string;
  time: string;
}

export const DriverTripHistory: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
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
          tripMode: b.tripMode === 'Shared Ride' ? 'Shared Ride' : 'Solo Trip',
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

  // Chronological Section Grouping
  const groupTripsChronologically = (tripsList: TripRecord[]) => {
    const now = new Date();
    const todayStr = now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const groups: {
      today: TripRecord[];
      yesterday: TripRecord[];
      thisWeek: TripRecord[];
      previous: TripRecord[];
    } = {
      today: [],
      yesterday: [],
      thisWeek: [],
      previous: [],
    };

    tripsList.forEach((trip) => {
      let tripDate = trip.date ? new Date(trip.date) : now;
      if (isNaN(tripDate.getTime())) tripDate = now;

      const tripDateStr = tripDate.toDateString();
      if (tripDateStr === todayStr || trip.date.toLowerCase() === 'today' || trip.date.toLowerCase() === 'ngayong araw') {
        groups.today.push(trip);
      } else if (tripDateStr === yesterdayStr || trip.date.toLowerCase() === 'yesterday' || trip.date.toLowerCase() === 'kahapon') {
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

  const renderSection = (title: string, items: TripRecord[]) => {
    if (!items || items.length === 0) return null;

    return (
      <Box key={title} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography
          sx={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#64748B',
            letterSpacing: '0.5px',
            fontFamily: 'Poppins, sans-serif',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Typography>

        {items.map((trip) => {
          const savedRating = givenRatings.find(
            (r: any) => r.bookingId === trip.id || r.bookingId === trip.bookingCode || r.id === trip.id
          );

          return (
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
                gap: 1.5,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                '&:hover': {
                  borderColor: '#CBD5E1',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                },
              }}
            >
              {/* Top Row: Passenger Name, Booking Code, Fare */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                    {trip.bookingCode}
                  </Typography>
                  <Typography sx={{ fontSize: '12px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
                    • {trip.passengerName}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: '16px', fontWeight: 900, color: '#FF6B00', fontFamily: 'Poppins, sans-serif' }}>
                  ₱{trip.fareAmount.toFixed(2)}
                </Typography>
              </Box>

              <Divider sx={{ my: 0.2, borderColor: '#F1F5F9' }} />

              {/* Middle Row: Route Timeline matching Passenger PWA structure */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                {/* Left Timeline & Locations */}
                <Box sx={{ display: 'flex', gap: 1.25, flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5, flexShrink: 0 }}>
                    <RadioButtonUncheckedIcon sx={{ color: '#FF6B00', fontSize: 15, stroke: '#FF6B00', strokeWidth: 1.5 }} />
                    <Box sx={{ width: '1.5px', height: '24px', backgroundColor: '#CBD5E1', my: '2px' }} />
                    <PlaceIcon sx={{ color: '#FF6B00', fontSize: 16 }} />
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <Box sx={{ mb: 1 }}>
                      <Typography sx={{ fontSize: '10.5px', color: '#64748B', fontWeight: 500, fontFamily: 'Poppins, sans-serif' }}>
                        {language === 'tl' ? 'Pickup' : 'Pickup'}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: '#0F172A',
                          fontFamily: 'Poppins, sans-serif',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {trip.pickupLocation}
                      </Typography>
                    </Box>

                    <Box>
                      <Typography sx={{ fontSize: '10.5px', color: '#64748B', fontWeight: 500, fontFamily: 'Poppins, sans-serif' }}>
                        {language === 'tl' ? 'Destinasyon' : 'Drop-off'}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: '#0F172A',
                          fontFamily: 'Poppins, sans-serif',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {trip.dropoffLocation}
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Right Trip Mode Chip & Time/Distance */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                  <Chip
                    label={trip.tripMode}
                    size="small"
                    sx={{
                      fontSize: '10.5px',
                      fontWeight: 700,
                      backgroundColor: trip.tripMode === 'Shared Ride' ? '#E6F4EA' : '#FFF8F0',
                      color: trip.tripMode === 'Shared Ride' ? '#1E8E3E' : '#FF6B00',
                      height: '22px',
                      fontFamily: 'Poppins, sans-serif',
                    }}
                  />
                  <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 500, fontFamily: 'Poppins, sans-serif' }}>
                    {trip.time} {trip.distanceKm > 0 ? `• ${trip.distanceKm.toFixed(1)} km` : ''}
                  </Typography>
                </Box>
              </Box>

              {/* Action Row: Rating */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', pt: 0.5 }}>
                {savedRating ? (
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
                ) : (
                  <Button
                    size="small"
                    startIcon={<StarIcon sx={{ fontSize: 14 }} />}
                    onClick={(e) => handleOpenRateModal(trip, e)}
                    sx={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#FF6B00',
                      textTransform: 'none',
                      py: 0.5,
                      px: 1.2,
                      borderRadius: '8px',
                      backgroundColor: '#FFF8F0',
                      fontFamily: 'Poppins, sans-serif',
                      '&:hover': { backgroundColor: '#FFE4D6' },
                    }}
                  >
                    {language === 'tl' ? 'I-rate ang Pasahero' : 'Rate Passenger'}
                  </Button>
                )}
              </Box>
            </Paper>
          );
        })}
      </Box>
    );
  };

  const hasTrips = trips.length > 0;

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* Page Header */}
      <PageHeader
        title={language === 'tl' ? 'Kasaysayan ng Biyahe' : 'Trip History'}
        onBack={() => navigate('/driver/home')}
      />

      {/* Main Content */}
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, pb: 4 }}>
        {loading ? (
          <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <CircularProgress size={32} sx={{ color: '#FF6B00' }} />
          </Box>
        ) : !hasTrips ? (
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
            <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', mb: 0.5, fontFamily: 'Poppins, sans-serif' }}>
              {language === 'tl' ? 'Walang nahanap na biyahe' : 'No trips found yet'}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
              {language === 'tl'
                ? 'Lilitaw dito ang kumpletong rekord ng iyong mga natapos na biyahe.'
                : 'Your completed trip records will appear here once you finish a ride.'}
            </Typography>
          </Paper>
        ) : (
          <>
            {renderSection(language === 'tl' ? 'NGAYONG ARAW' : 'TODAY', grouped.today)}
            {renderSection(language === 'tl' ? 'KAHAPON' : 'YESTERDAY', grouped.yesterday)}
            {renderSection(language === 'tl' ? 'MAS MAAGA SA LINGGONG ITO' : 'EARLIER THIS WEEK', grouped.thisWeek)}
            {renderSection(language === 'tl' ? 'NAKARAANG MGA BIYAHE' : 'PREVIOUS TRIPS', grouped.previous)}
          </>
        )}
      </Box>

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

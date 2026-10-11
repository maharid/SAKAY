import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Button,
  CircularProgress,
} from '@mui/material';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import StarIcon from '@mui/icons-material/Star';

import PageHeader from '../../../common/components/PageHeader';
import { fetchDriverTrips } from '../../../services/driverApiService';
import { useLanguage } from '../../../utils/LanguageContext';
import { formatShortBookingId, activateWithKeyboard, formatPeso } from '@sakay/shared';
import { supabase } from '../../../services/supabaseClient';
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
  // Ratings the database already holds for these trips (this phone's own list is lost with its storage; the database is not)
  const [dbRatedStars, setDbRatedStars] = useState<Record<string, number>>({});

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
        const ids = mapped.map((t) => t.id).filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        if (ids.length === 0) return;
        Promise.resolve(supabase.from('rating').select('booking_id, stars').eq('rater_role', 'Driver').in('booking_id', ids))
          .then(({ data: rated }) => {
            const map: Record<string, number> = {};
            (rated || []).forEach((r: { booking_id: string; stars: number | null }) => {
              map[r.booking_id] = Number(r.stars) || 0;
            });
            setDbRatedStars(map);
          })
          .catch(() => {});
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
            fontSize: '12px',
            fontWeight: 700,
            color: '#64748B',
            fontFamily: 'Poppins, sans-serif',
          }}
        >
          {title}
        </Typography>

        {items.map((trip) => {
          const savedRating = givenRatings.find(
            (r: any) => r.bookingId === trip.id || r.bookingId === trip.bookingCode || r.id === trip.id
          );
          // Rated once, for good: this phone's own record or the database's. The action disappears; only the result stays.
          const ratedStars: number | null = savedRating ? Number(savedRating.stars) || 5 : trip.id in dbRatedStars ? dbRatedStars[trip.id] : null;

          return (
            <Paper
              key={trip.id}
              elevation={0}
              role="button"
              tabIndex={0}
              onKeyDown={activateWithKeyboard}
              onClick={() => navigate(`/driver/trip-detail/${trip.id}`, { state: { trip } })}
              sx={{
                p: 2,
                borderRadius: '20px',
                border: '1px solid #F1F5F9',
                backgroundColor: '#FFFFFF',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                '&:hover': { borderColor: '#CBD5E1' },
              }}
            >
              {/* 1. Header Row: Mode Chip & Time on Left, Fare on Right */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                  <Chip
                    label={trip.tripMode === 'Shared Ride' ? 'Shared Trip' : 'Solo Trip'}
                    size="small"
                    sx={{
                      fontSize: '12px',
                      fontWeight: 700,
                      backgroundColor: trip.tripMode === 'Shared Ride' ? '#E6F4EA' : '#FFF5EB',
                      color: trip.tripMode === 'Shared Ride' ? '#1E8E3E' : '#C2410C',
                      height: '24px',
                      fontFamily: 'Poppins, sans-serif',
                    }}
                  />
                  <Typography sx={{ fontSize: '12px', color: '#64748B', fontWeight: 500, fontFamily: 'Poppins, sans-serif' }}>
                    {trip.time} {trip.distanceKm > 0 ? `• ${trip.distanceKm.toFixed(1)} km` : ''}
                  </Typography>
                </Box>

                <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#C2410C', fontFamily: 'Poppins, sans-serif', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {formatPeso(trip.fareAmount)}
                </Typography>
              </Box>

              {/* 2. Route Section: Vertical timeline with natural wrapping without truncation */}
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: '6px', flexShrink: 0 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #64748B', backgroundColor: '#FFFFFF' }} />
                  <Box sx={{ width: '1.5px', minHeight: '28px', flexGrow: 1, backgroundColor: '#CBD5E1', my: 0.5 }} />
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#FF6600' }} />
                </Box>

                <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  <Box>
                    <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 500, fontFamily: 'Poppins, sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Pickup
                    </Typography>
                    <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', fontFamily: 'Poppins, sans-serif', lineHeight: 1.35, wordBreak: 'break-word' }}>
                      {trip.pickupLocation}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 500, fontFamily: 'Poppins, sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {language === 'tl' ? 'Destinasyon' : 'Drop-off'}
                    </Typography>
                    <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', fontFamily: 'Poppins, sans-serif', lineHeight: 1.35, wordBreak: 'break-word' }}>
                      {trip.dropoffLocation}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Who it was, and the one action left on a trip: rating the passenger (gone once it is done) */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pt: 1.25, borderTop: '1px solid #F1F5F9' }}>
                <Typography noWrap sx={{ fontSize: '12px', color: '#475569', fontFamily: 'Poppins, sans-serif', minWidth: 0 }}>
                  {trip.bookingCode} • {trip.passengerName}
                </Typography>
                {ratedStars !== null ? (
                  <Chip
                    icon={<StarIcon sx={{ fontSize: '14px !important', color: '#C2410C !important' }} />}
                    label={`${language === 'tl' ? 'Na-rate' : 'Rated'} ${ratedStars.toFixed(1)}`}
                    size="small"
                    sx={{ flexShrink: 0, fontSize: '12px', fontWeight: 700, backgroundColor: '#FFF8F0', color: '#C2410C', height: '28px', fontFamily: 'Poppins, sans-serif' }}
                  />
                ) : (
                  <Button
                    size="small"
                    startIcon={<StarIcon sx={{ fontSize: 14 }} />}
                    onClick={(e) => handleOpenRateModal(trip, e)}
                    sx={{
                      flexShrink: 0,
                      minHeight: 40,
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#C2410C',
                      textTransform: 'none',
                      px: 1.5,
                      borderRadius: '10px',
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
            <CircularProgress size={32} sx={{ color: '#FF6600' }} />
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
            {renderSection(language === 'tl' ? 'Ngayong araw' : 'Today', grouped.today)}
            {renderSection(language === 'tl' ? 'Kahapon' : 'Yesterday', grouped.yesterday)}
            {renderSection(language === 'tl' ? 'Mas maaga sa linggong ito' : 'Earlier this week', grouped.thisWeek)}
            {renderSection(language === 'tl' ? 'Nakaraang mga biyahe' : 'Previous trips', grouped.previous)}
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

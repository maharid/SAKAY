import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Divider,
  Chip,
  Avatar,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import GroupsIcon from '@mui/icons-material/Groups';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import PageHeader from '../../../common/components/PageHeader';
import { fetchDriverTrips } from '../../../services/driverApiService';
import { useLanguage } from '../../../utils/LanguageContext';
import { activateWithKeyboard, RouteTimeline } from '@sakay/shared';

interface TripItem {
  id: string;
  bookingCode: string;
  passengerName: string;
  pickupLocation: string;
  dropoffLocation: string;
  fareAmount: number;
  tripMode: 'Shared Ride' | 'Solo Trip';
  status: 'Completed' | 'Cancelled' | 'In Progress';
  date: string;
  time: string;
  pairedPassenger?: string | null;
  createdAt?: string;
}

export const DriverEarnings: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    completedTrip?: {
      bookingCode: string;
      passengerName: string;
      pickup: string;
      dropoff: string;
      fareAmount: number;
      pairedPassenger?: string | null;
    };
  } | undefined;

  const justCompleted = state?.completedTrip;
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const driverId = localStorage.getItem('sakay_driver_id') || undefined;
    fetchDriverTrips(driverId)
      .then((data) => {
        let list: TripItem[] = (data || []).map((t: any) => ({
          id: t.id,
          bookingCode: t.bookingCode || `BKG-${t.id.slice(0, 6)}`,
          passengerName: t.passengerName || t.passenger_name || 'Juan Dela Cruz',
          pickupLocation: t.pickupLocation || 'JP Rizal Central Terminal',
          dropoffLocation: t.dropoffLocation || 'Calapan Public Market',
          fareAmount: Number(t.fareAmount) || 0,
          tripMode: t.tripMode || 'Solo Trip',
          status: t.status || 'Completed',
          date: t.date || 'Today',
          time: t.time || 'Just now',
          pairedPassenger: t.pairedPassenger || null,
          createdAt: t.createdAt,
        }));

        if (justCompleted) {
          const freshItem: TripItem = {
            id: justCompleted.bookingCode,
            bookingCode: justCompleted.bookingCode,
            passengerName: justCompleted.passengerName,
            pickupLocation: justCompleted.pickup,
            dropoffLocation: justCompleted.dropoff,
            fareAmount: justCompleted.fareAmount,
            tripMode: justCompleted.pairedPassenger ? 'Shared Ride' : 'Solo Trip',
            status: 'Completed',
            date: 'Today',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            pairedPassenger: justCompleted.pairedPassenger,
            createdAt: new Date().toISOString(),
          };
          list = [freshItem, ...list.filter((x) => x.bookingCode !== justCompleted.bookingCode)];
        }

        setTrips(list);
      })
      .catch((err) => console.warn('[DriverEarnings] Trips fetch note:', err))
      .finally(() => setIsLoading(false));
  }, [justCompleted]);

  // Compute live aggregates from database records
  const completedList = trips.filter((t) => t.status === 'Completed');
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;

  const todayList = completedList.filter((t: any) => {
    const time = t.createdAt ? new Date(t.createdAt).getTime() : startOfToday;
    return time >= startOfToday;
  });
  const todayTotal = todayList.reduce((acc, t) => acc + (t.fareAmount || 0), 0);

  const weekList = completedList.filter((t: any) => {
    const time = t.createdAt ? new Date(t.createdAt).getTime() : startOfToday;
    return time >= sevenDaysAgo;
  });
  const weekTotal = weekList.reduce((acc, t) => acc + (t.fareAmount || 0), 0);

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* Top Header matching Alerts header style */}
      <PageHeader
        title={language === 'tl' ? 'Kita at Kasaysayan' : 'Earnings & Trip History'}
        onBack={() => navigate('/driver/home')}
      />

      <Box sx={{ p: '20px', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* If just completed a trip, show the completed trip fare banner */}
        {justCompleted && (
          <Paper elevation={0} sx={{ p: 2.5, borderRadius: '20px', backgroundColor: '#E6F4EA', border: '1px solid #A7F3D0' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#1E8E3E', mb: 1 }}>
              <CheckCircleIcon />
              <Typography sx={{ fontWeight: 700, fontSize: '15px' }}>
                {language === 'tl' ? 'Matagumpay na Nakumpleto ang Biyahe!' : 'Trip Successfully Completed!'}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '13px', color: '#334155' }}>
              Booking: <strong>{justCompleted.bookingCode}</strong> • {justCompleted.passengerName}
            </Typography>
            {justCompleted.pairedPassenger && (
              <Typography sx={{ fontSize: '12px', color: '#1E8E3E', mt: 0.5, fontWeight: 700 }}>
                ✓ Shared Carpool Paired: {justCompleted.pairedPassenger} (+₱15.00)
              </Typography>
            )}
            <Divider sx={{ my: 1.5, borderColor: '#A7F3D0' }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
                {language === 'tl' ? 'Kabuuang Nakolekta (Gross):' : 'Total Collected (Gross):'}
              </Typography>
              <Typography sx={{ fontSize: '24px', fontWeight: 700, color: '#1E8E3E' }}>₱{justCompleted.fareAmount.toFixed(2)}</Typography>
            </Box>
          </Paper>
        )}

        {/* Daily & Weekly Gross Totals Card */}
        <Paper elevation={0} sx={{ p: 2.5, borderRadius: '24px', background: 'linear-gradient(135deg, #1F1F1F 0%, #0A0A0A 100%)', color: '#FFFFFF', boxShadow: '0 12px 24px rgba(0,0,0,0.15)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AccountBalanceWalletIcon sx={{ color: '#FF6600' }} />
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B' }}>
                {language === 'tl' ? 'Kabuuang kita ngayong araw' : "Today's total earnings"}
              </Typography>
            </Box>
            <Chip label="Live Total" size="small" sx={{ backgroundColor: 'rgba(255, 102, 0, 0.2)', color: '#FF8533', fontWeight: 700, fontSize: '12px' }} />
          </Box>

          <Typography sx={{ fontSize: '28px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            ₱{todayTotal.toFixed(2)}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#64748B', mt: 0.5 }}>
            {todayList.length} {language === 'tl' ? 'nakumpletong biyahe ngayong araw' : 'completed trips today'}
          </Typography>

          <Divider sx={{ my: 2, borderColor: 'rgba(255, 255, 255, 0.1)' }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                {language === 'tl' ? 'Kita sa Linggong Ito' : "This Week's Earnings"}
              </Typography>
              <Typography sx={{ fontSize: '16px', fontWeight: 700, color: '#FFFFFF' }}>₱{weekTotal.toFixed(2)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                {language === 'tl' ? 'Kabuuang Biyahe (Linggo)' : 'Total Trips (Week)'}
              </Typography>
              <Typography sx={{ fontSize: '16px', fontWeight: 700, color: '#34D399' }}>
                {weekList.length} {language === 'tl' ? 'biyahe' : 'trips'}
              </Typography>
            </Box>
          </Box>
        </Paper>

        {/* Recent Completed Trips Breakdown List */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
              {language === 'tl' ? 'Mga Nakaraang Biyahe' : 'Recent Completed Trips'}
            </Typography>
            <Button
              onClick={() => navigate('/driver/history')}
              endIcon={<ArrowForwardIcon sx={{ fontSize: '18px !important', ml: -0.25 }} />}
              sx={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#FF6600',
                textTransform: 'none',
                fontFamily: 'Poppins, sans-serif',
                px: 1,
                py: 0,
                mr: -1,
                minHeight: 44,
                minWidth: 'auto',
                textDecoration: 'none !important',
                display: 'inline-flex',
                alignItems: 'center',
                '&, &:hover, &:active, &:focus, &:visited, &.MuiButton-root': {
                  textDecoration: 'none !important',
                },
                '&:hover': {
                  backgroundColor: 'transparent',
                  textDecoration: 'none !important',
                  color: '#E65C00',
                },
                '&:active': {
                  textDecoration: 'none !important',
                  color: '#CC5200',
                },
                '&:focus-visible': {
                  outline: '2px solid #FF6600',
                  outlineOffset: '2px',
                  borderRadius: '8px',
                  textDecoration: 'none !important',
                },
              }}
            >
              {language === 'tl' ? 'Tingnan Lahat' : 'See All Trips'}
            </Button>
          </Box>

          {completedList.length === 0 ? (
            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: '16px',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', mb: 0.5 }}>
                {language === 'tl' ? 'Wala pang nakumpletong biyahe' : 'No completed trips yet'}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                {language === 'tl'
                  ? 'Lilitaw dito ang mga detalye ng iyong biyahe at kita kapag nakatapos ka na ng booking.'
                  : 'Your trip details and earnings will appear here once you complete a booking.'}
              </Typography>
            </Paper>
          ) : (
            completedList.slice(0, 10).map((trip, idx) => {
              const shared = trip.tripMode === 'Shared Ride';
              return (
                <Paper
                  key={trip.id || idx}
                  elevation={0}
                  role="button"
                  tabIndex={0}
                  onKeyDown={activateWithKeyboard}
                  onClick={() => navigate(`/driver/trip-detail/${trip.id}`, { state: { trip } })}
                  sx={{
                    p: '14px 16px',
                    borderRadius: '16px',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.5,
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                    '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.05)', borderColor: '#CBD5E1' },
                    '&:focus-visible': { outline: '2px solid #FF6600', outlineOffset: 2 },
                  }}
                >
                  {/* Who and how much */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar sx={{ width: 40, height: 40, flexShrink: 0, backgroundColor: shared ? '#ECFDF5' : '#FFF7ED', color: shared ? '#047857' : '#FF6600' }}>
                      {shared ? <GroupsIcon fontSize="small" /> : <TwoWheelerIcon fontSize="small" />}
                    </Avatar>
                    <Typography noWrap title={trip.passengerName} sx={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>
                      {trip.passengerName}
                    </Typography>
                    <Typography sx={{ flexShrink: 0, fontSize: '17px', fontWeight: 700, color: '#047857', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      +₱{trip.fareAmount.toFixed(2)}
                    </Typography>
                  </Box>

                  {/* The route */}
                  <Box sx={{ pt: 1.5, borderTop: '1px solid #F1F5F9' }}>
                    <RouteTimeline
                      compact
                      pickup={trip.pickupLocation}
                      destination={trip.dropoffLocation}
                      pickupLabel={language === 'tl' ? 'Pickup' : 'Pickup'}
                      destinationLabel={language === 'tl' ? 'Destinasyon' : 'Drop-off'}
                    />
                  </Box>

                  {/* When, and the kind of ride */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pt: 1.25, borderTop: '1px solid #F1F5F9' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                      <AccessTimeIcon aria-hidden sx={{ fontSize: 15, color: '#64748B', flexShrink: 0 }} />
                      <Typography noWrap sx={{ fontSize: '12.5px', color: '#475569', fontWeight: 500 }}>
                        {trip.date} • {trip.time}
                      </Typography>
                    </Box>
                    <Chip
                      label={shared ? 'Shared' : 'Solo'}
                      size="small"
                      sx={{
                        flexShrink: 0,
                        height: 24,
                        fontSize: '12px',
                        fontWeight: 700,
                        backgroundColor: shared ? '#D1FAE5' : '#FEF3C7',
                        color: shared ? '#047857' : '#92400E',
                      }}
                    />
                  </Box>
                </Paper>
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default DriverEarnings;

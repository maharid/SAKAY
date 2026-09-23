import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Chip,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocalTaxiIcon from '@mui/icons-material/LocalTaxi';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

import MapView from '../../../common/components/MapView';
import { supabase } from '../../../services/supabaseClient';

const SlideToCompleteDriver: React.FC<{
  enabled: boolean;
  onComplete: () => void;
  language?: string;
}> = ({ enabled, onComplete }) => {
  const [slidePos, setSlidePos] = useState(0);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleStart = () => {
    if (!enabled) return;
    isDragging.current = true;
  };

  const handleMove = (clientX: number) => {
    if (!enabled || !isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const maxOffset = rect.width - 52;
    const offset = Math.max(0, Math.min(clientX - rect.left - 24, maxOffset));
    setSlidePos(offset);

    if (offset >= maxOffset * 0.85) {
      isDragging.current = false;
      setSlidePos(maxOffset);
      onComplete();
    }
  };

  const handleEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setSlidePos(0);
  };

  return (
    <Box
      ref={containerRef}
      onMouseDown={handleStart}
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleStart}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={handleEnd}
      sx={{
        position: 'relative',
        width: '100%',
        height: '52px',
        backgroundColor: enabled ? '#FFF7ED' : '#F1F5F9',
        border: enabled ? '1.5px solid #FFD6B3' : '1.5px solid #CBD5E1',
        borderRadius: '999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: enabled ? 'grab' : 'not-allowed',
        userSelect: 'none',
        touchAction: 'none',
        opacity: enabled ? 1 : 0.7,
      }}
    >
      <Typography
        sx={{
          fontSize: '13px',
          fontWeight: 800,
          color: enabled ? '#FF6B00' : '#64748B',
          fontFamily: 'Poppins, sans-serif',
          pointerEvents: 'none',
          opacity: enabled ? Math.max(0.2, 1 - slidePos / 140) : 1,
        }}
      >
        {enabled
          ? 'Slide to Complete Trip >>>'
          : "Waiting for passenger to tap 'Finish Trip'..."}
      </Typography>

      <Box
        sx={{
          position: 'absolute',
          left: 4 + slidePos,
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundColor: enabled ? '#FF6B00' : '#94A3B8',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: enabled ? '0 4px 12px rgba(255, 107, 0, 0.4)' : 'none',
          transition: isDragging.current ? 'none' : 'left 0.25s ease',
        }}
      >
        <CheckCircleIcon sx={{ fontSize: 24 }} />
      </Box>
    </Box>
  );
};

export const DriverActiveTrip: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const bookingId = (location.state as { bookingId?: string })?.bookingId || 'BKG-9011';

  const [booking, setBooking] = useState<any>(null);
  const [tripStarted, setTripStarted] = useState(false);
  const [progress] = useState(45); // trip progress %
  const [exitGuardOpen, setExitGuardOpen] = useState(false);

  // Collapsible Card State
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

  // Passenger Finished state for complete trip button enablement
  const [passengerFinished, setPassengerFinished] = useState(false);

  // Additional Shared Passenger State
  const [pairedPassenger, setPairedPassenger] = useState<string | null>(null);
  const [sharedPromptOpen, setSharedPromptOpen] = useState(false);
  const [hasPromptedShared, setHasPromptedShared] = useState(false);

  // Fare calculations
  const [currentFare, setCurrentFare] = useState(booking?.estimated_fare || 35.0);
  const [proportionateFareP1, setProportionateFareP1] = useState(booking?.estimated_fare || 35.0);
  const [driverLocation, setDriverLocation] = useState({
    lat: booking?.pickup_latitude || 13.4117,
    lng: booking?.pickup_longitude || 121.1803,
  });

  // Check initial passenger finished state & listen for updates
  useEffect(() => {
    if (!bookingId) return;

    const checkFinishedStatus = () => {
      const isFinishedLocal = localStorage.getItem(`passenger_finished_${bookingId}`) === 'true';
      if (isFinishedLocal) {
        setPassengerFinished(true);
      }
    };

    checkFinishedStatus();
    const interval = setInterval(checkFinishedStatus, 2000);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === `passenger_finished_${bookingId}` && e.newValue === 'true') {
        setPassengerFinished(true);
      }
    };
    window.addEventListener('storage', handleStorage);

    // Supabase channel listener
    const syncChannel = supabase.channel(`booking_sync_${bookingId}`);
    syncChannel
      .on('broadcast', { event: 'passenger_finished' }, () => {
        setPassengerFinished(true);
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorage);
      supabase.removeChannel(syncChannel);
    };
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) return;
    Promise.resolve(
      supabase
        .from('booking')
        .select('*, passenger:passenger_id(*)')
        .eq('booking_id', bookingId)
        .maybeSingle()
    )
      .then(({ data }: any) => {
        if (data) {
          const p = Array.isArray(data.passenger) ? data.passenger[0] : data.passenger;
          const fare = Number(data.actual_fare || data.final_fare || data.estimated_fare) || 35;
          setBooking({
            booking_id: data.booking_id,
            passenger_id: data.passenger_id,
            passenger_name: p?.full_name || 'Calapan Commuter',
            passenger_phone: p?.contact_number || '+63 917 000 0000',
            booking_type: data.booking_type || 'Immediate',
            is_shared_trip: Boolean(data.is_shared_trip),
            passenger_count: data.passenger_count || 1,
            pickup_address: data.pickup_address || data.pickup_location_address || 'Calapan City',
            pickup_latitude: Number(data.pickup_latitude) || 13.4117,
            pickup_longitude: Number(data.pickup_longitude) || 121.1803,
            dropoff_address: data.dropoff_address || data.dropoff_location_address || 'Calapan City Public Market',
            dropoff_latitude: Number(data.dropoff_latitude) || 13.4180,
            dropoff_longitude: Number(data.dropoff_longitude) || 121.1850,
            estimated_distance_km: Number(data.route_distance_km || data.estimated_distance_km) || 1.5,
            estimated_fare: fare,
            booking_status: data.booking_status,
            created_at: data.created_at,
            updated_at: data.updated_at,
          } as any);
          setCurrentFare(fare);
          setProportionateFareP1(fare);

          if (data.passenger_finished || data.booking_status === 'Arrived at Destination') {
            setPassengerFinished(true);
          }
        }
      })
      .catch((e: any) => console.warn('[DriverActiveTrip] Supabase fetch error:', e));
  }, [bookingId]);

  // Real-time GPS broadcasting during active trip
  useEffect(() => {
    let watchId: number | null = null;
    let channel: any = null;

    if (bookingId) {
      channel = supabase.channel(`passenger_trip_${bookingId}`);
    }

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setDriverLocation({ lat, lng });

          if (channel) {
            channel.send({
              type: 'broadcast',
              event: 'driver_location',
              payload: { lat, lng },
            });
          }
        },
        (err) => console.warn('[DriverActiveTrip] Geolocation watch error:', err.message),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
      );
    }

    return () => {
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [bookingId]);

  useEffect(() => {
    if (tripStarted && booking?.is_shared_trip && !hasPromptedShared) {
      const t = setTimeout(() => {
        setHasPromptedShared(true);
        setSharedPromptOpen(true);
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [tripStarted, hasPromptedShared, booking?.is_shared_trip]);

  const handleEnRoute = async () => {
    try {
      await supabase
        .from('booking')
        .update({ booking_status: 'In Transit' })
        .eq('booking_id', bookingId);
      setBooking((prev: any) => ({ ...prev, booking_status: 'In Transit' }));
    } catch (err) {
      console.warn('[DriverActiveTrip] enRoute error:', err);
    }
  };

  const handleArrived = async () => {
    try {
      await supabase
        .from('booking')
        .update({ booking_status: 'Arrived at Pickup' })
        .eq('booking_id', bookingId);
      setBooking((prev: any) => ({ ...prev, booking_status: 'Arrived at Pickup' }));
    } catch (err) {
      console.warn('[DriverActiveTrip] arrived error:', err);
    }
  };

  const handleStartTrip = async () => {
    setTripStarted(true);
    try {
      await supabase
        .from('booking')
        .update({
          booking_status: 'Trip Ongoing',
          trip_started_at: new Date().toISOString(),
        })
        .eq('booking_id', bookingId);
      setBooking((prev: any) => ({ ...prev, booking_status: 'Trip Ongoing' }));
    } catch (err) {
      console.warn('[DriverActiveTrip] startTrip Supabase update note:', err);
    }
  };

  const handleAcceptSharedPassenger = async () => {
    setPairedPassenger('Joshua Dizon (San Vicente High)');
    const newP1 = Math.round(currentFare * 0.75 * 100) / 100;
    const p2Fare = 15.0;
    setProportionateFareP1(newP1);
    setCurrentFare(newP1 + p2Fare);
    setSharedPromptOpen(false);

    try {
      await supabase
        .from('booking')
        .update({ is_shared_trip: true })
        .eq('booking_id', bookingId);
    } catch (err) {
      console.warn('[DriverActiveTrip] acceptShared Supabase update note:', err);
    }
  };

  const handleDeclineSharedPassenger = () => {
    setSharedPromptOpen(false);
  };

  const handleCompleteTrip = async () => {
    const p1PayableFare = pairedPassenger ? proportionateFareP1 : currentFare;
    try {
      await supabase
        .from('booking')
        .update({
          booking_status: 'Completed',
          actual_fare: p1PayableFare,
          trip_completed_at: new Date().toISOString(),
        })
        .eq('booking_id', bookingId);
    } catch (err) {
      console.warn('[DriverActiveTrip] completeTrip Supabase update note:', err);
    }

    navigate('/driver/earnings', {
      replace: true,
      state: {
        completedTrip: {
          bookingCode: booking?.booking_id || bookingId,
          passengerName: booking?.passenger_name || 'Maria Clara Santos',
          pickup: booking?.pickup_address || 'JP Rizal Central Terminal',
          dropoff: booking?.dropoff_address || 'Calapan City Public Market',
          fareAmount: currentFare,
          pairedPassenger,
          proportionateFareP1: pairedPassenger ? proportionateFareP1 : undefined,
        },
      },
    });
  };

  const handleExitToHome = () => {
    setExitGuardOpen(false);
    navigate('/driver/home');
  };

  const passengerName = booking?.passenger_name || 'Maria Clara Santos';
  const dropoffAddress = booking?.dropoff_address || 'Calapan City Public Market';

  const isCompleteButtonEnabled =
    passengerFinished ||
    progress >= 90 ||
    booking?.booking_status === 'Arrived at Destination';

  return (
    <Box
      onClick={() => setIsDetailsExpanded(false)}
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#E3ECEF',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* 1. Leaflet OpenStreetMap Surface with Pickup and Dropoff markers */}
      <MapView
        pickupLocation={{
          lat: booking?.pickup_latitude || 13.4117,
          lng: booking?.pickup_longitude || 121.1803,
        }}
        dropoffLocation={{
          lat: booking?.dropoff_latitude || 13.4180,
          lng: booking?.dropoff_longitude || 121.1850,
        }}
        userLocation={driverLocation}
      />

      {/* 2. Top Floating Navigation Header */}
      <Paper
        elevation={6}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 12px)',
          left: 16,
          right: 16,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderRadius: '20px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 30,
          border: '1px solid #E2E8F0',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconButton
            onClick={() => setExitGuardOpen(true)}
            sx={{
              backgroundColor: '#F1F5F9',
              color: '#0F172A',
              width: 36,
              height: 36,
              borderRadius: '10px',
              '&:hover': { backgroundColor: '#E2E8F0' },
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Box>
            <Typography
              sx={{
                fontSize: '14px',
                color: '#0F172A',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontFamily: 'Poppins, sans-serif',
              }}
            >
              {tripStarted ? 'ONGOING TRIP' : 'PASSENGER BOARDING'}
            </Typography>
          </Box>
        </Box>
        <Chip
          label={booking?.is_shared_trip ? 'Shared Ride' : 'Solo Trip'}
          size="small"
          sx={{
            backgroundColor: '#FFF8F0',
            color: '#FF6B00',
            fontWeight: 800,
            border: '1px solid #FFD6B3',
            fontFamily: 'Poppins, sans-serif',
          }}
        />
      </Paper>

      {/* 3. Floating Collapsible Trip Card */}
      <Paper
        elevation={6}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 76px)',
          left: 16,
          right: 16,
          p: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderRadius: '18px',
          border: '1px solid #E2E8F0',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
          zIndex: 25,
          transition: 'all 0.25s ease',
        }}
      >
        {/* Main Row: Passenger Name & Destination + Uncollapse Toggle Arrow */}
        <Box
          onClick={() => setIsDetailsExpanded((prev) => !prev)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
            <Avatar sx={{ width: 40, height: 40, backgroundColor: '#FF6B00', fontWeight: 800, fontSize: '15px' }}>
              {passengerName.charAt(0)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: '16px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {passengerName}
              </Typography>
              <Typography sx={{ fontSize: '12.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {dropoffAddress}
              </Typography>
            </Box>
          </Box>

          <IconButton
            size="small"
            sx={{
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              ml: 1,
              color: '#0F172A',
            }}
          >
            {isDetailsExpanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
          </IconButton>
        </Box>

        {/* Collapsible Details Section */}
        {isDetailsExpanded && (
          <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: '12px', color: '#64748B', fontWeight: 700, fontFamily: 'Poppins, sans-serif' }}>
                Progress towards Destination
              </Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 900, color: '#FF6B00', fontFamily: 'Poppins, sans-serif' }}>
                {progress}%
              </Typography>
            </Box>

            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                height: 8,
                borderRadius: 4,
                backgroundColor: '#E2E8F0',
                '& .MuiLinearProgress-bar': { backgroundColor: '#FF6B00', borderRadius: 4 },
              }}
            />

            <Box sx={{ p: 1.5, borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700, fontFamily: 'Poppins, sans-serif', textTransform: 'uppercase' }}>
                PICKUP ADDRESS
              </Typography>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                {booking?.pickup_address || 'JP Rizal St. Central Terminal'}
              </Typography>
            </Box>

            {/* Paired Second Passenger (if accepted) */}
            {pairedPassenger && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, backgroundColor: '#ECFDF5', borderRadius: '12px', border: '1px solid #A7F3D0' }}>
                <Avatar sx={{ width: 30, height: 30, backgroundColor: '#10B981', color: '#FFFFFF', fontWeight: 800, fontSize: '12px' }}>
                  J
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#065F46', fontFamily: 'Poppins, sans-serif' }}>
                    {pairedPassenger}
                  </Typography>
                  <Typography sx={{ fontSize: '11.5px', color: '#047857', fontFamily: 'Poppins, sans-serif' }}>
                    Passenger #2 (Shared Carpool)
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* 4. Bottom Action Footer */}
      <Paper
        elevation={8}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          padding: '18px 20px calc(var(--safe-area-bottom) + 20px) 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          zIndex: 30,
          borderTop: '1px solid #E2E8F0',
          boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.08)',
        }}
      >
        {/* Estimated Arrival Time above total fare */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
          <Typography sx={{ fontSize: '11.5px', fontWeight: 800, color: '#64748B', fontFamily: 'Poppins, sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            ESTIMATED ARRIVAL TIME:
          </Typography>
          <Chip
            label="~8 MINS (1.5 KM)"
            size="small"
            sx={{
              backgroundColor: '#FFF7ED',
              color: '#FF6B00',
              fontWeight: 800,
              fontSize: '11.5px',
              height: '24px',
              border: '1px solid #FFD6B3',
              fontFamily: 'Poppins, sans-serif',
            }}
          />
        </Box>

        {/* Total Fare Display */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
          <Typography sx={{ fontSize: '13.5px', fontWeight: 700, color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
            Total Trip Fare:
          </Typography>
          <Typography sx={{ fontSize: '24px', fontWeight: 900, color: '#FF6B00', fontFamily: 'Poppins, sans-serif' }}>
            ₱{currentFare.toFixed(2)}
          </Typography>
        </Box>

        {/* Action Button Controls */}
        {booking?.booking_status === 'Accepted' || booking?.booking_status === 'Driver Assigned' ? (
          <Button
            variant="contained"
            fullWidth
            onClick={handleEnRoute}
            sx={{
              height: 50,
              borderRadius: '14px',
              backgroundColor: '#3B82F6',
              fontWeight: 800,
              fontSize: '15px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#2563EB' },
            }}
          >
            I'm On My Way
          </Button>
        ) : booking?.booking_status === 'In Transit' ? (
          <Button
            variant="contained"
            fullWidth
            onClick={handleArrived}
            sx={{
              height: 50,
              borderRadius: '14px',
              backgroundColor: '#F59E0B',
              fontWeight: 800,
              fontSize: '15px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#D97706' },
            }}
          >
            Arrived at Pickup
          </Button>
        ) : booking?.booking_status === 'Arrived at Pickup' || booking?.booking_status === 'Driver Arrived' ? (
          <Button
            variant="contained"
            fullWidth
            onClick={handleStartTrip}
            startIcon={<LocalTaxiIcon />}
            sx={{
              height: 50,
              borderRadius: '14px',
              backgroundColor: '#10B981',
              fontWeight: 800,
              fontSize: '15px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#059669' },
            }}
          >
            Start Trip
          </Button>
        ) : (
          /* Slide to Complete Trip Button for Driver */
          <SlideToCompleteDriver
            enabled={isCompleteButtonEnabled}
            onComplete={handleCompleteTrip}
          />
        )}
      </Paper>

      {/* Mid-Trip Additional Shared Passenger Prompt (<50% Rule) */}
      <Dialog
        open={sharedPromptOpen}
        fullWidth
        maxWidth="xs"
        slotProps={{
          paper: {
            sx: {
              borderRadius: '24px',
              p: 1,
              backgroundColor: '#FFFFFF',
              boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
            },
          },
        }}
      >
        <DialogTitle sx={{ textAlign: 'center', pb: 1 }}>
          <Chip label="Mid-Trip Carpool Match (<50% Route)" color="warning" sx={{ fontWeight: 800 }} />
          <Typography sx={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', mt: 1 }}>
            Additional Passenger along Route?
          </Typography>
          <Typography sx={{ fontSize: '12.5px', color: '#64748B' }}>
            A commuter near San Vicente High is also heading towards City Hall.
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ py: 1 }}>
          <Box sx={{ p: 2, backgroundColor: '#F8FAFC', borderRadius: '16px', border: '1px solid #E2E8F0' }}>
            <Typography sx={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>
              Passenger: Joshua Dizon (1 seat)
            </Typography>
            <Typography sx={{ fontSize: '12px', color: '#64748B', mt: 0.5 }}>
              Pickup: San Vicente NHS Gate (+200m detour)
            </Typography>
            <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#10B981', mt: 1 }}>
              Extra Trip Earnings: +₱15.00
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: '12px 18px 18px', gap: 1.5 }}>
          <Button
            variant="outlined"
            fullWidth
            color="inherit"
            onClick={handleDeclineSharedPassenger}
            sx={{ height: 44, borderRadius: '12px', fontWeight: 700, textTransform: 'none' }}
          >
            Decline
          </Button>

          <Button
            variant="contained"
            fullWidth
            onClick={handleAcceptSharedPassenger}
            sx={{
              height: 44,
              borderRadius: '12px',
              backgroundColor: '#10B981',
              fontWeight: 800,
              textTransform: 'none',
              '&:hover': { backgroundColor: '#059669' },
            }}
          >
            Accept (+₱15)
          </Button>
        </DialogActions>
      </Dialog>

      {/* Exit Guard Confirmation Dialog */}
      <Dialog
        open={exitGuardOpen}
        onClose={() => setExitGuardOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '20px',
              padding: '8px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '17px', color: '#0F172A', textAlign: 'center' }}>
          Active Ongoing Trip
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', py: 1 }}>
          <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.5 }}>
            You currently have passenger(s) on board (<strong>{passengerName}</strong>). Do you want to return to Home? Your trip progress will remain active.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => setExitGuardOpen(false)}
            sx={{
              height: 46,
              borderRadius: '12px',
              backgroundColor: '#FF6B00',
              fontWeight: 700,
              textTransform: 'none',
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            Stay in Trip
          </Button>
          <Button
            fullWidth
            variant="outlined"
            color="error"
            onClick={handleExitToHome}
            sx={{
              height: 44,
              borderRadius: '12px',
              fontWeight: 700,
              textTransform: 'none',
            }}
          >
            Return to Home
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DriverActiveTrip;

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Alert from "@mui/material/Alert";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import totoHeadImg from "@sakay/shared/src/assets/icons/toto-head.webp";
import {
  TYPOGRAPHY_TOKENS,
  fetchFareQuote,
  estimatedFareFor,
  componentsFor,
  parseFareError,
  describeFareError,
  buildTripDetails,
  activateWithKeyboard,
  extendTapArea,
  useInFlight,
  type FareQuote,
  FareLine,
  formatPeso,
  searchRadiusFromStatus,
  useSafeAreaInsets,
  SHARED_BOOKING_MAX_PASSENGERS,
  FARE_SEAT_CAPACITY,
  SharedMatchPanel,
  useSharedMatch,
  messageForLanguage,
} from "@sakay/shared";

import MapView from "../../../../common/components/MapView";
import SharedFareNotice, { SharedAcknowledgement } from "../../../../common/components/SharedFareNotice";
import BookingOptions from "./BookingOptions";
import PassengerCancelModal from "../../../../common/components/PassengerCancelModal";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import HomeHeader from "../Dashboard/HomeHeader";
import PassengerNavigationDrawer from "../Dashboard/PassengerNavigationDrawer";
import TulongDialog from "../Dashboard/TulongDialog";
import NotificationsDialog from "../Dashboard/NotificationsDialog";
import DriverSearchPanel, { type DriverSearchOutcome } from "../DriverSearch/DriverSearchPanel";
import ChangePickupDialog from "../DriverSearch/ChangePickupDialog";
import { useDispatchStatus } from "../../hooks/useDispatchStatus";
import { useServiceArea } from "../../hooks/useServiceArea";
import { isOutsideServiceArea, outsideServiceAreaMessage } from "../../../../services/serviceAreaService";
import { supabase } from "../../../../services/supabaseClient";
import { describeRetryRefusal, retryDriverSearch } from "../../../../services/dispatchService";
import { useLanguage } from "../../../../utils/LanguageContext";
import {
  DEFAULT_CALAPAN_CENTER,
  getCurrentDevicePosition,
  reverseGeocodeCoordinates,
  getOSRMRoute,
} from "../../../../services/locationService";
import {
  createBooking,
  cancelBooking,
  fetchOpenBooking,
  type BookingRecord,
} from "../../../../services/bookingService";

const NewTrip: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useLanguage();

  const navState = location.state as {
    hasGps?: boolean;
    coords?: { lat: number; lng: number };
  } | null;

  // Passenger Identity State from Supabase DB
  const [profileName, setProfileName] = useState<string>("");
  const [passengerPhone, setPassengerPhone] = useState<string>("");
  const [passengerId, setPassengerId] = useState<string>("");

  // UI Modals & Drawers
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [tulongOpen, setTulongOpen] = useState<boolean>(false);
  const [notificationsOpen, setNotificationsOpen] = useState<boolean>(false);
  const [recenterTrigger, setRecenterTrigger] = useState<number>(0);
  const [validationError, setValidationError] = useState<string>("");
  const [cancelModalOpen, setCancelModalOpen] = useState<boolean>(false);
  const [cancelling, setCancelling] = useState<boolean>(false);
  // Rule 29.9: the pickup can be changed while the search is running
  const [changePickupOpen, setChangePickupOpen] = useState<boolean>(false);

  // Dialog States for Controls
  const [notesDialogOpen, setNotesDialogOpen] = useState<boolean>(false);

  // Dynamic Bottom Sheet Height tracking for floating Back & Location buttons
  const bottomSheetRef = useRef<HTMLDivElement | null>(null);
  const [bottomSheetHeight, setBottomSheetHeight] = useState<number>(380);

  useEffect(() => {
    const el = bottomSheetRef.current;
    if (!el) return;
    const updateHeight = () => {
      setBottomSheetHeight(el.offsetHeight);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [noteText, setNoteText] = useState<string>(() => sessionStorage.getItem("trip_notes") || "");
  const [tempNoteText, setTempNoteText] = useState<string>("");
  const [tariffInfoOpen, setTariffInfoOpen] = useState<boolean>(false);
  const [tripTypeInfoOpen, setTripTypeInfoOpen] = useState<boolean>(false);

  // Trip Configuration State
  const [tripType, setTripType] = useState<"Solo" | "Shared">(() => {
    return (sessionStorage.getItem("trip_type") as "Solo" | "Shared") || "Solo";
  });
  const [passengers, setPassengers] = useState<number>(() => {
    const raw = sessionStorage.getItem("trip_passengers");
    return raw ? parseInt(raw, 10) : 1;
  });

  // Pickup Location State
  const [pickup, setPickup] = useState<{ address: string; lat: number; lng: number; isCustom?: boolean }>(() => {
    const saved = sessionStorage.getItem("trip_pickup");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.lat && parsed.address && parsed.isCustom) {
          return parsed;
        }
      } catch {}
    }

    const gpsLat = navState?.coords?.lat || parseFloat(localStorage.getItem("user_lat") || "");
    const gpsLng = navState?.coords?.lng || parseFloat(localStorage.getItem("user_lng") || "");

    if (gpsLat && gpsLng && !isNaN(gpsLat) && !isNaN(gpsLng) && gpsLat !== 0) {
      return {
        address: language === "tl" ? "Kasalukuyang Lokasyon" : "Current Location",
        lat: gpsLat,
        lng: gpsLng,
      };
    }

    return {
      address: language === "tl" ? "Kasalukuyang Lokasyon" : "Current Location",
      lat: DEFAULT_CALAPAN_CENTER.latitude,
      lng: DEFAULT_CALAPAN_CENTER.longitude,
    };
  });

  // Dropoff Location State
  const [dropoff, setDropoff] = useState<{ address: string; lat: number; lng: number }>(() => {
    const saved = sessionStorage.getItem("trip_dropoff");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return {
      address: "",
      lat: 0,
      lng: 0,
    };
  });

  // SAKAY serves Calapan City only: a trip has to start AND end inside the service area. An end outside it gets no route and no fare, and
  // Book Ride stays off (the database refuses such a booking as well; this tells the passenger first). Every way of choosing a place
  // (search, map pin, current location, saved places, a previous trip) ends up here, so this is the check that cannot be bypassed on screen.
  const serviceArea = useServiceArea();
  const pickupOutside = isOutsideServiceArea(serviceArea, pickup.lat, pickup.lng);
  const dropoffOutside = isOutsideServiceArea(serviceArea, dropoff.lat, dropoff.lng);
  const outsideEnd = pickupOutside ? "pickup" : dropoffOutside ? "destination" : null;

  // Route and fare. Rule 6.2: the estimate is priced from the confirmed OSRM road route, and the fare itself is
  // computed by the database (public.quote_fare); this screen holds no tariff and no formula.
  const [tripDistanceKm, setTripDistanceKm] = useState<number | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [routeRetry, setRouteRetry] = useState<number>(0);
  const [fetchedQuote, setQuote] = useState<FareQuote | null>(null);
  const [quoteRetry, setQuoteRetry] = useState<number>(0);
  const [fareNotice, setFareNotice] = useState<string>("");
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  // A quote is only good for the headcount it was priced for: while the new one is on its way there is no fare to confirm.
  const quote = fetchedQuote && fetchedQuote.passenger_count === passengers ? fetchedQuote : null;
  const estimatedFare = quote ? estimatedFareFor(quote, tripType) : null;
  const routeErrorText =
    language === "tl"
      ? "Hindi makuha ang ruta sa mapa ngayon. Pakisubukang muli."
      : "We couldn't get the road route right now. Please try again.";

  // Searching State matching TIER 1 - SOLO.png
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [activeBooking, setActiveBooking] = useState<BookingRecord | null>(null);
  const [bookingSubmitting, setBookingSubmitting] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string>("");
  // The search for a driver is the DATABASE's: it starts when the booking is made, offers it driver by driver, widens, and ends it. This screen
  // only follows it. While searching it is still looking, or the search ended with nobody (No Driver Found: Retry or Cancel, Rule 7.4).
  const { status: searchStatus, refresh: refreshSearch } = useDispatchStatus(activeBooking?.booking_id);
  const searchOutcome: DriverSearchOutcome = searchStatus?.bookingStatus === "No Driver Found" ? "noDriver" : "searching";
  const searching = isSearching && searchStatus?.bookingStatus !== "Cancelled";
  // Ride-sharing (Rule 14.2.1): while a Shared booking is searching, a driver on a trip nearby may be asked to take it; the database says so (nothing is shown otherwise)
  const sharedMatch = useSharedMatch(supabase, activeBooking?.booking_id, searching && searchOutcome === "searching" && tripType === "Shared");
  // How far the database is looking right now (null once the search ended, or when it does not say): the map draws exactly this, nothing invented
  const searchRadiusMeters = searching ? searchRadiusFromStatus(searchStatus) : null;

  // What covers the map: the header buttons along the top, and the booking sheet (plus the Back / Recenter buttons that sit on top of it) along
  // the bottom. The camera frames and centres inside what is left; the sheet's height is measured, so it follows it growing or shrinking.
  const safeArea = useSafeAreaInsets();
  const mapInsets = useMemo(
    () => ({ top: safeArea.top + 76, right: 24, bottom: safeArea.bottom + bottomSheetHeight + 64, left: 24 }),
    [safeArea.top, safeArea.bottom, bottomSheetHeight]
  );

  // Always query real device location on mount so passenger actual location is pinned
  useEffect(() => {
    if (navState?.coords && navState.coords.lat !== 0) {
      setPickup((prev) => {
        if (prev.isCustom) return prev;
        return {
          address: prev.address || (language === "tl" ? "Kasalukuyang Lokasyon" : "Current Location"),
          lat: navState.coords!.lat,
          lng: navState.coords!.lng,
        };
      });
      setRecenterTrigger((prev) => prev + 1);
    }

    getCurrentDevicePosition()
      .then((coords) => {
        setPickup((prev) => {
          if (prev.isCustom) return prev;
          const updated = {
            address: prev.address || (language === "tl" ? "Kasalukuyang Lokasyon" : "Current Location"),
            lat: coords.latitude,
            lng: coords.longitude,
          };
          sessionStorage.setItem("trip_pickup", JSON.stringify(updated));
          return updated;
        });
        setRecenterTrigger((prev) => prev + 1);
      })
      .catch((err) => {
        console.warn("[NewTrip] Note on device geolocation:", err);
      });
  }, []);

  // Reverse-geocode pickup coordinates if generic
  useEffect(() => {
    const isGeneric =
      !pickup.address ||
      pickup.address === "Kasalukuyang Lokasyon" ||
      pickup.address === "Current Location" ||
      pickup.address === "Pumili ng pickup location" ||
      pickup.address === "Choose pickup location";

    if (pickup.lat && pickup.lat !== 0 && isGeneric && !pickup.isCustom) {
      reverseGeocodeCoordinates(pickup.lat, pickup.lng).then((realAddress) => {
        if (realAddress && !realAddress.startsWith("Kasalukuyang Lokasyon")) {
          setPickup((prev) => {
            if (prev.isCustom) return prev;
            const updated = { ...prev, address: realAddress };
            sessionStorage.setItem("trip_pickup", JSON.stringify(updated));
            return updated;
          });
        }
      });
    }
  }, [pickup.lat, pickup.lng, pickup.address, pickup.isCustom]);

  // Load real passenger profile from Supabase
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: profile } = await supabase
            .from("passenger")
            .select("passenger_id, full_name, contact_number")
            .eq("auth_user_id", user.id)
            .maybeSingle();

          if (profile) {
            if (profile.full_name) setProfileName(profile.full_name);
            if (profile.contact_number) setPassengerPhone(profile.contact_number);
            if (profile.passenger_id) setPassengerId(profile.passenger_id);
          } else if (user.user_metadata?.full_name) {
            setProfileName(user.user_metadata.full_name);
          }
        }
      } catch (err) {
        console.error("Error fetching profile from database:", err);
      }
    };
    fetchProfile();
  }, []);

  const [sharedDisclaimerAgreed, setSharedDisclaimerAgreed] = useState<boolean>(false);

  // The road route (Rule 6.2). A straight-line guess is not a route: if OSRM cannot be reached, nothing is priced
  // and the booking is blocked (decision D5) instead of confirming a fare the passenger cannot rely on.
  useEffect(() => {
    if (!pickup.lat || !dropoff.lat || pickup.lat === 0 || dropoff.lat === 0 || pickupOutside || dropoffOutside) {
      setRouteCoordinates([]);
      setTripDistanceKm(null);
      setQuote(null);
      setRouteStatus("idle");
      return;
    }

    let cancelled = false;
    setRouteStatus("loading");
    setTripDistanceKm(null);
    setQuote(null);
    setFareNotice("");

    getOSRMRoute(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng)
      .then((route) => {
        if (cancelled) return;
        if (route.source !== "osrm" || !(route.distanceKm > 0)) {
          setRouteCoordinates([]);
          setRouteStatus("error");
          return;
        }
        if (route.coordinates && route.coordinates.length >= 2) {
          setRouteCoordinates(route.coordinates);
        }
        setTripDistanceKm(route.distanceKm);
        setRouteStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setRouteStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, routeRetry, pickupOutside, dropoffOutside]);

  // The fare for that route and headcount, from the database (both trip types come back in one quote).
  useEffect(() => {
    if (routeStatus !== "ready" || tripDistanceKm === null) return;

    let cancelled = false;
    fetchFareQuote(supabase, tripDistanceKm, passengers)
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setQuote(null);
        const parsed = parseFareError(err instanceof Error ? err.message : "");
        setFareNotice(parsed ? describeFareError(parsed, language) : language === "tl" ? "Hindi makuha ang pamasahe ngayon. Pakisubukang muli." : "We could not get the fare right now. Please try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [routeStatus, tripDistanceKm, passengers, quoteRetry, language]);

  // Already searching or on a trip (the app was closed or refreshed, or it is another device)? The database knows: go to that booking
  // instead of letting the passenger fill in a second one that Rule 4.4 would refuse.
  useEffect(() => {
    let cancelled = false;
    fetchOpenBooking().then((open) => {
      if (!cancelled && open) navigate("/trip-monitoring", { replace: true, state: { bookingId: open.booking_id } });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // A driver accepted (the database assigned him): go to the trip. The search, its end and a Retry are the database's (useDispatchStatus).
  const driverAssigned = searchStatus?.driverAssigned === true;
  useEffect(() => {
    if (driverAssigned && activeBooking?.booking_id) {
      navigate("/trip-monitoring", { state: { bookingId: activeBooking.booking_id } });
    }
  }, [driverAssigned, activeBooking?.booking_id, navigate]);

  const handleOpenSetPlace = (target: "pickup" | "dropoff") => {
    navigate("/set-place", {
      state: {
        target,
        address: target === "pickup" ? pickup.address : dropoff.address,
        lat: target === "pickup" ? pickup.lat : dropoff.lat,
        lng: target === "pickup" ? pickup.lng : dropoff.lng,
      },
    });
  };

  const handleRecenterGps = async () => {
    try {
      const coords = await getCurrentDevicePosition();
      let realAddr = "";
      try {
        realAddr = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
      } catch {}
      const updated = {
        address:
          realAddr && !realAddr.startsWith("Kasalukuyang Lokasyon")
            ? realAddr
            : language === "tl"
            ? "Kasalukuyang Lokasyon"
            : "Current Location",
        lat: coords.latitude,
        lng: coords.longitude,
      };
      setPickup(updated);
      sessionStorage.setItem("trip_pickup", JSON.stringify(updated));
      setRecenterTrigger((prev) => prev + 1);
    } catch {
      setRecenterTrigger((prev) => prev + 1);
    }
  };

  const handleSetCurrentLocationFor = async (target: "pickup" | "dropoff", e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const coords = await getCurrentDevicePosition();
      let realAddr = "";
      try {
        realAddr = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
      } catch {}

      const finalAddr =
        realAddr && !realAddr.startsWith("Kasalukuyang Lokasyon")
          ? realAddr
          : language === "tl"
          ? "Kasalukuyang Lokasyon"
          : "Current Location";

      const locObj = {
        address: finalAddr,
        lat: coords.latitude,
        lng: coords.longitude,
        isCustom: target === "dropoff",
      };

      if (target === "pickup") {
        setPickup(locObj);
        sessionStorage.setItem("trip_pickup", JSON.stringify(locObj));
      } else {
        setDropoff(locObj);
        sessionStorage.setItem("trip_dropoff", JSON.stringify(locObj));
      }
      setRecenterTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to set current location:", err);
    }
  };

  const handleBookTrip = async () => {
    if (outsideEnd) {
      setValidationError(outsideServiceAreaMessage(language, outsideEnd));
      return;
    }
    if (!dropoff.address || dropoff.lat === 0) {
      setValidationError(
        language === "tl"
          ? "Mangyaring ilagay ang iyong destinasyon."
          : "Please enter your destination."
      );
      return;
    }
    if (!pickup.lat || pickup.lat === 0) {
      setValidationError(
        language === "tl"
          ? "Mangyaring pumili ng pickup point."
          : "Please select a pickup point."
      );
      return;
    }

    // Decision D5: no road route, no priced estimate, no booking.
    if (routeStatus !== "ready" || !quote || tripDistanceKm === null || estimatedFare === null) {
      setValidationError(
        routeStatus === "error"
          ? routeErrorText
          : language === "tl"
          ? "Hinihintay pa ang pamasahe. Pakisubukang muli sa ilang sandali."
          : "The fare is still loading. Please try again in a moment."
      );
      return;
    }

    setValidationError("");
    setBookingSubmitting(true);

    try {
      const newBookingRecord = await createBooking({
        passenger_id: passengerId,
        passenger_name: profileName || "Passenger",
        passenger_phone: passengerPhone,
        booking_type: "Immediate",
        is_shared_trip: tripType === "Shared",
        passenger_count: passengers,
        pickup_address: pickup.address,
        pickup_latitude: pickup.lat,
        pickup_longitude: pickup.lng,
        dropoff_address: dropoff.address,
        dropoff_latitude: dropoff.lat,
        dropoff_longitude: dropoff.lng,
        estimated_distance_km: tripDistanceKm,
        estimated_fare: estimatedFare,
      });

      // The database started the search the moment the booking was inserted; there is nothing to start from here.
      setActiveBooking(newBookingRecord);
      setSearchError("");
      setIsSearching(true);
      setBookingSubmitting(false);
    } catch (err: unknown) {
      setBookingSubmitting(false);
      const msg = err instanceof Error ? err.message : "Booking submission error";
      setValidationError(msg);
      // The rate changed (or the figure was off) between the quote and the tap: show the current fare again.
      if ((err as { fareCode?: string } | null)?.fareCode === "ERR_FARE_MISMATCH") {
        setQuoteRetry((n) => n + 1);
      }
    }
  };

  const handleConfirmCancelBooking = async (reasonText: string) => {
    setCancelling(true);
    try {
      // The search only stops when the booking really is cancelled in the database: if that did not save, keep showing the
      // search (it is still running and the booking is still open) instead of pretending it was cancelled.
      const cancelled = activeBooking?.booking_id ? await cancelBooking(activeBooking.booking_id, reasonText) : true;
      setCancelModalOpen(false);
      if (cancelled) {
        setIsSearching(false);
        setActiveBooking(null);
        setSearchError("");
      } else {
        setSearchError(
          language === "tl"
            ? "Hindi na-kansela ang booking. Pakisubukang muli."
            : "We couldn't cancel the booking. Please try again."
        );
      }
    } finally {
      setCancelling(false);
    }
  };

  // No Driver Found -> Retry: a new search round that starts again from the nearest drivers (Rule 7.4)
  const retryFlight = useInFlight();

  const restartDriverSearch = async () => {
    if (!activeBooking?.booking_id) return;
    setSearchError("");
    const restarted = await retryDriverSearch(activeBooking.booking_id);
    if (restarted.ok) {
      await refreshSearch();
    } else {
      setSearchError(describeRetryRefusal(restarted.errorCode, language));
    }
  };

  const handleRetrySearch = () => retryFlight.run(restartDriverSearch);

  // No Driver Found -> Cancel (Rule 7.4, without penalty): the screen is left at once and the booking is closed in the database too. The database
  // never strikes or flags a passenger for it, and the close happens only while the booking is STILL No Driver Found (this screen may be out of
  // date: it must never cancel a booking that was retried or accepted since). If the close cannot be saved the booking simply stays No Driver
  // Found, which is not open either, so leaving is never held up.
  const handleLeaveNoDriverFound = () => {
    const bookingId = activeBooking?.booking_id;
    setIsSearching(false);
    setActiveBooking(null);
    setSearchError("");
    if (bookingId) void cancelBooking(bookingId, "No driver found", "No Driver Found");
  };

  const handleCancelBooking = () => {
    setCancelModalOpen(true);
  };

  const handleSaveNotes = () => {
    setNoteText(tempNoteText);
    sessionStorage.setItem("trip_notes", tempNoteText);
    setNotesDialogOpen(false);
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#E3ECEF",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 1. Real Google Maps View */}
      <MapView
        userLocation={pickup.lat ? { lat: pickup.lat, lng: pickup.lng } : undefined}
        pickupLocation={pickup.lat ? pickup : undefined}
        dropoffLocation={dropoff.lat && !dropoffOutside ? dropoff : undefined}
        pickupLabel={{ title: "Pickup", address: pickup.address }}
        dropoffLabel={{ title: language === "tl" ? "Destinasyon" : "Destination", address: dropoff.address }}
        routeCoordinates={routeCoordinates}
        recenterTrigger={recenterTrigger}
        insets={mapInsets}
        searchRadiusMeters={searchRadiusMeters}
        stageKey={searching ? "searching" : "booking"}
      />

      {/* 2. Top Header Controls matching BOOK - SOLO.png (Menu, Bell, Tulong) */}
      <HomeHeader
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenTulong={() => setTulongOpen(true)}
      />

      {/* 3. Floating Left Back Button over Map */}
      <IconButton
        onClick={() => {
          sessionStorage.removeItem("trip_dropoff");
          sessionStorage.removeItem("trip_notes");
          if (searching && searchOutcome === "noDriver") {
            handleLeaveNoDriverFound();
          } else if (searching) {
            handleCancelBooking();
          } else {
            navigate("/dashboard");
          }
        }}
        aria-label="Back"
        sx={{
          position: "absolute",
          bottom: `calc(var(--safe-area-bottom) + ${bottomSheetHeight + 16}px)`,
          left: "16px",
          backgroundColor: "#FFFFFF",
          width: "44px",
          height: "44px",
          borderRadius: "14px",
          boxShadow: "0 4px 14px rgba(15, 23, 42, 0.12)",
          color: "#0F172A",
          zIndex: 10,
          transition: "bottom 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease",
          "&:hover": { backgroundColor: "#F8FAFC" },
        }}
      >
        <ArrowBackIcon sx={{ fontSize: 22 }} />
      </IconButton>

      {/* 4. Floating Right GPS Recenter Button over Map matching Dashboard.tsx */}
      <IconButton
        onClick={handleRecenterGps}
        aria-label="Recenter location"
        sx={{
          position: "absolute",
          bottom: `calc(var(--safe-area-bottom) + ${bottomSheetHeight + 16}px)`,
          right: "16px",
          backgroundColor: "#FFFFFF",
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          boxShadow: "0 4px 14px rgba(15, 23, 42, 0.15)",
          color: "#0F172A",
          zIndex: 10,
          transition: "bottom 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease",
          "&:hover": {
            backgroundColor: "#F8FAFC",
            transform: "scale(1.05)",
          },
          "&:active": {
            transform: "scale(0.95)",
          },
        }}
      >
        <MyLocationIcon sx={{ fontSize: 22, color: "#0F172A" }} />
      </IconButton>

      {/* 5. Bottom Sheet Container */}
      <Paper
        ref={bottomSheetRef}
        elevation={4}
        sx={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "#FFFFFF",
          borderTopLeftRadius: "28px",
          borderTopRightRadius: "28px",
          padding: 0,
          zIndex: 10,
          boxShadow: "0 -10px 30px rgba(15, 23, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          // Never taller than the screen less the header and floating buttons: the map stays in view, the body scrolls.
          maxHeight: "calc(100% - 176px)",
          "@media (max-height: 640px)": { maxHeight: "calc(100% - 150px)" },
          overflow: "hidden",
        }}
      >
        {searching ? (
          /* ====================================================================
             TIER 1 - SOLO.png SEARCHING STATE (and its No Driver Found outcome)
             ==================================================================== */
          <Box sx={{ p: "16px 20px calc(var(--safe-area-bottom) + 20px) 20px", overflowY: "auto" }}>
            <DriverSearchPanel
              language={language}
              outcome={searchOutcome}
              widening={searchStatus?.phase === "widening"}
              startedAt={searchStatus?.startedAt}
              errorMessage={searchError}
              details={buildTripDetails({
                role: "passenger",
                status: searchOutcome === "noDriver" ? "No Driver Found" : "Searching Driver",
                pickupAddress: pickup.address,
                dropoffAddress: dropoff.address,
                isSharedTrip: tripType === "Shared",
                passengerCount: passengers,
                estimatedFare,
              })}
              onCancel={searchOutcome === "noDriver" ? handleLeaveNoDriverFound : handleCancelBooking}
              onRetry={handleRetrySearch}
              onChangePickup={searchOutcome === "searching" && activeBooking ? () => setChangePickupOpen(true) : undefined}
              sharedMatch={<SharedMatchPanel view={sharedMatch.view} language={language} secondsLeft={sharedMatch.secondsLeft} busy={sharedMatch.busy} errorMessage={sharedMatch.error} onRespond={(accept) => void sharedMatch.respond(accept)} />}
            />
          </Box>
        ) : (
          /* ====================================================================
             BOOK - SOLO.png NORMAL BOOKING STATE
             ==================================================================== */
          <>
            {/* The scrolling body: the sheet never grows past the screen, so the map stays visible and long content scrolls inside it */}
            <Box
              className="scroll-cue hide-scrollbar"
              sx={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", px: "20px", pt: "16px", pb: "12px", display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {/* 1. PICKUP Card (Soft Beige/Cream #FAF2EA) */}
              <Box
                role="button"
                tabIndex={0}
                onKeyDown={activateWithKeyboard}
                onClick={() => handleOpenSetPlace("pickup")}
                sx={{
                  backgroundColor: "#FAF2EA",
                  borderRadius: "16px",
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  "&:hover": { backgroundColor: "#F5EBE1" },
                }}
              >
                {/* Orange Radio Circle Indicator */}
                <Box
                  sx={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    border: "2px solid #FF6600",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Box
                    sx={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: "#FF6600",
                    }}
                  />
                </Box>

                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#64748B",
                      fontFamily: "Poppins, sans-serif",
                    }}
                  >
                    Pickup
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0F172A",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      fontFamily: "Poppins, sans-serif",
                    }}
                  >
                    {pickup.address ||
                      (language === "tl" ? "Pumili ng pickup location" : "Choose pickup location")}
                  </Typography>
                </Box>

                {/* Quick 1-Tap Current Location Button */}
                <IconButton
                  size="small"
                  onClick={(e) => handleSetCurrentLocationFor("pickup", e)}
                  title={language === "tl" ? "Gamitin ang Kasalukuyang Lokasyon" : "Use current location"}
                  aria-label={language === "tl" ? "Gamitin ang kasalukuyang lokasyon bilang pickup" : "Use current location as pickup"}
                  sx={{
                    ...extendTapArea(6),
                    backgroundColor: "rgba(255, 102, 0, 0.12)",
                    color: "#FF6600",
                    width: "32px",
                    height: "32px",
                    borderRadius: "10px",
                    flexShrink: 0,
                    "&:hover": { backgroundColor: "rgba(255, 102, 0, 0.22)" },
                  }}
                >
                  <MyLocationIcon sx={{ fontSize: "16px" }} />
                </IconButton>
              </Box>

              {/* 2. DESTINASYON Card (Soft Mint #F2F8F4) */}
              <Box
                onClick={() => handleOpenSetPlace("dropoff")}
                role="button"
                tabIndex={0}
                onKeyDown={activateWithKeyboard}
                aria-label={language === "tl" ? "Piliin ang destinasyon" : "Choose destination"}
                sx={{
                  backgroundColor: "#F2F8F4",
                  borderRadius: "16px",
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  "&:hover": { backgroundColor: "#E6F3EA" },
                }}
              >
                {/* High-Contrast Standalone Red Destination Location Pin */}
                <LocationOnIcon sx={{ color: "#EF4444", fontSize: "24px", flexShrink: 0 }} />

                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#64748B",
                      fontFamily: "Poppins, sans-serif",
                    }}
                  >
                    {language === "tl" ? "Destinasyon" : "Destination"}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "13px",
                      fontWeight: dropoff.address ? 600 : 400,
                      color: dropoff.address ? "#0F172A" : "#64748B",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      overflowWrap: "anywhere",
                      lineHeight: 1.3,
                      fontFamily: "Poppins, sans-serif",
                    }}
                  >
                    {dropoff.address ||
                      (language === "tl" ? "Saan pupunta?" : "Where to go?")}
                  </Typography>
                </Box>

                {dropoff.address ? (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropoff({ address: "", lat: 0, lng: 0 });
                      sessionStorage.removeItem("trip_dropoff");
                      setRouteCoordinates([]);
                    }}
                    title={language === "tl" ? "Burahin ang destinasyon" : "Clear destination"}
                    aria-label={language === "tl" ? "Burahin ang destinasyon" : "Clear destination"}
                    sx={{
                      ...extendTapArea(6),
                      backgroundColor: "rgba(239, 68, 68, 0.1)",
                      color: "#EF4444",
                      width: "32px",
                      height: "32px",
                      borderRadius: "10px",
                      flexShrink: 0,
                      "&:hover": { backgroundColor: "rgba(239, 68, 68, 0.2)" },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: "16px" }} />
                  </IconButton>
                ) : (
                  /* Quick 1-Tap Current Location Button for Dropoff */
                  <IconButton
                    size="small"
                    onClick={(e) => handleSetCurrentLocationFor("dropoff", e)}
                    title={language === "tl" ? "Gamitin ang Kasalukuyang Lokasyon para sa Destinasyon" : "Use current location for destination"}
                    aria-label={language === "tl" ? "Gamitin ang kasalukuyang lokasyon bilang destinasyon" : "Use current location as destination"}
                    sx={{
                      ...extendTapArea(6),
                      backgroundColor: "rgba(15, 23, 42, 0.08)",
                      color: "#0F172A",
                      width: "32px",
                      height: "32px",
                      borderRadius: "10px",
                      flexShrink: 0,
                      "&:hover": { backgroundColor: "rgba(15, 23, 42, 0.16)" },
                    }}
                  >
                    <MyLocationIcon sx={{ fontSize: "16px" }} />
                  </IconButton>
                )}
              </Box>

              {/* Trip type, passengers and the driver note */}
              <BookingOptions
                language={language}
                tripType={tripType}
                passengers={passengers}
                maxPassengers={tripType === "Shared" ? SHARED_BOOKING_MAX_PASSENGERS : FARE_SEAT_CAPACITY}
                note={noteText}
                onTripTypeChange={(next) => {
                  setTripType(next);
                  if (next === "Shared" && passengers > SHARED_BOOKING_MAX_PASSENGERS) setPassengers(SHARED_BOOKING_MAX_PASSENGERS);
                }}
                onPassengersChange={setPassengers}
                onOpenNote={() => {
                  setTempNoteText(noteText);
                  setNotesDialogOpen(true);
                }}
                onOpenTripTypeInfo={() => setTripTypeInfoOpen(true)}
              />

              {/* Rule 6.5: both fares, the cutoff and the acknowledgement, shown before Book is tapped */}
              {tripType === "Shared" && quote && (
                <SharedFareNotice
                  language={language}
                  matchedEstimate={quote.shared_matched_estimate}
                  maxUnmatchedFare={quote.max_unmatched_fare}
                  partnerAssumptionPassengers={quote.partner_assumption_passengers}
                />
              )}

            </Box>

            {/* The footer stays in view: why Book is unavailable, the fare, and the Book button */}
            <Box sx={{ flexShrink: 0, px: "20px", pt: "12px", pb: "calc(var(--safe-area-bottom) + 16px)", borderTop: "1px solid #F1F5F9", display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Outside the service area: no route, no fare, no booking */}
              {outsideEnd && (
                <Alert severity="error" sx={{ borderRadius: "12px", py: 0.5, fontWeight: 600 }}>
                  {outsideServiceAreaMessage(language, outsideEnd)}
                </Alert>
              )}

              {/* Validation Error Alert */}
              {validationError && (
                <Alert severity="warning" sx={{ borderRadius: "12px", py: 0.5 }}>
                  {messageForLanguage(validationError, language)}
                </Alert>
              )}

              {/* Shared only: the one tick Book waits for, next to the button it unlocks */}
              {tripType === "Shared" && quote && (
                <SharedAcknowledgement
                  language={language}
                  checked={sharedDisclaimerAgreed}
                  onChange={setSharedDisclaimerAgreed}
                />
              )}
              {/* 4. ESTIMATED FARE Section */}
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Typography
                        sx={{
                          fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                          fontWeight: 700,
                          color: "#64748B",
                          fontFamily: "Poppins, sans-serif",
                        }}
                      >
                        {language === "tl" ? "Tinatayang pamasahe" : "Estimated fare"}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => setTariffInfoOpen(true)}
                        title={language === "tl" ? "Taripa at Detalye ng Pamasahe" : "Tariff & Fare Details"}
                        aria-label={language === "tl" ? "Taripa at detalye ng pamasahe" : "Tariff and fare details"}
                        sx={{ p: 0, color: "#64748B", "&:hover": { color: "#64748B" }, ...extendTapArea(16) }}
                      >
                        <InfoOutlinedIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Box>
                    <Typography
                      sx={{ fontSize: "12px", lineHeight: 1.3, color: "#64748B", fontFamily: "Poppins, sans-serif" }}
                    >
                      {language === "tl" ? "Bayad sa cash" : "Cash payment"}
                    </Typography>
                  </Box>

                  <Typography
                    sx={{
                      fontSize: "20px",
                      fontWeight: 700,
                      color: "#0F172A",
                      fontFamily: "Poppins, sans-serif",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {estimatedFare !== null ? `₱${estimatedFare.toFixed(2)}` : routeStatus === "loading" || (routeStatus === "ready" && !fareNotice) ? "…" : "—"}
                  </Typography>
                </Box>

                {(routeStatus === "error" || fareNotice) && (
                  <Alert
                    severity="warning"
                    sx={{ borderRadius: "12px", fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary, fontFamily: "Poppins, sans-serif" }}
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        onClick={() => {
                          setFareNotice("");
                          if (routeStatus === "error") setRouteRetry((n) => n + 1);
                          else setQuoteRetry((n) => n + 1);
                        }}
                        sx={{ textTransform: "none", fontWeight: 700 }}
                      >
                        {language === "tl" ? "Subukan muli" : "Retry"}
                      </Button>
                    }
                  >
                    {routeStatus === "error" ? routeErrorText : fareNotice}
                  </Alert>
                )}
              </Box>

              {/* 5. Bottom Action Row: Mag-book ng Biyahe */}
              <Box sx={{ width: "100%", mt: "6px" }}>
                {/* Primary Mag-book ng Biyahe Button */}
                <PrimaryButton
                  fullWidth
                  onClick={handleBookTrip}
                  loading={bookingSubmitting}
                  loadingLabel={language === "tl" ? "Inihahanda..." : "Preparing..."}
                  disabled={
                    outsideEnd !== null ||
                    !dropoff.address ||
                    dropoff.lat === 0 ||
                    !pickup.lat ||
                    pickup.lat === 0 ||
                    estimatedFare === null ||
                    (tripType === "Shared" && !sharedDisclaimerAgreed)
                  }
                >
                  {language === "tl" ? "Mag-book ng Biyahe" : "Book Ride"}
                </PrimaryButton>
              </Box>
            </Box>
          </>
        )}
      </Paper>

      {/* 6. Notes Modal */}
      <Dialog
        open={notesDialogOpen}
        onClose={() => setNotesDialogOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderRadius: "20px",
              padding: "10px",
              maxWidth: "360px",
              width: "90%",
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontWeight: 700,
            fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle,
            fontFamily: "Poppins, sans-serif",
          }}
        >
          {language === "tl" ? "Mga Tala para sa Drayber" : "Notes for Driver"}
          <IconButton aria-label={language === "tl" ? "Isara" : "Close"} size="small" onClick={() => setNotesDialogOpen(false)} sx={extendTapArea(7)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <TextField
            multiline
            rows={3}
            fullWidth
            value={tempNoteText}
            onChange={(e) => setTempNoteText(e.target.value)}
            label={language === "tl" ? "Mga Tala para sa Drayber" : "Notes for Driver"}
            placeholder={
              language === "tl"
                ? "Hal. Sa tapat po ng tindahan maghintay, may dalang mabigat na gamit..."
                : "E.g. Please wait in front of the store, carrying heavy luggage..."
            }
            slotProps={{
              input: {
                sx: {
                  borderRadius: "14px",
                  backgroundColor: "#F8FAFC",
                  "& fieldset": { borderColor: "#E2E8F0" },
                  "&:hover fieldset": { borderColor: "#CBD5E1" },
                  "&.Mui-focused fieldset": { borderColor: "#FF6600" },
                  fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile,
                  fontFamily: "Poppins, sans-serif",
                },
              },
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button
            onClick={() => setNotesDialogOpen(false)}
            sx={{
              color: "#64748B",
              fontWeight: 600,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            {language === "tl" ? "Kanselahin" : "Cancel"}
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveNotes}
            sx={{
              // white text on this orange keeps 4.5:1 (on the brand #FF6600 it would be 3:1)
              backgroundColor: "#C75000",
              color: "#FFFFFF",
              borderRadius: "12px",
              fontWeight: 700,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
              textTransform: "none",
              boxShadow: "none",
              fontFamily: "Poppins, sans-serif",
              whiteSpace: "nowrap",
              "&:hover": { backgroundColor: "#B04600", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "I-save ang Tala" : "Save Note"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 7. Angkas-Style Fare Breakdown Popup Modal matching media_1790154119178.png */}
      <Dialog
        open={tariffInfoOpen}
        onClose={() => setTariffInfoOpen(false)}
        fullWidth
        maxWidth="xs"
        slotProps={{
          paper: {
            sx: {
              borderRadius: "28px",
              overflow: "hidden",
              p: 0,
            },
          },
        }}
      >
        {/* Light Orange Top Header Box with Toto Head */}
        <Box
          sx={{
            backgroundColor: "#FFF5ED",
            p: 3,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            position: "relative",
          }}
        >
          <IconButton
            aria-label={language === "tl" ? "Isara" : "Close"}
            onClick={() => setTariffInfoOpen(false)}
            sx={{ ...extendTapArea(7), position: "absolute", top: 12, right: 12, color: "#64748B" }}
            size="small"
          >
            <CloseIcon fontSize="small" />
          </IconButton>

          <Box component="img" src={totoHeadImg} alt="Toto Head" sx={{ width: 44, height: 44, objectFit: "contain", mb: 0.75 }} />
          <Typography sx={{ fontSize: "17px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Kalkulasyon ng Pamasahe" : "Fare Breakdown"}
          </Typography>
          <Typography sx={{ fontSize: "12px", color: "#64748B", fontWeight: 600, mt: "2px", fontFamily: "Poppins, sans-serif" }}>
            {quote?.rule.ordinance_reference
              ? `Official City Tariff Rate • ${quote.rule.ordinance_reference}`
              : "Official City Tariff Rate"}
          </Typography>
        </Box>

        {/* Receipt Container Body: every figure below comes from the database quote */}
        {quote ? (() => {
          const comps = componentsFor(quote, tripType);
          const displayedTotal = estimatedFareFor(quote, tripType);
          const rule = quote.rule;
          const money = formatPeso;
          const shareSeats = Math.min(passengers + quote.partner_assumption_passengers, quote.seat_capacity);

          return (
            <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: "16px",
                  backgroundColor: "#F8FAFC",
                  border: "1px dashed #CBD5E1",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.25,
                }}
              >
                <FareLine label={language === "tl" ? "Kabuuang distansya" : "Total distance"} amount={`${quote.distance_km.toFixed(1)}\u00A0km`} />

                <FareLine
                  label={
                    language === "tl"
                      ? `Unang ${rule.base_distance_km.toFixed(1)} km (base fare)`
                      : `Base fare (first ${rule.base_distance_km.toFixed(1)} km)`
                  }
                  detail={
                    tripType === "Solo"
                      ? `${money(rule.base_fare)} × ${quote.seat_capacity} ${language === "tl" ? "upuan (Solo)" : "seats (Solo)"}`
                      : language === "tl"
                      ? `Hati mo sa buong tricycle (${passengers} sa ${shareSeats} upuan)`
                      : `Your share of the whole tricycle (${passengers} of ${shareSeats} seats)`
                  }
                  amount={money(comps.base)}
                />

                <FareLine
                  label={
                    language === "tl"
                      ? `Dagdag na distansya (${quote.excess_km.toFixed(1)} km)`
                      : `Distance charge (${quote.excess_km.toFixed(1)} km)`
                  }
                  detail={
                    tripType === "Solo" && quote.excess_km > 0
                      ? `${quote.excess_km.toFixed(1)} km × ${money(rule.succeeding_rate)} × ${quote.seat_capacity}`
                      : undefined
                  }
                  amount={money(comps.distance)}
                />

                <Divider sx={{ borderColor: "#CBD5E1", borderStyle: "dashed", my: 0.5 }} />

                <FareLine emphasis="total" label={language === "tl" ? "Kabuuan" : "Total fare"} amount={money(displayedTotal)} />

                {/* The database charges whole pesos (Rule 6.1.2), so the lines above can differ from the total by a few centavos. One quiet line says so, only when it is true. */}
                {comps.adjustment !== 0 && (
                  <Typography sx={{ fontSize: "12px", lineHeight: 1.4, color: "#64748B", fontFamily: "Poppins, sans-serif", textAlign: "right" }}>
                    {language === "tl" ? "Buong piso ang singil ayon sa fare rule ng LGU." : "Charged in whole pesos under the LGU fare rule."}
                  </Typography>
                )}
              </Box>

              {/* Payment Method Badge */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 0.5 }}>
                <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Paraan ng Pagbayad" : "Pay Using"}
                </Typography>
                <Chip
                  label="₱ Cash"
                  size="small"
                  sx={{ backgroundColor: "#FF6600", color: "#1A1A1A", fontWeight: 700, fontSize: "12px", height: "26px" }}
                />
              </Box>
            </Box>
          );
        })() : (
          <Box sx={{ p: 3 }}>
            <Typography sx={{ fontSize: "13px", color: "#64748B", fontFamily: "Poppins, sans-serif", textAlign: "center" }}>
              {language === "tl" ? "Kinakalkula ang pamasahe..." : "Calculating the fare..."}
            </Typography>
          </Box>
        )}
      </Dialog>

      {/* 8. Trip Type Info Modal */}
      <Dialog
        open={tripTypeInfoOpen}
        onClose={() => setTripTypeInfoOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderRadius: "20px",
              padding: "10px",
              maxWidth: "360px",
              width: "90%",
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontWeight: 700,
            fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle,
            fontFamily: "Poppins, sans-serif",
          }}
        >
          {language === "tl" ? "Uri ng Biyahe" : "Trip Type"}
          <IconButton aria-label={language === "tl" ? "Isara" : "Close"} size="small" onClick={() => setTripTypeInfoOpen(false)} sx={extendTapArea(7)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
            <Paper
              elevation={0}
              sx={{
                p: 1.5,
                backgroundColor: "#FFF8F0",
                borderRadius: "14px",
                border: "1px solid #FFE4D6",
              }}
            >
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 700, color: "#FF6600" }}>
                Solo Trip
              </Typography>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary, color: "#64748B", mt: 0.5 }}>
                {language === "tl"
                  ? "Iyo ang buong tricycle (hanggang 4 na pasahero). Diretso ang biyahe nang walang kasabay."
                  : "You get the entire tricycle (up to 4 passengers). Direct route without other passengers."}
              </Typography>
            </Paper>

            <Paper
              elevation={0}
              sx={{
                p: 1.5,
                backgroundColor: "#ECFDF5",
                borderRadius: "14px",
                border: "1px solid #A7F3D0",
              }}
            >
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 700, color: "#059669" }}>
                Share Trip (Carpool)
              </Typography>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary, color: "#64748B", mt: 0.5 }}>
                {language === "tl"
                  ? `Makatipid ng pamasahe sa pamamagitan ng pag-share ng tricycle sa ibang pasaherong pareho ang ruta (hanggang ${SHARED_BOOKING_MAX_PASSENGERS} pasahero bawat booking; 4 pasahero, mag-Solo).`
                  : `Save on fare by carpooling with passengers heading the same way (up to ${SHARED_BOOKING_MAX_PASSENGERS} passengers per booking; a party of 4 books Solo).`}
              </Typography>
            </Paper>
          </Box>
        </DialogContent>
      </Dialog>



      {/* 10. Navigation Drawer & Support Dialogs */}
      <PassengerNavigationDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        profileName={profileName}
        onOpenTulong={() => setTulongOpen(true)}
        onLogout={async () => {
          try {
            await supabase.auth.signOut();
            localStorage.removeItem("sakay_passenger_phone");
            localStorage.removeItem("sakay_passenger_password");
            sessionStorage.clear();
          } catch (e) {
            console.warn("Logout error:", e);
          }
          navigate("/get-started", { replace: true });
        }}
      />
      <TulongDialog open={tulongOpen} onClose={() => setTulongOpen(false)} />
      <NotificationsDialog
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />

      {/* 11. Passenger Cancellation Modal matching PASSENGER CANCEL.png */}
      <PassengerCancelModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirmCancel={handleConfirmCancelBooking}
        language={language}
        loading={cancelling}
        phase="searching"
      />

      {/* Rule 29.9: change the pickup before a driver accepts (the database re-quotes the fare and starts the search over) */}
      {activeBooking && (
        <ChangePickupDialog
          open={changePickupOpen}
          language={language}
          bookingId={activeBooking.booking_id}
          passengers={passengers}
          tripType={tripType}
          dropoff={{ lat: dropoff.lat, lng: dropoff.lng }}
          currentFare={estimatedFare}
          serviceArea={serviceArea}
          onClose={() => setChangePickupOpen(false)}
          onChanged={(place) => {
            const updated = { address: place.address, lat: place.lat, lng: place.lng, isCustom: true };
            setPickup(updated);
            sessionStorage.setItem("trip_pickup", JSON.stringify(updated));
            setRecenterTrigger((prev) => prev + 1);
            void refreshSearch();
          }}
        />
      )}
    </Box>
  );
};

export default NewTrip;

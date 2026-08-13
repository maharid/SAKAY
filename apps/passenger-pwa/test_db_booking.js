import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://thxcltvgwwluvsfpciyr.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoeGNsdHZnd3dsdXZzZnBjaXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyODE4NDQsImV4cCI6MjA5OTg1Nzg0NH0.wDqoMM8RoZKgJPbIBU2xDu8GWCqYpNDlR1V9JKd7Voo";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runTest() {
  const timestamp = Date.now();
  const email = `test_passenger_${timestamp}@sakay.com`;
  const password = "TestPassword123!";

  console.log("1. Signing up test user:", email);
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: "Test Passenger Juan",
      },
    },
  });

  if (signUpError) {
    console.error("Sign up error:", signUpError);
    return;
  }

  const user = signUpData.user;
  if (!user) {
    console.error("No user returned");
    return;
  }
  console.log("User signed up successfully. UID:", user.id);

  // Wait a few seconds for the database trigger to auto-insert a row in public.passenger
  console.log("Waiting for trigger to generate passenger row...");
  await new Promise((resolve) => setTimeout(resolve, 4000));

  console.log("2. Querying passenger profile...");
  const { data: passenger, error: passengerError } = await supabase
    .from("passenger")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (passengerError) {
    console.error("Passenger profile error:", passengerError);
    return;
  }
  console.log("Passenger profile resolved. Passenger ID:", passenger.passenger_id);

  // Calapan coordinates for test
  // Calapan Plaza: lat 13.4124, lng 121.1834
  // City Hall of Calapan: lat 13.3980, lng 121.1824
  const pickup = { address: "Calapan Plaza", lat: 13.4124, lng: 121.1834 };
  const dropoff = { address: "City Hall of Calapan", lat: 13.3980, lng: 121.1824 };

  console.log("3. Querying OSRM road-network distance...");
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=false`;
  
  const res = await fetch(osrmUrl);
  if (!res.ok) {
    console.error("OSRM call failed");
    return;
  }
  const osrmData = await res.json();
  const distance_km = Math.round((osrmData.routes[0].distance / 1000) * 100) / 100;
  console.log("OSRM Road Distance:", distance_km, "km");

  // Apply user's verification example:
  // distance = 5km, base_fare = 15, base_distance_km = 2, succeeding_rate = 1
  // Seat Fare = 15 + (max(0, 5 - 2) * 1) = 15 + 3 = 18.
  // Total Fare = 18 * 4 = 72.
  // Let's do this math dynamically based on the OSRM distance:
  const test_base_fare = 15.0;
  const test_base_distance_km = 2.0;
  const test_succeeding_rate = 1.0;

  const extraDistance = Math.max(0, distance_km - test_base_distance_km);
  const seatFare = test_base_fare + extraDistance * test_succeeding_rate;
  const totalFare = seatFare * 4; // Solo multiplier is fixed to 4

  console.log("\n--- FARE CALCULATION VERIFICATION ---");
  console.log(`OSRM Distance: ${distance_km} km`);
  console.log(`Base Fare: ₱${test_base_fare} (first ${test_base_distance_km} km)`);
  console.log(`Succeeding Rate: ₱${test_succeeding_rate}/km`);
  console.log(`Formula: Seat Fare = base_fare + (max(0, distance - base_distance) * succeeding_rate)`);
  console.log(`Seat Fare: ${test_base_fare} + (${extraDistance} * ${test_succeeding_rate}) = ₱${seatFare}`);
  console.log(`Solo Trip Total Fare (Seat Fare * 4): ₱${totalFare}`);
  console.log("-------------------------------------\n");

  console.log("4. Inserting booking row into Supabase table...");
  const { data: booking, error: bookingError } = await supabase
    .from("booking")
    .insert({
      passenger_id: passenger.passenger_id,
      booking_type: "Immediate",
      is_shared_trip: false,
      passenger_count: 2, // test passengers
      pickup_address: pickup.address,
      pickup_latitude: pickup.lat,
      pickup_longitude: pickup.lng,
      dropoff_address: dropoff.address,
      dropoff_latitude: dropoff.lat,
      dropoff_longitude: dropoff.lng,
      estimated_distance_km: distance_km,
      estimated_fare: totalFare,
      booking_status: "Pending",
    })
    .select("*")
    .single();

  if (bookingError) {
    console.error("Booking insert error:", bookingError);
    return;
  }

  console.log("====================================================");
  console.log("TEST SUCCESSFUL! Verified Booking Row in database:");
  console.log(JSON.stringify(booking, null, 2));
  console.log("====================================================");
}

runTest();

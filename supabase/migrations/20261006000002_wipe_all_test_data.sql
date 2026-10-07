-- ====================================================================
-- RideSync / Payanam: Wipe Sandbox Test Data
-- Wipes all test rides, waypoints, pins, messages, and profiles
-- ====================================================================

TRUNCATE TABLE public.ride_messages CASCADE;
TRUNCATE TABLE public.ride_pins CASCADE;
TRUNCATE TABLE public.waypoints CASCADE;
TRUNCATE TABLE public.ride_members CASCADE;
TRUNCATE TABLE public.rides CASCADE;
TRUNCATE TABLE public.profiles CASCADE;

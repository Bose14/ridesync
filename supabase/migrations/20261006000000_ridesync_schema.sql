-- ====================================================================
-- RideSync Production Schema Migration
-- Database: PostgreSQL 15+ with PostGIS Extension
-- Features: Multi-rider Telemetry, RLS Security, Waypoints, Live Pins
-- ====================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 2. User Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    phone_number TEXT,
    bike_model TEXT,
    emergency_contact TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safely remove any existing auth.users foreign key lock if table was already created
ALTER TABLE IF EXISTS public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Index for username lookup
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- 3. Rides Table
CREATE TABLE IF NOT EXISTS public.rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    code TEXT UNIQUE NOT NULL, -- e.g., 'KODAI26'
    start_time TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    start_address TEXT,
    start_lat DOUBLE PRECISION NOT NULL,
    start_lng DOUBLE PRECISION NOT NULL,
    destination_address TEXT,
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,
    route_polyline TEXT, -- Google Encoded Polyline string
    total_distance_km DOUBLE PRECISION DEFAULT 0.0,
    total_duration_min INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rides_creator ON public.rides(creator_id);
CREATE INDEX IF NOT EXISTS idx_rides_code ON public.rides(code);
CREATE INDEX IF NOT EXISTS idx_rides_status ON public.rides(status);

-- 4. Ride Members Table
CREATE TABLE IF NOT EXISTS public.ride_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'rider' CHECK (role IN ('creator', 'admin', 'rider')),
    status TEXT NOT NULL DEFAULT 'joined' CHECK (status IN ('ready', 'joined', 'not_ready', 'left')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ride_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ride_members_ride_user ON public.ride_members(ride_id, user_id);

-- 5. Waypoints / Stops Table
CREATE TABLE IF NOT EXISTS public.waypoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN ('start', 'destination', 'tea', 'food', 'fuel', 'photo', 'hotel', 'rest', 'custom')),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    sequence INTEGER NOT NULL,
    planned_duration_min INTEGER DEFAULT 0,
    place_id TEXT, -- Google Place ID for caching
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waypoints_ride_seq ON public.waypoints(ride_id, sequence ASC);

-- 6. Dynamic Ride Pins (Dropped during ride)
CREATE TABLE IF NOT EXISTS public.ride_pins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('tea', 'fuel', 'food', 'photo', 'hotel', 'bike_problem', 'emergency', 'custom')),
    title TEXT NOT NULL,
    description TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ride_pins_ride ON public.ride_pins(ride_id);

-- 7. Ride Messages (Chat & System Events)
CREATE TABLE IF NOT EXISTS public.ride_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'action', 'system', 'emergency')),
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ride_messages_ride_created ON public.ride_messages(ride_id, created_at ASC);

-- 8. Persisted Sampled Breadcrumbs (For Trip Summary & Replay)
-- Note: Live real-time location is streamed via Supabase Realtime Broadcast Channels (WebSocket)
-- Only periodic downsampled checkpoints are stored here.
CREATE TABLE IF NOT EXISTS public.ride_history_samples (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_samples_ride_time ON public.ride_history_samples(ride_id, recorded_at ASC);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_history_samples ENABLE ROW LEVEL SECURITY;

-- Security helper: Check if user is a member or creator of a ride
CREATE OR REPLACE FUNCTION public.is_ride_member(_ride_id UUID, _user_id UUID)
RETURNS BOOLEAN SECURITY DEFINER STABLE AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.ride_members
        WHERE ride_id = _ride_id AND user_id = _user_id
    ) OR EXISTS (
        SELECT 1 FROM public.rides
        WHERE id = _ride_id AND creator_id = _user_id
    );
END;
$$ LANGUAGE plpgsql;

-- 1. Profiles
CREATE POLICY "Profiles are viewable by all authenticated users"
ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- 2. Rides
CREATE POLICY "Rides are viewable by members or code lookup"
ON public.rides FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create rides"
ON public.rides FOR INSERT TO authenticated WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creators can update their rides"
ON public.rides FOR UPDATE TO authenticated USING (creator_id = auth.uid());

-- 3. Ride Members
CREATE POLICY "Members viewable by ride members"
ON public.ride_members FOR SELECT TO authenticated USING (public.is_ride_member(ride_id, auth.uid()));

CREATE POLICY "Users can join rides"
ON public.ride_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own membership status"
ON public.ride_members FOR UPDATE TO authenticated USING (
    user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.rides WHERE id = ride_id AND creator_id = auth.uid()
    )
);

-- 4. Waypoints
CREATE POLICY "Waypoints viewable by ride participants"
ON public.waypoints FOR SELECT TO authenticated USING (public.is_ride_member(ride_id, auth.uid()));

CREATE POLICY "Waypoints editable by creator"
ON public.waypoints FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND creator_id = auth.uid())
);

-- 5. Ride Pins
CREATE POLICY "Ride pins viewable by ride members"
ON public.ride_pins FOR SELECT TO authenticated USING (public.is_ride_member(ride_id, auth.uid()));

CREATE POLICY "Members can drop pins"
ON public.ride_pins FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND public.is_ride_member(ride_id, auth.uid())
);

-- 6. Ride Messages
CREATE POLICY "Messages viewable by members"
ON public.ride_messages FOR SELECT TO authenticated USING (public.is_ride_member(ride_id, auth.uid()));

CREATE POLICY "Messages insertable by members"
ON public.ride_messages FOR INSERT TO authenticated WITH CHECK (
    (user_id = auth.uid() OR user_id IS NULL) AND public.is_ride_member(ride_id, auth.uid())
);

-- 7. Ride History Samples
CREATE POLICY "History samples viewable by members"
ON public.ride_history_samples FOR SELECT TO authenticated USING (public.is_ride_member(ride_id, auth.uid()));

CREATE POLICY "Members can insert their own history samples"
ON public.ride_history_samples FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND public.is_ride_member(ride_id, auth.uid())
);

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:ridesync/core/theme/cockpit_theme.dart';
import 'package:ridesync/features/tracking/bloc/tracking_bloc.dart';
import 'package:ridesync/features/tracking/services/realtime_telemetry_service.dart';
import 'package:ridesync/features/rides/presentation/screens/ride_lobby_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Safe Supabase client fallback
  late final SupabaseClient supabaseClient;
  try {
    supabaseClient = Supabase.instance.client;
  } catch (e) {
    // If Supabase not initialized, mock client for standalone mode
    supabaseClient = SupabaseClient('https://dummy.supabase.co', 'dummy-key');
  }

  runApp(RideSyncApp(supabaseClient: supabaseClient));
}

class RideSyncApp extends StatelessWidget {
  final SupabaseClient supabaseClient;

  const RideSyncApp({
    Key? key,
    required this.supabaseClient,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<TrackingBloc>(
          create: (context) => TrackingBloc(
            telemetryService: RealtimeTelemetryService(supabase: supabaseClient),
          ),
        ),
      ],
      child: MaterialApp(
        title: 'RideSync - Motorcycle Group Riding',
        debugShowCheckedModeBanner: false,
        theme: CockpitTheme.theme,
        home: const RideLobbyScreen(),
      ),
    );
  }
}

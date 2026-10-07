import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ridesync/core/theme/cockpit_theme.dart';
import 'package:ridesync/shared/models/rider_telemetry.dart';
import 'package:ridesync/features/tracking/bloc/tracking_bloc.dart';
import 'package:ridesync/features/tracking/bloc/tracking_event.dart';
import 'package:ridesync/features/tracking/presentation/screens/cockpit_screen.dart';

class RideLobbyScreen extends StatefulWidget {
  const RideLobbyScreen({Key? key}) : super(key: key);

  @override
  State<RideLobbyScreen> createState() => _RideLobbyScreenState();
}

class _RideLobbyScreenState extends State<RideLobbyScreen> {
  final _codeController = TextEditingController(text: 'KODAI26');
  final _riderNameController = TextEditingController(text: 'Bose (Lead)');
  final _bikeController = TextEditingController(text: 'KTM 390 Adventure');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('RIDESYNC LOBBY'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Banner Card
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [CockpitTheme.surfaceColor, Color(0xFF2D3748)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: CockpitTheme.primaryAmber.withOpacity(0.5)),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: const BoxDecoration(
                      color: CockpitTheme.primaryAmber,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.two_wheeler, color: Colors.black, size: 32),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Text(
                          'PAYANAM COCKPIT',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: CockpitTheme.primaryAmber,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Join active convoy, track telemetry & formation live.',
                          style: TextStyle(fontSize: 13, color: CockpitTheme.textMuted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            const Text(
              'RIDER INFORMATION',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: CockpitTheme.primaryAmber,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _riderNameController,
              decoration: InputDecoration(
                labelText: 'Rider Name',
                prefixIcon: const Icon(Icons.person_outline, color: CockpitTheme.primaryAmber),
                filled: true,
                fillColor: CockpitTheme.surfaceColor,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: CockpitTheme.surfaceLight),
                ),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _bikeController,
              decoration: InputDecoration(
                labelText: 'Motorcycle Model',
                prefixIcon: const Icon(Icons.two_wheeler, color: CockpitTheme.primaryAmber),
                filled: true,
                fillColor: CockpitTheme.surfaceColor,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: CockpitTheme.surfaceLight),
                ),
              ),
            ),
            const SizedBox(height: 28),

            const Text(
              'JOIN GROUP RIDE LOBBY',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: CockpitTheme.primaryAmber,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _codeController,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                labelText: '6-Digit Ride Code',
                hintText: 'e.g. KODAI26',
                prefixIcon: const Icon(Icons.qr_code_scanner, color: CockpitTheme.primaryAmber),
                filled: true,
                fillColor: CockpitTheme.surfaceColor,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: CockpitTheme.surfaceLight),
                ),
              ),
            ),
            const SizedBox(height: 28),

            ElevatedButton.icon(
              icon: const Icon(Icons.navigation_outlined),
              label: const Text('ENTER CONVOY COCKPIT'),
              onPressed: () {
                final rideCode = _codeController.text.trim().toUpperCase();
                if (rideCode.isEmpty) return;

                final initialTelemetry = RiderTelemetry(
                  userId: 'user_${DateTime.now().millisecondsSinceEpoch}',
                  name: _riderNameController.text.trim(),
                  bikeModel: _bikeController.text.trim(),
                  latitude: 10.2381,
                  longitude: 77.4892,
                  speedKmh: 45.0,
                  heading: 180.0,
                  accuracy: 8.0,
                  status: RiderStatus.riding,
                  batteryLevel: 92,
                  timestamp: DateTime.now(),
                );

                context.read<TrackingBloc>().add(
                      StartRideTracking(
                        rideId: rideCode,
                        initialTelemetry: initialTelemetry,
                      ),
                    );

                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => CockpitScreen(
                      rideId: rideCode,
                      rideTitle: 'Kodaikanal Ghat Run',
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

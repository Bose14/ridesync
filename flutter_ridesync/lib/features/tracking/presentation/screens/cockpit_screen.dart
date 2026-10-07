import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ridesync/core/theme/cockpit_theme.dart';
import 'package:ridesync/features/tracking/bloc/tracking_bloc.dart';
import 'package:ridesync/features/tracking/bloc/tracking_event.dart';
import 'package:ridesync/features/tracking/bloc/tracking_state.dart';
import 'package:ridesync/features/tracking/presentation/widgets/speedometer_hud.dart';
import 'package:ridesync/features/tracking/presentation/widgets/glove_quick_actions_bar.dart';
import 'package:ridesync/features/tracking/presentation/widgets/rider_roster_sheet.dart';

class CockpitScreen extends StatefulWidget {
  final String rideId;
  final String rideTitle;

  const CockpitScreen({
    Key? key,
    required this.rideId,
    required this.rideTitle,
  }) : super(key: key);

  @override
  State<CockpitScreen> createState() => _CockpitScreenState();
}

class _CockpitScreenState extends State<CockpitScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            Text(widget.rideTitle.toUpperCase()),
            Text(
              'RIDE CODE: ${widget.rideId}',
              style: const TextStyle(fontSize: 11, color: CockpitTheme.primaryAmber),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.people_outline, color: CockpitTheme.primaryAmber),
            onPressed: () {
              final state = context.read<TrackingBloc>().state;
              showModalBottomSheet(
                context: context,
                backgroundColor: Colors.transparent,
                isScrollControlled: true,
                builder: (_) => RiderRosterSheet(riders: state.activeRiders),
              );
            },
          ),
        ],
      ),
      body: BlocConsumer<TrackingBloc, TrackingState>(
        listener: (context, state) {
          if (state.lastQuickPinAlert != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.lastQuickPinAlert!),
                backgroundColor: CockpitTheme.surfaceLight,
                duration: const Duration(seconds: 4),
              ),
            );
          }
        },
        builder: (context, state) {
          return Stack(
            children: [
              // 1. Simulated Map Visual Area
              Container(
                width: double.infinity,
                height: double.infinity,
                decoration: const BoxDecoration(
                  color: Color(0xFF090D16),
                ),
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.map_outlined,
                        size: 72,
                        color: CockpitTheme.surfaceLight.withOpacity(0.5),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'LIVE CONVOY MAP ACTIVE',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: CockpitTheme.textMuted.withOpacity(0.7),
                          letterSpacing: 2,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${state.activeRiders.length} Riders Connected Telemetry Stream',
                        style: const TextStyle(
                          fontSize: 13,
                          color: CockpitTheme.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // 2. Alert Notification Banners
              Positioned(
                top: 16,
                left: 16,
                right: 16,
                child: Column(
                  children: [
                    if (state.separationAlerts.isNotEmpty) ...[
                      for (final alert in state.separationAlerts)
                        Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          decoration: BoxDecoration(
                            color: CockpitTheme.dangerRed.withOpacity(0.9),
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: const [
                              BoxShadow(color: Colors.black45, blurRadius: 8)
                            ],
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.warning_amber, color: Colors.white),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'SEPARATION ALERT: ${alert.riderName} is ${alert.distanceBehindKm.toStringAsFixed(1)} KM behind formation!',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                    if (state.deviationAlert != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        decoration: BoxDecoration(
                          color: CockpitTheme.warningYellow.withOpacity(0.9),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.navigation, color: Colors.black),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'DEVIATION: Off-route by ${state.deviationAlert!.distanceOffRouteMeters.toStringAsFixed(0)} meters!',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: Colors.black,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),

              // 3. Telemetry Speedometer HUD
              Positioned(
                top: 100,
                left: 16,
                right: 16,
                child: SpeedometerHUD(
                  telemetry: state.myTelemetry,
                  activeRidersCount: state.activeRiders.length,
                  isInFormation: state.isInFormation,
                ),
              ),

              // 4. Glove-Friendly Quick Actions Bar
              Positioned(
                bottom: 24,
                left: 16,
                right: 16,
                child: GloveQuickActionsBar(
                  onQuickPin: (type, msg) {
                    context.read<TrackingBloc>().add(
                          SendQuickActionPin(pinType: type, message: msg),
                        );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

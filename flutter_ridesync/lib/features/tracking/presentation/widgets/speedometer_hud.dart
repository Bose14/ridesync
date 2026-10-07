import 'package:flutter/material.dart';
import 'package:ridesync/core/theme/cockpit_theme.dart';
import 'package:ridesync/shared/models/rider_telemetry.dart';

class SpeedometerHUD extends StatelessWidget {
  final RiderTelemetry? telemetry;
  final int activeRidersCount;
  final bool isInFormation;

  const SpeedometerHUD({
    Key? key,
    required this.telemetry,
    required this.activeRidersCount,
    required this.isInFormation,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final speed = telemetry?.speedKmh.toStringAsFixed(0) ?? '0';
    final heading = telemetry?.heading.toStringAsFixed(0) ?? '0';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      decoration: BoxDecoration(
        color: CockpitTheme.surfaceColor.withOpacity(0.92),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isInFormation ? CockpitTheme.primaryAmber.withOpacity(0.4) : CockpitTheme.dangerRed,
          width: 2,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.5),
            blurRadius: 12,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Speed Display
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                speed,
                style: const TextStyle(
                  fontSize: 42,
                  fontWeight: FontWeight.w900,
                  color: CockpitTheme.primaryAmber,
                  letterSpacing: -1,
                ),
              ),
              const SizedBox(width: 4),
              const Text(
                'KM/H',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: CockpitTheme.textMuted,
                ),
              ),
            ],
          ),

          // Heading & Formation Indicator
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: isInFormation
                      ? CockpitTheme.successGreen.withOpacity(0.2)
                      : CockpitTheme.dangerRed.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: isInFormation ? CockpitTheme.successGreen : CockpitTheme.dangerRed,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      isInFormation ? Icons.shield_outlined : Icons.warning_amber_rounded,
                      size: 14,
                      color: isInFormation ? CockpitTheme.successGreen : CockpitTheme.dangerRed,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      isInFormation ? 'IN FORMATION' : 'GAP DETECTED',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: isInFormation ? CockpitTheme.successGreen : CockpitTheme.dangerRed,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'HEADING $heading°',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: CockpitTheme.textMuted,
                ),
              ),
            ],
          ),

          // Active Convoy Count
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: CockpitTheme.surfaceLight,
              shape: BoxShape.circle,
            ),
            child: Row(
              children: [
                const Icon(Icons.two_wheeler, color: CockpitTheme.primaryAmber, size: 20),
                const SizedBox(width: 4),
                Text(
                  '$activeRidersCount',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: CockpitTheme.textBright,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

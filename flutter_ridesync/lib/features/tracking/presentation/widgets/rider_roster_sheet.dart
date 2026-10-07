import 'package:flutter/material.dart';
import 'package:ridesync/core/theme/cockpit_theme.dart';
import 'package:ridesync/shared/models/rider_telemetry.dart';
import 'package:url_launcher/url_launcher.dart';

class RiderRosterSheet extends StatelessWidget {
  final List<RiderTelemetry> riders;
  final String? leadUserId;

  const RiderRosterSheet({
    Key? key,
    required this.riders,
    this.leadUserId,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: CockpitTheme.surfaceColor,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'CONVOY ROSTER (${riders.length})',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: CockpitTheme.primaryAmber,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close, color: CockpitTheme.textMuted),
                onPressed: () => Navigator.pop(context),
              )
            ],
          ),
          const Divider(color: CockpitTheme.surfaceLight),
          const SizedBox(height: 8),
          Flexible(
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: riders.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (ctx, i) {
                final rider = riders[i];
                final isLead = rider.userId == leadUserId || i == 0;
                final isEmergency = rider.status == RiderStatus.emergency;

                return Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isEmergency
                        ? CockpitTheme.dangerRed.withOpacity(0.15)
                        : CockpitTheme.darkBackground,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isEmergency
                          ? CockpitTheme.dangerRed
                          : (isLead ? CockpitTheme.primaryAmber : CockpitTheme.surfaceLight),
                    ),
                  ),
                  child: Row(
                    children: [
                      CircleAvatar(
                        backgroundColor: isLead
                            ? CockpitTheme.primaryAmber
                            : (isEmergency ? CockpitTheme.dangerRed : CockpitTheme.surfaceLight),
                        child: Text(
                          rider.name.substring(0, 1).toUpperCase(),
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: isLead ? Colors.black : Colors.white,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  rider.name,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: CockpitTheme.textBright,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                if (isLead)
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: CockpitTheme.primaryAmber.withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: const Text(
                                      'LEAD',
                                      style: TextStyle(
                                        fontSize: 9,
                                        fontWeight: FontWeight.bold,
                                        color: CockpitTheme.primaryAmber,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                            Text(
                              rider.bikeModel ?? 'Motorcycle Rider',
                              style: const TextStyle(
                                fontSize: 13,
                                color: CockpitTheme.textMuted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            '${rider.speedKmh.toStringAsFixed(0)} km/h',
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: CockpitTheme.primaryAmber,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Icon(
                                Icons.battery_charging_full,
                                size: 12,
                                color: CockpitTheme.textMuted,
                              ),
                              Text(
                                '${rider.batteryLevel ?? 85}%',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: CockpitTheme.textMuted,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

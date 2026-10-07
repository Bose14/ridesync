import 'package:flutter/material.dart';
import 'package:ridesync/core/theme/cockpit_theme.dart';

class RiderProfileScreen extends StatelessWidget {
  const RiderProfileScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('RIDER PROFILE & SOS METADATA'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            Center(
              child: Stack(
                children: [
                  CircleAvatar(
                    radius: 50,
                    backgroundColor: CockpitTheme.primaryAmber,
                    child: const Text(
                      'B',
                      style: TextStyle(fontSize: 40, fontWeight: FontWeight.bold, color: Colors.black),
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: const BoxDecoration(
                        color: CockpitTheme.successGreen,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check, size: 16, color: Colors.white),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Bose',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: CockpitTheme.textBright),
            ),
            const Text(
              '+91 98765 43210 • Lead Navigator',
              style: TextStyle(fontSize: 14, color: CockpitTheme.textMuted),
            ),
            const SizedBox(height: 24),

            // Emergency Card
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: CockpitTheme.dangerRed.withOpacity(0.12),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: CockpitTheme.dangerRed.withOpacity(0.5)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.medical_information_outlined, color: CockpitTheme.dangerRed, size: 36),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Text(
                          'BLOOD GROUP: O +ve',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: CockpitTheme.dangerRed,
                            fontSize: 15,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Emergency Contact: Vikram (Brother)\n+91 98765 00001',
                          style: TextStyle(fontSize: 12, color: CockpitTheme.textBright),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Bike Metadata Card
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  children: const [
                    ListTile(
                      leading: Icon(Icons.two_wheeler, color: CockpitTheme.primaryAmber),
                      title: Text('Motorcycle'),
                      subtitle: Text('KTM 390 Adventure'),
                    ),
                    Divider(color: CockpitTheme.surfaceLight),
                    ListTile(
                      leading: Icon(Icons.route, color: CockpitTheme.primaryAmber),
                      title: Text('Total Rides Completed'),
                      subtitle: Text('42 Group Convoy Runs (14,280 KM)'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

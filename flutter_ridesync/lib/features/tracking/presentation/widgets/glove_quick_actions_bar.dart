import 'package:flutter/material.dart';
import 'package:ridesync/core/theme/cockpit_theme.dart';

class GloveQuickActionsBar extends StatelessWidget {
  final Function(String pinType, String message) onQuickPin;

  const GloveQuickActionsBar({
    Key? key,
    required this.onQuickPin,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: CockpitTheme.surfaceColor.withOpacity(0.95),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: CockpitTheme.surfaceLight, width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.6),
            blurRadius: 16,
            offset: const Offset(0, 6),
          )
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _buildActionButton(
            label: 'TEA',
            emoji: '☕',
            color: Colors.amber,
            onTap: () => onQuickPin('tea', 'Tea/Coffee Break Requested'),
          ),
          _buildActionButton(
            label: 'FUEL',
            emoji: '⛽',
            color: Colors.orangeAccent,
            onTap: () => onQuickPin('fuel', 'Fuel Tank Low Stop'),
          ),
          _buildActionButton(
            label: 'PHOTO',
            emoji: '📸',
            color: Colors.blueAccent,
            onTap: () => onQuickPin('photo', 'Scenic Viewpoint Stop'),
          ),
          _buildActionButton(
            label: 'SOS',
            emoji: '🚨',
            color: CockpitTheme.dangerRed,
            isEmergency: true,
            onTap: () => _confirmEmergency(context),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton({
    required String label,
    required String emoji,
    required Color color,
    required VoidCallback onTap,
    bool isEmergency = false,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          color: isEmergency ? CockpitTheme.dangerRed.withOpacity(0.25) : CockpitTheme.surfaceLight,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isEmergency ? CockpitTheme.dangerRed : color.withOpacity(0.6),
            width: 2,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              emoji,
              style: const TextStyle(fontSize: 26),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w900,
                color: isEmergency ? CockpitTheme.dangerRed : CockpitTheme.textBright,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmEmergency(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: CockpitTheme.surfaceColor,
        title: Row(
          children: const [
            Icon(Icons.warning, color: CockpitTheme.dangerRed, size: 28),
            SizedBox(width: 8),
            Text('TRIGGER SOS ALERT?'),
          ],
        ),
        content: const Text(
          'This will broadcast an urgent emergency alert to all riders in the convoy with your precise GPS coordinates.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('CANCEL'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: CockpitTheme.dangerRed),
            onPressed: () {
              Navigator.pop(ctx);
              onQuickPin('sos', 'EMERGENCY SOS BROADCAST');
            },
            child: const Text('BROADCAST SOS NOW', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }
}

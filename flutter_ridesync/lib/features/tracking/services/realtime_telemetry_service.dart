import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:ridesync/shared/models/rider_telemetry.dart';

class RealtimeTelemetryService {
  final SupabaseClient supabase;
  final String localWsUrl;
  final String localBatchUrl;
  
  RealtimeChannel? _telemetryChannel;
  WebSocket? _socket;
  String? _activeRideId;
  
  final List<RiderTelemetry> _offlineBuffer = [];
  final StreamController<RiderTelemetry> _peerStreamController =
      StreamController<RiderTelemetry>.broadcast();

  Stream<RiderTelemetry> get peerTelemetryStream => _peerStreamController.stream;

  RealtimeTelemetryService({
    required this.supabase,
    this.localWsUrl = 'ws://localhost:5000/ws',
    this.localBatchUrl = 'http://localhost:5000/api/telemetry/batch',
  });

  /// Connect to the ride's ephemeral channel for high-frequency location sharing
  Future<void> joinRideChannel(String rideId, RiderTelemetry initialTelemetry) async {
    await leaveRideChannel();
    _activeRideId = rideId;

    // 1. Try Supabase Realtime channel first
    try {
      final channelName = 'ride:telemetry:$rideId';
      _telemetryChannel = supabase.channel(channelName);

      _telemetryChannel!.onBroadcast(
        event: 'location_update',
        callback: (payload) {
          try {
            final telemetry = RiderTelemetry.fromJson(payload);
            _peerStreamController.add(telemetry);
          } catch (e) {
            // Ignore malformed broadcast packets
          }
        },
      );

      await _telemetryChannel!.subscribe();
      await _telemetryChannel!.track({
        'user_id': initialTelemetry.userId,
        'name': initialTelemetry.name,
        'online_at': DateTime.now().toIso8601String(),
      });
    } catch (e) {
      // Fallback to local native WebSocket server
      await _connectLocalWs(rideId);
    }
  }

  Future<void> _connectLocalWs(String rideId) async {
    try {
      _socket = await WebSocket.connect(localWsUrl).timeout(const Duration(seconds: 3));
      _socket!.listen(
        (data) {
          try {
            final msg = jsonDecode(data as String);
            if (msg['type'] == 'location_update' && msg['payload'] != null) {
              final telemetry = RiderTelemetry.fromJson(msg['payload']);
              _peerStreamController.add(telemetry);
            }
          } catch (e) {}
        },
        onError: (err) => _reconnectLocalWs(rideId),
        onDone: () => _reconnectLocalWs(rideId),
      );

      _socket!.add(jsonEncode({'type': 'subscribe', 'rideId': rideId}));
      await flushOfflineBuffer();
    } catch (e) {
      // Offline mode - packets will buffer in _offlineBuffer
    }
  }

  void _reconnectLocalWs(String rideId) {
    if (_activeRideId == rideId) {
      Future.delayed(const Duration(seconds: 5), () {
        if (_activeRideId == rideId) _connectLocalWs(rideId);
      });
    }
  }

  /// Broadcast device's current location to ride channel (zero DB write overhead)
  Future<void> broadcastLocation(RiderTelemetry telemetry) async {
    if (_telemetryChannel != null) {
      try {
        await _telemetryChannel!.sendBroadcastMessage(
          event: 'location_update',
          payload: telemetry.toJson(),
        );
        return;
      } catch (e) {}
    }

    if (_socket != null && _socket!.readyState == WebSocket.open) {
      _socket!.add(jsonEncode({
        'type': 'location_update',
        'rideId': _activeRideId,
        'payload': telemetry.toJson(),
      }));
    } else {
      // Buffer packet for dead zones offline sync
      _offlineBuffer.add(telemetry);
      if (_offlineBuffer.length > 100) {
        _offlineBuffer.removeAt(0);
      }
    }
  }

  /// Flush queued offline telemetry batch items recorded during dead zones
  Future<void> flushOfflineBuffer() async {
    if (_offlineBuffer.isEmpty || _activeRideId == null) return;

    final batchItems = List<RiderTelemetry>.from(_offlineBuffer);
    _offlineBuffer.clear();

    try {
      final response = await http.post(
        Uri.parse(localBatchUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'rideId': _activeRideId,
          'items': batchItems.map((t) => t.toJson()).toList(),
        }),
      ).timeout(const Duration(seconds: 4));

      if (response.statusCode != 200) {
        _offlineBuffer.insertAll(0, batchItems);
      }
    } catch (e) {
      _offlineBuffer.insertAll(0, batchItems);
    }
  }

  Future<void> leaveRideChannel() async {
    _activeRideId = null;
    if (_telemetryChannel != null) {
      await supabase.removeChannel(_telemetryChannel!);
      _telemetryChannel = null;
    }
    if (_socket != null) {
      await _socket!.close();
      _socket = null;
    }
  }

  void dispose() {
    leaveRideChannel();
    _peerStreamController.close();
  }
}


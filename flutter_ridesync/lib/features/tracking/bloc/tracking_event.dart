import 'package:equatable/equatable.dart';
import 'package:ridesync/shared/models/rider_telemetry.dart';

abstract class TrackingEvent extends Equatable {
  const TrackingEvent();

  @override
  List<Object?> get props => [];
}

class StartRideTracking extends TrackingEvent {
  final String rideId;
  final RiderTelemetry initialTelemetry;

  const StartRideTracking({
    required this.rideId,
    required this.initialTelemetry,
  });

  @override
  List<Object?> get props => [rideId, initialTelemetry];
}

class UpdateLocalLocation extends TrackingEvent {
  final RiderTelemetry telemetry;

  const UpdateLocalLocation(this.telemetry);

  @override
  List<Object?> get props => [telemetry];
}

class PeerLocationReceived extends TrackingEvent {
  final RiderTelemetry telemetry;

  const PeerLocationReceived(this.telemetry);

  @override
  List<Object?> get props => [telemetry];
}

class SendQuickActionPin extends TrackingEvent {
  final String pinType; // 'tea', 'fuel', 'sos', 'photo'
  final String message;

  const SendQuickActionPin({
    required this.pinType,
    required this.message,
  });

  @override
  List<Object?> get props => [pinType, message];
}

class StopRideTracking extends TrackingEvent {}

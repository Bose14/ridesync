import 'package:equatable/equatable.dart';
import 'package:ridesync/shared/models/rider_telemetry.dart';
import 'package:ridesync/features/tracking/algorithms/separation_detector.dart';
import 'package:ridesync/features/tracking/algorithms/route_deviation_detector.dart';

enum TrackingStatus { initial, active, paused, error }

class TrackingState extends Equatable {
  final TrackingStatus status;
  final String? activeRideId;
  final RiderTelemetry? myTelemetry;
  final List<RiderTelemetry> activeRiders;
  final List<SeparationAlert> separationAlerts;
  final DeviationAlert? deviationAlert;
  final String? lastQuickPinAlert;
  final List<List<double>> routePolyline;

  const TrackingState({
    this.status = TrackingStatus.initial,
    this.activeRideId,
    this.myTelemetry,
    this.activeRiders = const [],
    this.separationAlerts = const [],
    this.deviationAlert,
    this.lastQuickPinAlert,
    this.routePolyline = const [],
  });

  bool get isInFormation => separationAlerts.isEmpty && deviationAlert == null;
  bool get hasEmergency => activeRiders.any((r) => r.status == RiderStatus.emergency);

  TrackingState copyWith({
    TrackingStatus? status,
    String? activeRideId,
    RiderTelemetry? myTelemetry,
    List<RiderTelemetry>? activeRiders,
    List<SeparationAlert>? separationAlerts,
    DeviationAlert? deviationAlert,
    String? lastQuickPinAlert,
    List<List<double>>? routePolyline,
  }) {
    return TrackingState(
      status: status ?? this.status,
      activeRideId: activeRideId ?? this.activeRideId,
      myTelemetry: myTelemetry ?? this.myTelemetry,
      activeRiders: activeRiders ?? this.activeRiders,
      separationAlerts: separationAlerts ?? this.separationAlerts,
      deviationAlert: deviationAlert ?? this.deviationAlert,
      lastQuickPinAlert: lastQuickPinAlert ?? this.lastQuickPinAlert,
      routePolyline: routePolyline ?? this.routePolyline,
    );
  }

  @override
  List<Object?> get props => [
        status,
        activeRideId,
        myTelemetry,
        activeRiders,
        separationAlerts,
        deviationAlert,
        lastQuickPinAlert,
        routePolyline,
      ];
}

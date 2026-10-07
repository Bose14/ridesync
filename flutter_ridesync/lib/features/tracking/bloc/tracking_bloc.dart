import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ridesync/shared/models/rider_telemetry.dart';
import 'package:ridesync/features/tracking/services/realtime_telemetry_service.dart';
import 'package:ridesync/features/tracking/algorithms/separation_detector.dart';
import 'package:ridesync/features/tracking/algorithms/route_deviation_detector.dart';
import 'tracking_event.dart';
import 'tracking_state.dart';

class TrackingBloc extends Bloc<TrackingEvent, TrackingState> {
  final RealtimeTelemetryService telemetryService;
  final SeparationDetector separationDetector;
  final RouteDeviationDetector deviationDetector;

  StreamSubscription<RiderTelemetry>? _peerSubscription;

  TrackingBloc({
    required this.telemetryService,
    SeparationDetector? separationDetector,
    RouteDeviationDetector? deviationDetector,
  })  : separationDetector = separationDetector ?? SeparationDetector(),
        deviationDetector = deviationDetector ?? RouteDeviationDetector(),
        super(const TrackingState()) {
    on<StartRideTracking>(_onStartRideTracking);
    on<UpdateLocalLocation>(_onUpdateLocalLocation);
    on<PeerLocationReceived>(_onPeerLocationReceived);
    on<SendQuickActionPin>(_onSendQuickActionPin);
    on<StopRideTracking>(_onStopRideTracking);
  }

  Future<void> _onStartRideTracking(
    StartRideTracking event,
    Emitter<TrackingState> emit,
  ) async {
    emit(state.copyWith(
      status: TrackingStatus.active,
      activeRideId: event.rideId,
      myTelemetry: event.initialTelemetry,
      activeRiders: [event.initialTelemetry],
    ));

    await telemetryService.joinRideChannel(event.rideId, event.initialTelemetry);

    _peerSubscription?.cancel();
    _peerSubscription = telemetryService.peerTelemetryStream.listen((telemetry) {
      add(PeerLocationReceived(telemetry));
    });
  }

  void _onUpdateLocalLocation(
    UpdateLocalLocation event,
    Emitter<TrackingState> emit,
  ) {
    final updatedList = _updateRiderInList(state.activeRiders, event.telemetry);
    telemetryService.broadcastLocation(event.telemetry);

    final alerts = separationDetector.evaluateSeparation(updatedList);
    final devAlert = deviationDetector.evaluateRider(
      event.telemetry.userId,
      event.telemetry.name,
      event.telemetry.latitude,
      event.telemetry.longitude,
      event.telemetry.accuracy,
      state.routePolyline,
    );

    emit(state.copyWith(
      myTelemetry: event.telemetry,
      activeRiders: updatedList,
      separationAlerts: alerts,
      deviationAlert: devAlert,
    ));
  }

  void _onPeerLocationReceived(
    PeerLocationReceived event,
    Emitter<TrackingState> emit,
  ) {
    final updatedList = _updateRiderInList(state.activeRiders, event.telemetry);
    final alerts = separationDetector.evaluateSeparation(updatedList);

    emit(state.copyWith(
      activeRiders: updatedList,
      separationAlerts: alerts,
    ));
  }

  void _onSendQuickActionPin(
    SendQuickActionPin event,
    Emitter<TrackingState> emit,
  ) {
    if (state.myTelemetry == null) return;

    final updatedTelemetry = state.myTelemetry!.copyWith(
      status: event.pinType == 'sos' ? RiderStatus.emergency : RiderStatus.stopped,
    );

    add(UpdateLocalLocation(updatedTelemetry));

    final pinLabel = event.pinType.toUpperCase();
    emit(state.copyWith(
      lastQuickPinAlert: '[$pinLabel] ${event.message} - ${state.myTelemetry!.name}',
    ));
  }

  Future<void> _onStopRideTracking(
    StopRideTracking event,
    Emitter<TrackingState> emit,
  ) async {
    _peerSubscription?.cancel();
    await telemetryService.leaveRideChannel();
    separationDetector.reset();
    deviationDetector.reset();

    emit(const TrackingState(status: TrackingStatus.initial));
  }

  List<RiderTelemetry> _updateRiderInList(
    List<RiderTelemetry> current,
    RiderTelemetry incoming,
  ) {
    final index = current.indexWhere((r) => r.userId == incoming.userId);
    final list = List<RiderTelemetry>.from(current);
    if (index >= 0) {
      list[index] = incoming;
    } else {
      list.add(incoming);
    }
    return list;
  }

  @override
  Future<void> close() {
    _peerSubscription?.cancel();
    return super.close();
  }
}

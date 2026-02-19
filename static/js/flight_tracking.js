(function attachFlightTracker(global) {
    function normalizeIcao(value) {
        const code = String(value || '').trim().toUpperCase();
        return /^[A-Z]{4}$/.test(code) ? code : '';
    }

    function normalizeCallsign(value) {
        return String(value || '').trim().toUpperCase();
    }

    function nowMs() {
        return Date.now();
    }

    class FlightTracker {
        constructor(options) {
            const opts = options || {};
            this.storageKey = opts.storageKey || 'flightboard.tracked_callsign';
            this.switchCooldownMs = Number(opts.switchCooldownMs || 6000);
            this.manualHoldMs = Number(opts.manualHoldMs || 15000);
            this.onSwitchAirport = typeof opts.onSwitchAirport === 'function' ? opts.onSwitchAirport : null;
            this.onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : null;

            this.trackedCallsign = '';
            this.lastKnownFrom = '';
            this.lastKnownTo = '';
            this.lastKnownMessage = '';

            this.lastSwitchAt = 0;
            this.lastSwitchedLegKey = '';
            this.manualHoldUntil = 0;
            this.pendingSwitchTo = '';
        }

        init() {
            try {
                this.trackedCallsign = normalizeCallsign(localStorage.getItem(this.storageKey));
            } catch (e) {
                this.trackedCallsign = '';
            }
            this.notify();
        }

        isTrackedCallsign(callsign) {
            return normalizeCallsign(callsign) && normalizeCallsign(callsign) === this.trackedCallsign;
        }

        clearTracking() {
            this.trackedCallsign = '';
            this.lastKnownFrom = '';
            this.lastKnownTo = '';
            this.lastKnownMessage = '';
            this.pendingSwitchTo = '';
            this.lastSwitchedLegKey = '';
            this.persist();
            this.notify();
        }

        toggleTracking(flight) {
            const callsign = normalizeCallsign(flight && flight.callsign);
            if (!callsign) return false;

            if (callsign === this.trackedCallsign) {
                this.clearTracking();
                return false;
            }

            this.trackedCallsign = callsign;
            this.lastKnownFrom = normalizeIcao(flight && flight.origin);
            this.lastKnownTo = normalizeIcao(flight && flight.destination);
            this.lastKnownMessage = '';
            this.pendingSwitchTo = '';
            this.lastSwitchedLegKey = '';
            this.persist();
            this.notify();
            return true;
        }

        onAirportChanged(source) {
            if (source === 'manual') {
                this.manualHoldUntil = nowMs() + this.manualHoldMs;
            }
        }

        resolveTrackedFlight(data) {
            if (!this.trackedCallsign || !data) return null;

            const all = [];
            const departures = Array.isArray(data.departures) ? data.departures : [];
            const arrivals = Array.isArray(data.arrivals) ? data.arrivals : [];

            departures.forEach(f => all.push({ type: 'dep', flight: f }));
            arrivals.forEach(f => all.push({ type: 'arr', flight: f }));

            const matches = all.filter(item => normalizeCallsign(item.flight && item.flight.callsign) === this.trackedCallsign);
            if (!matches.length) return null;

            const statusPriority = {
                Boarding: 100,
                'Check-in': 95,
                Pushback: 90,
                Taxiing: 85,
                Departing: 80,
                'En Route': 70,
                Approaching: 60,
                Landing: 55,
                Landed: 50,
                'At Gate': 45,
                Scheduled: 40,
                Cancelled: 1
            };

            matches.sort((a, b) => {
                const aDest = normalizeIcao(a.flight && a.flight.destination) ? 1 : 0;
                const bDest = normalizeIcao(b.flight && b.flight.destination) ? 1 : 0;
                if (bDest !== aDest) return bDest - aDest;

                const ap = statusPriority[String(a.flight && a.flight.status) || ''] || 0;
                const bp = statusPriority[String(b.flight && b.flight.status) || ''] || 0;
                if (bp !== ap) return bp - ap;

                return a.type === 'dep' ? -1 : 1;
            });

            return matches[0].flight;
        }

        isEligibleForAutoSwitch(statusValue) {
            const status = String(statusValue || '').trim();
            return [
                'Departing',
                'En Route',
                'Approaching',
                'Landing',
                'Landed',
                'At Gate'
            ].includes(status);
        }

        processFlightData(data, currentAirport) {
            if (!this.trackedCallsign) return;

            const tracked = this.resolveTrackedFlight(data);
            if (!tracked) {
                this.lastKnownMessage = 'awaiting live updates';
                this.notify();
                return;
            }

            const fromIcao = normalizeIcao(tracked.origin) || this.lastKnownFrom;
            const toIcao = normalizeIcao(tracked.destination);
            this.lastKnownFrom = fromIcao;

            if (!toIcao) {
                this.lastKnownMessage = 'destination ICAO unavailable';
                this.notify();
                return;
            }

            this.lastKnownTo = toIcao;
            if (!this.isEligibleForAutoSwitch(tracked.status)) {
                this.lastKnownMessage = 'waiting for departure';
                this.notify();
                return;
            }

            this.lastKnownMessage = '';
            this.notify();

            const current = normalizeIcao(currentAirport);
            if (!current || toIcao === current) return;
            if (!this.onSwitchAirport) return;
            if (nowMs() < this.manualHoldUntil) return;
            if (this.pendingSwitchTo === toIcao) return;

            const legKey = `${this.trackedCallsign}|${toIcao}`;
            if (this.lastSwitchedLegKey === legKey) return;
            if ((nowMs() - this.lastSwitchAt) < this.switchCooldownMs) return;

            this.pendingSwitchTo = toIcao;
            Promise.resolve(this.onSwitchAirport(toIcao))
                .then((didSwitch) => {
                    if (didSwitch) {
                        this.lastSwitchAt = nowMs();
                        this.lastSwitchedLegKey = legKey;
                    }
                })
                .finally(() => {
                    this.pendingSwitchTo = '';
                });
        }

        getViewState() {
            if (!this.trackedCallsign) {
                return {
                    enabled: false,
                    callsign: '',
                    from: '',
                    to: '',
                    message: ''
                };
            }

            return {
                enabled: true,
                callsign: this.trackedCallsign,
                from: this.lastKnownFrom,
                to: this.lastKnownTo,
                message: this.lastKnownMessage
            };
        }

        persist() {
            try {
                if (!this.trackedCallsign) {
                    localStorage.removeItem(this.storageKey);
                } else {
                    localStorage.setItem(this.storageKey, this.trackedCallsign);
                }
            } catch (e) {
                // Ignore storage failures
            }
        }

        notify() {
            if (this.onStateChange) {
                this.onStateChange(this.getViewState());
            }
        }
    }

    global.FlightTracker = FlightTracker;
})(window);

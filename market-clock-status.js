// Calendar and regular cash-equity status logic shared with jimfund.com.
export function createMarketStatus(calendar) {
    const weekdayFormatterCache = new Map();
    const partsFormatterCache = new Map();
    const timeFormatterCache = new Map();
    const calendarData = calendar;
    function formatter(cache, timeZone, options) {
        if (!cache.has(timeZone)) {
            cache.set(timeZone, new Intl.DateTimeFormat("en-US", {
                timeZone,
                ...options,
            }));
        }
        return cache.get(timeZone);
    }

    function zonedParts(date, timeZone) {
        const parts = formatter(partsFormatterCache, timeZone, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        }).formatToParts(date);
        return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    }

    function weekday(date, timeZone) {
        return formatter(weekdayFormatterCache, timeZone, {
            weekday: "short",
        }).format(date);
    }

    function marketTime(date, timeZone) {
        return formatter(timeFormatterCache, timeZone, {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).format(date);
    }

    function isWeekday(date, timeZone) {
        return !["Sat", "Sun"].includes(weekday(date, timeZone));
    }

    function dateKey(date, timeZone) {
        const parts = zonedParts(date, timeZone);
        return [
            parts.year,
            String(parts.month).padStart(2, "0"),
            String(parts.day).padStart(2, "0"),
        ].join("-");
    }

    function parseClockTime(value) {
        const match = /^(\d{2}):(\d{2})$/.exec(value || "");
        if (!match) {
            throw new Error(`Invalid market session time: ${value}`);
        }
        return { hour: Number(match[1]), minute: Number(match[2]) };
    }

    function normalizeMarket(key, source) {
        if (!source || !Array.isArray(source.sessions) || source.sessions.length === 0) {
            throw new Error(`Market calendar is missing ${key} sessions`);
        }
        return {
            key,
            label: source.label || key,
            clockLabel: source.clock_label || key,
            timeZone: source.time_zone,
            sessionScope: source.session_scope || "cash equities",
            confirmedThrough: source.confirmed_through,
            sessions: source.sessions.map((session) => ({
                open: parseClockTime(session.open),
                close: parseClockTime(session.close),
            })),
            closures: source.closures || {},
            earlyCloses: source.early_closes || {},
        };
    }

    function scheduleConfidence(market, date) {
        const key = dateKey(date, market.timeZone);
        if (!calendarData || key < calendarData.valid_from || key > calendarData.valid_through) {
            return "unknown";
        }
        return key <= market.confirmedThrough ? "confirmed" : "projected";
    }

    function isMarketHoliday(market, date) {
        return Object.prototype.hasOwnProperty.call(market.closures, dateKey(date, market.timeZone));
    }

    function closedDayReason(market, date) {
        const key = dateKey(date, market.timeZone);
        if (scheduleConfidence(market, date) === "unknown") {
            return "Schedule unknown";
        }
        if (isMarketHoliday(market, date)) {
            return market.closures[key] || "Holiday";
        }
        if (!isWeekday(date, market.timeZone)) {
            return "Weekend";
        }
        return "";
    }

    function zonedTimeToDate(timeZone, year, month, day, hour, minute) {
        const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
        const actual = zonedParts(guess, timeZone);
        const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
        const actualUtc = Date.UTC(
            actual.year,
            actual.month - 1,
            actual.day,
            actual.hour,
            actual.minute,
            actual.second || 0,
        );
        return new Date(guess.getTime() + desiredUtc - actualUtc);
    }

    function addZonedDays(date, timeZone, days) {
        const parts = zonedParts(date, timeZone);
        const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
        const shiftedParts = zonedParts(shifted, timeZone);
        return zonedTimeToDate(timeZone, shiftedParts.year, shiftedParts.month, shiftedParts.day, 0, 0);
    }

    function sessionsForDate(market, date) {
        if (scheduleConfidence(market, date) === "unknown" || !isWeekday(date, market.timeZone) || isMarketHoliday(market, date)) {
            return [];
        }

        const parts = zonedParts(date, market.timeZone);
        const special = market.earlyCloses[dateKey(date, market.timeZone)];
        const specialClose = special ? parseClockTime(special.close) : null;
        const specialCloseDate = specialClose
            ? zonedTimeToDate(market.timeZone, parts.year, parts.month, parts.day, specialClose.hour, specialClose.minute)
            : null;

        return market.sessions.map((session) => {
            const open = zonedTimeToDate(
                market.timeZone, parts.year, parts.month, parts.day, session.open.hour, session.open.minute,
            );
            const normalClose = zonedTimeToDate(
                market.timeZone, parts.year, parts.month, parts.day, session.close.hour, session.close.minute,
            );
            const close = specialCloseDate && specialCloseDate < normalClose ? specialCloseDate : normalClose;
            return {
                open,
                close,
                isEarlyClose: Boolean(specialCloseDate && close.getTime() === specialCloseDate.getTime()),
                earlyCloseReason: special ? special.reason : "",
            };
        }).filter((session) => session.open < session.close);
    }

    function nextOpen(market, now) {
        for (let dayOffset = 0; dayOffset < 32; dayOffset += 1) {
            const candidate = dayOffset === 0 ? now : addZonedDays(now, market.timeZone, dayOffset);
            if (scheduleConfidence(market, candidate) === "unknown") {
                return null;
            }
            const upcoming = sessionsForDate(market, candidate).find((session) => session.open > now);
            if (upcoming) {
                return upcoming.open;
            }
        }
        return null;
    }

    function formatDuration(milliseconds) {
        const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function formatCompactDuration(milliseconds) {
        const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0) return `${days}d`;
        if (hours > 0) return `${hours}h`;
        return `${minutes}m`;
    }

    function marketStatus(market, now) {
        const confidence = scheduleConfidence(market, now);
        if (confidence === "unknown") {
            return {
                isOpen: false,
                phase: "unknown",
                confidence,
                text: "Schedule unknown",
                compactText: "Unknown",
                eventTime: null,
            };
        }

        const todaySessions = sessionsForDate(market, now);
        const openSession = todaySessions.find((session) => now >= session.open && now < session.close);
        const qualifier = confidence === "projected" ? "?" : "";
        if (openSession) {
            const closeText = openSession.isEarlyClose ? "early close" : "close";
            return {
                isOpen: true,
                phase: "open",
                confidence,
                text: `Open${qualifier} - ${closeText} in ${formatDuration(openSession.close - now)}`,
                compactText: `Open${qualifier} ${formatCompactDuration(openSession.close - now)}`,
                eventTime: openSession.close,
            };
        }

        const next = nextOpen(market, now);
        const reason = closedDayReason(market, now);
        const isBreak = todaySessions.some((session) => session.close <= now)
            && todaySessions.some((session) => session.open > now);
        if (isBreak && next) {
            return {
                isOpen: false,
                phase: "break",
                confidence,
                text: `Break${qualifier} - reopen in ${formatDuration(next - now)}`,
                compactText: `Break${qualifier} ${formatCompactDuration(next - now)}`,
                eventTime: next,
            };
        }

        const holiday = isMarketHoliday(market, now);
        const prefix = holiday ? "Holiday" : (reason || "Closed");
        return {
            isOpen: false,
            phase: holiday ? "holiday" : "closed",
            confidence,
            text: next
                ? `${prefix}${qualifier} - open in ${formatDuration(next - now)}`
                : `${prefix}${qualifier}`,
            compactText: next
                ? `${holiday ? "Holiday" : "Closed"}${qualifier} ${formatCompactDuration(next - now)}`
                : `${prefix}${qualifier}`,
            eventTime: next,
        };
    }

    const markets = ['US', 'JP'].map(key => normalizeMarket(key, calendar.markets[key]));
    return now => markets.map(market => {
        const status = marketStatus(market, now);
        const minutes = status.eventTime
            ? Math.max(0, Math.ceil((status.eventTime - now) / 60000))
            : null;
        return {
            key: market.key,
            localTime: marketTime(now, market.timeZone),
            clockLabel: market.clockLabel,
            ...status,
            countdownLabel: minutes === null ? market.key
                : `${market.key} ${status.isOpen ? 'CLOSES' : 'OPENS'} IN${status.confidence === 'projected' ? '?' : ''}`,
            countdown: minutes === null ? 'UNKNOWN'
                : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
                    : `${minutes}m`,
        };
    });
}

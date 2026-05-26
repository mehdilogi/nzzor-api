// =============================================================================
// Nzzor — Date helpers (Algeria-local timezone aware)
// -----------------------------------------------------------------------------
// All date validation on the backend needs to agree about "what day is it?"
// using ALGERIA local time, not the server's UTC. Railway runs in US-East,
// so without explicit zoning a booking submitted at 23:30 Algiers time on
// June 13 would land on a server that thinks it's June 13 18:30 UTC — fine
// in this direction, but the reverse situation (a 00:30 Algiers booking
// hitting a server still in "yesterday" UTC) is the kind of off-by-one that
// causes real bugs.
//
// Algeria does NOT observe daylight saving time. Africa/Algiers is UTC+1
// year-round. We could hard-code +60 minutes, but using the IANA zone via
// Intl.DateTimeFormat is more future-proof (if the country ever adopts DST
// again — last did in 1981 — we get it for free).
//
// We work in plain "YYYY-MM-DD" strings everywhere, not Date objects.
// ISO date strings sort lexically the right way (2026-05-30 < 2026-06-01),
// and they sidestep every timezone gotcha.
// =============================================================================

const ALGIERS_ZONE = "Africa/Algiers";

// Cached formatter — Intl.DateTimeFormat construction is non-trivial, no
// reason to rebuild on every call.
const _fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ALGIERS_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Return today's date in Algeria as a "YYYY-MM-DD" string.
 *
 * Using en-CA locale because it gives ISO-ordered output (2026-05-30) which
 * matches our database storage and avoids manual reformatting.
 */
function todayInAlgiers() {
  return _fmt.format(new Date());
}

/**
 * Return true if `dateStr` (a "YYYY-MM-DD" string) is strictly earlier than
 * today in Algeria. Bookings for "today" are allowed (same-day arrivals are
 * a real use case for a travel platform).
 */
function isPastDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return false;
  return dateStr < todayInAlgiers();
}

/**
 * Validate a check-in / check-out pair. Returns null if OK, or an error
 * object { code, message } the route can return verbatim to the client.
 *
 * Reasons we might reject:
 *  - check-in is in the past
 *  - check-out is not strictly after check-in
 *  - stay length exceeds the maximum (default 30 nights)
 *
 * Codes are stable strings the frontend can switch on for i18n; the message
 * is a fallback in English the frontend can also just show as-is.
 */
function validateBookingDates(checkIn, checkOut, { maxNights = 30 } = {}) {
  if (isPastDate(checkIn)) {
    return {
      code: "CHECKIN_IN_PAST",
      message: "Check-in date is in the past. Please pick today or a future date.",
    };
  }
  if (!checkOut || checkOut <= checkIn) {
    return {
      code: "CHECKOUT_NOT_AFTER_CHECKIN",
      message: "Check-out must be after check-in.",
    };
  }
  // Compute night count the same way the route does — via Date math —
  // for consistency with downstream pricing. The dates are local-Algeria
  // calendar days, so the UTC interpretation doesn't matter for counting.
  const nights = Math.ceil(
    (new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)
  );
  if (nights > maxNights) {
    return {
      code: "STAY_TOO_LONG",
      message: `Maximum stay is ${maxNights} nights.`,
    };
  }
  return null;
}

/**
 * Return a Date object representing 00:00:00.000 today in Algiers,
 * expressed as an absolute moment in time (so it works directly in
 * Prisma `gte` / `lte` queries against UTC-stored timestamps).
 *
 * Used by the admin "today's activity" panel to filter bookings touched
 * since the start of the current Algerian day, regardless of where the
 * Railway server is physically located.
 */
function startOfTodayInAlgiers() {
  // Algiers is UTC+1 year-round (no DST). The simplest correct path:
  // get the "YYYY-MM-DD" for today-in-Algiers, then construct an ISO
  // string with the +01:00 offset. JavaScript Date parses that into the
  // correct UTC instant.
  const ymd = todayInAlgiers();
  return new Date(`${ymd}T00:00:00+01:00`);
}

/**
 * Return a Date object representing 23:59:59.999 today in Algiers.
 * Used to bound the "today" query window inclusively.
 */
function endOfTodayInAlgiers() {
  const ymd = todayInAlgiers();
  return new Date(`${ymd}T23:59:59.999+01:00`);
}

module.exports = {
  ALGIERS_ZONE,
  todayInAlgiers,
  isPastDate,
  validateBookingDates,
  startOfTodayInAlgiers,
  endOfTodayInAlgiers,
};

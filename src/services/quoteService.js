// =============================================================================
// quoteService — Phase C1: the booking quote engine
// -----------------------------------------------------------------------------
// Turns a per-room occupancy request into a ranked list of priced options,
// one per (room type × board arrangement). This is the read-only pricing brain
// behind the bundled-results grid (Phase C2). It RESERVES NOTHING — it only
// computes and reports. Inventory is held only when a real booking is created.
//
// Input:
//   hotel       — a Hotel row with its active rooms + each room's boardRates
//   occupancy   — [{ adults, children }, ...], one entry per requested room
//   checkIn/out — Date or YYYY-MM-DD
//
// Output: { nights, roomsCount, options: [ {
//   roomId, roomType{en,fr,ar}, board, boardLabel, roomsCount,
//   pricePerNightPerRoom, nights, total, availability, unitsLeft, totalUnits,
//   bestPrice
// } ... ] }  — sorted cheapest total first.
//
// AVAILABILITY (per your decision): if enough units are free for the requested
// rooms -> "AVAILABLE" (Disponible); otherwise "ON_REQUEST" (Sur Demande). We
// never return a hard "sold out" — an unavailable option becomes a request.
//
// CAPACITY: an option is valid only if the room type's `capacity` (total heads)
// can hold the largest single requested room's adults+children. We price the
// SAME room type x N for an N-room request (matches "2 × Chambre Double"), so
// every requested room must individually fit that type.
//
// CHILDREN: counted toward capacity only. No child-specific pricing (deferred,
// per the Phase B decision). Board price is per room per night, absolute.
// =============================================================================

const { checkAvailability } = require("./availabilityService");

// Display labels for boards (EN/FR/AR). The UI can localize further, but we
// return a sensible default so the engine is usable standalone.
const BOARD_LABELS = {
  ROOM_ONLY:     { en: "Room only",      fr: "Chambre seule",     ar: "غرفة فقط" },
  BREAKFAST:     { en: "Breakfast",      fr: "Petit Déjeuner",    ar: "إفطار" },
  HALF_BOARD:    { en: "Half board",     fr: "Demi-pension",      ar: "نصف إقامة" },
  FULL_BOARD:    { en: "Full board",     fr: "Pension complète",  ar: "إقامة كاملة" },
  ALL_INCLUSIVE: { en: "All inclusive",  fr: "Soft All Inclusive", ar: "شامل" },
};

function nightsBetween(checkIn, checkOut) {
  const ci = new Date(checkIn);
  const co = new Date(checkOut);
  const ms = co - ci;
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Build priced options for a hotel + occupancy + dates.
 *
 * @param {object} hotel  — Hotel with `rooms` included, each room having
 *                          `boardRates` included.
 * @param {Array<{adults:number, children:number}>} occupancy
 * @param {string|Date} checkIn
 * @param {string|Date} checkOut
 */
async function buildQuote(hotel, occupancy, checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);

  // Model A: each rate card represents ONE physical room. The guest assembles
  // their stay by picking as many rooms as they searched for (rooms = occupancy
  // length), mixing types freely. We no longer bundle ceil(guests/capacity) into
  // one option — pricing is per single room, and the UI enforces the room count
  // and the total-capacity-vs-guests check.
  const totalGuests = occupancy.reduce(
    (sum, r) => sum + (r.adults || 0) + (r.children || 0),
    0
  );
  const guests = Math.max(1, totalGuests);
  const roomsRequested = Math.max(1, occupancy.length);

  const activeRooms = (hotel.rooms || []).filter((r) => r.isActive);

  // Availability per room at quantity 1 (one card = one room). The UI may let
  // the guest pick several rooms of the same type, but each card is a unit.
  const availInput = activeRooms.map((r) => ({ roomId: r.id, quantity: 1 }));
  let availByRoom = {};
  if (availInput.length > 0) {
    const avail = await checkAvailability(availInput, checkIn, checkOut);
    availByRoom = Object.fromEntries(avail.rooms.map((x) => [x.roomId, x]));
  }

  const options = [];
  for (const room of activeRooms) {
    const a = availByRoom[room.id] || { unitsLeft: 0, totalUnits: room.totalUnits };
    const availability = a.unitsLeft >= 1 ? "AVAILABLE" : "ON_REQUEST";

    // Board options for this room. Price = room.basePrice + board.supplement.
    // The base is ALWAYS included, so a breakfast supplement of 2500 on a 5000
    // room correctly shows 7500 — a supplement can never leak as a full price.
    // An active board row means "offered"; ROOM_ONLY is always offered at base.
    const base = room.basePrice > 0 ? room.basePrice : 0;
    const activeBoards = (room.boardRates || []).filter((br) => br.isActive);
    const hasRoomOnly = activeBoards.some((br) => br.board === "ROOM_ONLY");
    // Breakfast is an INFO LINE on the card (free, in the room price) — NOT a
    // separate selectable board. So a BREAKFAST board row is not turned into its
    // own option here; the breakfastIncluded flag is passed to the UI to render
    // a "Breakfast included" line on every rate card for this room.
    const bfIncluded = room.breakfastIncluded !== false; // default true

    const boardList = activeBoards
      .filter((br) => br.board !== "BREAKFAST") // breakfast is a line, not a card
      .map((br) => ({ board: br.board, supplement: Math.max(0, br.supplement || 0) }));
    // Ensure ROOM_ONLY is always present (at base, supplement 0).
    if (!hasRoomOnly) boardList.unshift({ board: "ROOM_ONLY", supplement: 0 });

    for (const br of boardList) {
      const pricePerNightPerRoom = base + br.supplement;
      // Skip if we genuinely have no price (base 0 AND no supplement).
      if (pricePerNightPerRoom <= 0) continue;
      const total = pricePerNightPerRoom * nights; // one room
      options.push({
        roomId: room.id,
        roomType: { en: room.typeEn, fr: room.typeFr, ar: room.typeAr },
        board: br.board,
        boardLabel: BOARD_LABELS[br.board] || { en: br.board, fr: br.board, ar: br.board },
        roomsCount: 1,
        capacity: Math.max(1, room.capacity || 1),
        breakfastIncluded: bfIncluded,
        pricePerNightPerRoom,
        supplement: br.supplement,
        nights,
        total,
        availability,
        unitsLeft: a.unitsLeft,
        totalUnits: a.totalUnits,
        bestPrice: false,
      });
    }
  }

  // Sort cheapest total first; AVAILABLE ranked above ON_REQUEST at equal price.
  options.sort((x, y) => {
    if (x.total !== y.total) return x.total - y.total;
    if (x.availability !== y.availability) return x.availability === "AVAILABLE" ? -1 : 1;
    return 0;
  });

  // Flag the cheapest AVAILABLE option as "best price" (Meilleur Prix). If none
  // are available, flag the cheapest overall.
  const firstAvailable = options.find((o) => o.availability === "AVAILABLE");
  const flagTarget = firstAvailable || options[0];
  if (flagTarget) flagTarget.bestPrice = true;

  return { nights, totalGuests: guests, roomsRequested, options };
}

module.exports = { buildQuote, BOARD_LABELS, nightsBetween };

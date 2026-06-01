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
  const roomsCount = occupancy.length;

  // The biggest single room's head count — every candidate room type must hold
  // at least this many guests (we assign the same type to all requested rooms).
  const maxHeads = occupancy.reduce(
    (m, r) => Math.max(m, (r.adults || 0) + (r.children || 0)),
    0
  );

  const activeRooms = (hotel.rooms || []).filter((r) => r.isActive);

  // Capacity gate: keep only room types that can hold the largest room request.
  const fitRooms = activeRooms.filter((r) => r.capacity >= maxHeads);

  // Availability for all candidate rooms at the requested quantity, in one pass.
  const availInput = fitRooms.map((r) => ({ roomId: r.id, quantity: roomsCount }));
  let availByRoom = {};
  if (availInput.length > 0) {
    const avail = await checkAvailability(availInput, checkIn, checkOut);
    availByRoom = Object.fromEntries(avail.rooms.map((x) => [x.roomId, x]));
  }

  const options = [];
  for (const room of fitRooms) {
    const a = availByRoom[room.id] || { unitsLeft: 0, totalUnits: room.totalUnits };
    const availability = a.unitsLeft >= roomsCount ? "AVAILABLE" : "ON_REQUEST";

    // Board options for this room. Start from explicit active board rates;
    // ensure ROOM_ONLY exists as a fallback from basePrice if not priced.
    const boards = (room.boardRates || []).filter((br) => br.isActive);
    const hasRoomOnly = boards.some((br) => br.board === "ROOM_ONLY");
    const boardList = [...boards];
    if (!hasRoomOnly) {
      boardList.push({ board: "ROOM_ONLY", price: room.basePrice });
    }

    for (const br of boardList) {
      const pricePerNightPerRoom = br.price;
      const total = pricePerNightPerRoom * nights * roomsCount;
      options.push({
        roomId: room.id,
        roomType: { en: room.typeEn, fr: room.typeFr, ar: room.typeAr },
        board: br.board,
        boardLabel: BOARD_LABELS[br.board] || { en: br.board, fr: br.board, ar: br.board },
        roomsCount,
        pricePerNightPerRoom,
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

  return { nights, roomsCount, options };
}

module.exports = { buildQuote, BOARD_LABELS, nightsBetween };

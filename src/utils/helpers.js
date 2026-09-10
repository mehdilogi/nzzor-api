const { v4: uuidv4 } = require("uuid");

// NZR-XXXX-XXXX format (Nzzor reference)
function generateBookingRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I/O/0/1 to avoid confusion
  let ref = "NZR-";
  for (let i = 0; i < 4; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  ref += "-";
  for (let i = 0; i < 4; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

function localize(obj, field, lang = "en") {
  const l = lang.toLowerCase();
  return obj[`${field}${l.charAt(0).toUpperCase() + l.slice(1)}`]
    || obj[`${field}En`]
    || "";
}

function formatHotel(hotel, lang = "en") {
  const primaryPhoto = hotel.photos?.find(p => p.isPrimary) || hotel.photos?.[0];

  return {
    id: hotel.id,
    slug: hotel.slug,
    name: localize(hotel, "name", lang),
    description: localize(hotel, "desc", lang),
    stars: hotel.stars,
    city: localize(hotel, "city", lang),
    region: localize(hotel, "region", lang),
    address: hotel.address,
    location: hotel.latitude && hotel.longitude
      ? { lat: hotel.latitude, lng: hotel.longitude }
      : null,
    rating: hotel.rating,
    reviewCount: hotel.reviewCount,
    checkInTime: hotel.checkInTime,
    checkOutTime: hotel.checkOutTime,
    policies: {
      cancellationHours: hotel.cancellationHours,
      childrenAllowed: hotel.childrenAllowed,
      petsAllowed: hotel.petsAllowed,
      parkingFree: hotel.parkingFree,
    },
    trustSignals: {
      instantConfirmation: hotel.instantConfirmation,
      verifiedPartner: hotel.verifiedPartner,
    },
    isFeatured: hotel.isFeatured,
    tags: hotel.tags || [],
    priceFrom: hotel.rooms?.length
      ? Math.min(...hotel.rooms.filter(r => r.isActive).map(r => r.basePrice))
      : null,
    photos: hotel.photos
      ?.sort((a, b) => a.sortOrder - b.sortOrder)
      .map(p => ({ id: p.id, url: p.url, isPrimary: p.isPrimary })) || [],
    primaryPhoto: primaryPhoto?.url || null,
    amenities: hotel.amenities?.map(ha => ({
      key: ha.amenity.key,
      name: localize(ha.amenity, "name", lang),
      icon: ha.amenity.icon,
      category: ha.amenity.category,
    })) || [],
    rooms: hotel.rooms
      ?.filter(r => r.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(r => formatRoom(r, lang)) || [],
  };
}

// The listing grid needs eight fields per hotel. formatHotel() returns the
// whole record — full description, every photo URL, every amenity with its
// icon, and every room type with price and capacity — which at limit=24 is
// several hundred kilobytes of JSON to draw a grid of cards. On a market that
// is overwhelmingly mobile data, that is the single most expensive thing the
// listing does.
//
// Pair this with LIST_INCLUDE in routes/hotels.js: photos are capped there at
// five (primary first) and rooms are reduced to basePrice, which is all
// priceFrom needs.
function formatHotelCard(hotel, lang = "en") {
  const primary = hotel.photos?.find((p) => p.isPrimary) || hotel.photos?.[0];
  const prices = (hotel.rooms || [])
    .map((r) => r.basePrice)
    .filter((n) => typeof n === "number");

  return {
    id: hotel.id,
    slug: hotel.slug,
    name: localize(hotel, "name", lang),
    city: localize(hotel, "city", lang),
    stars: hotel.stars,
    rating: hotel.rating,
    reviewCount: hotel.reviewCount,
    isFeatured: hotel.isFeatured,
    tags: hotel.tags || [],
    trustSignals: {
      instantConfirmation: hotel.instantConfirmation,
      verifiedPartner: hotel.verifiedPartner,
    },
    priceFrom: prices.length ? Math.min(...prices) : null,
    photos: (hotel.photos || []).map((p) => ({ id: p.id, url: p.url, isPrimary: p.isPrimary })),
    primaryPhoto: primary?.url || null,
  };
}

function formatRoom(room, lang = "en") {
  return {
    id: room.id,
    type: localize(room, "type", lang),
    description: localize(room, "desc", lang),
    price: room.basePrice,
    capacity: room.capacity,
    sizeSqm: room.sizeSqm,
    bedType: room.bedType,
    totalUnits: room.totalUnits,
    photos: room.photos?.sort((a, b) => a.sortOrder - b.sortOrder).map(p => p.url) || [],
  };
}

function formatBooking(booking, lang = "en") {
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    guest: {
      firstName: booking.guestFirstName,
      lastName: booking.guestLastName,
      email: booking.guestEmail,
      phone: booking.guestPhone,
    },
    hotel: booking.hotel ? {
      id: booking.hotel.id,
      name: localize(booking.hotel, "name", lang),
      slug: booking.hotel.slug,
      city: localize(booking.hotel, "city", lang),
      contactPhone: booking.hotel.contactPhone || null,
    } : null,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    rooms: booking.rooms?.map(br => ({
      type: localize(br.room, "type", lang),
      quantity: br.quantity,
      pricePerNight: br.pricePerNight,
    })) || [],
    pricing: {
      subtotal: booking.subtotal,
      taxes: booking.taxes,
      fees: booking.fees,
      discount: booking.discount,
      total: booking.total,
      currency: booking.currency,
    },
    payment: {
      method: booking.paymentMethod,
      status: booking.paymentStatus,
    },
    specialRequests: booking.specialRequests,
    createdAt: booking.createdAt,
    confirmedAt: booking.confirmedAt,
    cancelledAt: booking.cancelledAt,
    cancellationReason: booking.cancellationReason,
  };
}

// maxLimit is a per-route ceiling. It defaults to 50 so every existing caller
// behaves exactly as before; the hotels listing raises it because restoring an
// accumulated list after a back-navigation asks for several pages in one
// request, and silently truncating that at 50 loses rows the guest had
// already scrolled past.
function paginate(query, maxLimit = 50) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit) || 20));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

module.exports = {
  generateBookingRef,
  localize,
  formatHotel,
  formatHotelCard,
  formatRoom,
  formatBooking,
  paginate,
};

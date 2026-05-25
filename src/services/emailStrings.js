// =============================================================================
// emailStrings — Trilingual copy for transactional emails
// -----------------------------------------------------------------------------
// One flat lookup table. Each key has en/fr/ar variants. Keep keys grouped by
// section so it's obvious which strings power which UI region. Tone: warm,
// agency-grade, factual. NOT marketing copy. Booking confirmation emails are
// read carefully — the reader is mid-trip planning, they want clarity.
//
// To add a new string: pick a unique dot-key, add EN/FR/AR. If a translation
// is missing the helper falls back to EN, then to the key name itself.
// =============================================================================

const STRINGS = {
  // ---- Brand header ----
  "brand.subtitle": {
    en: "BY ALLOUNI TRAVEL AGENCY",
    fr: "PAR ALLOUNI TRAVEL AGENCY",
    ar: "بواسطة وكالة علوني للسياحة",
  },

  // ---- VARIANT: created — booking just placed, awaiting team confirmation ----
  "variant.created.preview": {
    en: "We received your booking {reference} — our team will confirm by noon.",
    fr: "Nous avons reçu votre réservation {reference} — notre équipe la confirmera avant midi.",
    ar: "استلمنا حجزك {reference} — سيؤكده فريقنا قبل الظهر.",
  },
  "variant.created.kicker": {
    en: "Booking received",
    fr: "Réservation reçue",
    ar: "تم استلام الحجز",
  },
  "variant.created.heading": {
    en: "We have your booking. Our team takes it from here.",
    fr: "Nous avons votre réservation. Notre équipe prend le relais.",
    ar: "لقد استلمنا حجزك. فريقنا يتابع من هنا.",
  },
  "variant.created.lead": {
    en: "Hi {firstName} — thanks for booking with Nzzor. We've recorded your request and the Allouni team is now confirming availability directly with the hotel.",
    fr: "Bonjour {firstName} — merci d'avoir réservé avec Nzzor. Nous avons enregistré votre demande et l'équipe Allouni confirme actuellement la disponibilité directement avec l'hôtel.",
    ar: "مرحباً {firstName} — شكراً لحجزك مع نزور. لقد سجّلنا طلبك، وفريق علوني يؤكد التوفر مباشرة مع الفندق الآن.",
  },
  "variant.created.note": {
    en: "You'll hear back from us by 12:00 tomorrow (Algiers time) with a final confirmation. If you need to reach us before then, just reply to this email or message us on WhatsApp.",
    fr: "Vous recevrez une confirmation finale de notre part avant 12h00 demain (heure d'Alger). Si vous avez besoin de nous joindre avant, répondez simplement à cet e-mail ou contactez-nous sur WhatsApp.",
    ar: "ستتلقى تأكيداً نهائياً منا قبل الساعة 12:00 ظهراً غداً (بتوقيت الجزائر). إن احتجت للتواصل قبل ذلك، فقط رد على هذا البريد أو راسلنا على واتساب.",
  },

  // ---- VARIANT: confirmed — Allouni team confirmed with hotel ----
  "variant.confirmed.preview": {
    en: "Your booking {reference} at {hotel} is confirmed.",
    fr: "Votre réservation {reference} à {hotel} est confirmée.",
    ar: "تم تأكيد حجزك {reference} في {hotel}.",
  },
  "variant.confirmed.kicker": {
    en: "Booking confirmed",
    fr: "Réservation confirmée",
    ar: "تم تأكيد الحجز",
  },
  "variant.confirmed.heading": {
    en: "You're all set. The hotel is expecting you.",
    fr: "Tout est en ordre. L'hôtel vous attend.",
    ar: "كل شيء جاهز. الفندق في انتظارك.",
  },
  "variant.confirmed.lead": {
    en: "Hi {firstName} — great news. The hotel has confirmed your booking and the room is locked in. Below are the full details for your records.",
    fr: "Bonjour {firstName} — bonne nouvelle. L'hôtel a confirmé votre réservation et la chambre est verrouillée. Voici tous les détails pour vos dossiers.",
    ar: "مرحباً {firstName} — أخبار جيدة. أكّد الفندق حجزك وتم تثبيت الغرفة. فيما يلي التفاصيل الكاملة للحفظ.",
  },
  "variant.confirmed.note": {
    en: "Show this reference at check-in. If your plans change, contact us at least 48 hours before arrival to avoid cancellation fees.",
    fr: "Présentez cette référence à l'arrivée. Si vos plans changent, contactez-nous au moins 48 heures avant l'arrivée pour éviter les frais d'annulation.",
    ar: "اعرض هذا المرجع عند تسجيل الوصول. إن تغيرت خططك، تواصل معنا قبل الوصول بـ 48 ساعة على الأقل لتجنب رسوم الإلغاء.",
  },

  // ---- VARIANT: paid — payment received and recorded ----
  "variant.paid.preview": {
    en: "Payment received for booking {reference}.",
    fr: "Paiement reçu pour la réservation {reference}.",
    ar: "تم استلام الدفع للحجز {reference}.",
  },
  "variant.paid.kicker": {
    en: "Payment received",
    fr: "Paiement reçu",
    ar: "تم استلام الدفع",
  },
  "variant.paid.heading": {
    en: "Payment received. Thank you.",
    fr: "Paiement reçu. Merci.",
    ar: "تم استلام الدفع. شكراً لك.",
  },
  "variant.paid.lead": {
    en: "Hi {firstName} — we've received your payment in full. This email is your receipt. Keep it for your records.",
    fr: "Bonjour {firstName} — nous avons reçu votre paiement intégral. Cet e-mail est votre reçu. Conservez-le pour vos dossiers.",
    ar: "مرحباً {firstName} — استلمنا دفعك كاملاً. هذا البريد هو إيصالك. احتفظ به للسجلات.",
  },
  "variant.paid.note": {
    en: "If you need a formal invoice for business or expense purposes, reply to this email and we'll send one within one business day.",
    fr: "Si vous avez besoin d'une facture officielle à des fins professionnelles ou de remboursement, répondez à cet e-mail et nous vous en enverrons une sous un jour ouvrable.",
    ar: "إن احتجت لفاتورة رسمية لأغراض تجارية أو استرداد المصاريف، رد على هذا البريد وسنرسل واحدة خلال يوم عمل واحد.",
  },

  // ---- VARIANT: rejected — hotel was unable to confirm the booking ----
  // Tone: apologetic but not over-apologetic. The customer didn't choose
  // this. Be clear about what happens next (refund, alternatives).
  "variant.rejected.preview": {
    en: "We weren't able to confirm booking {reference} — full refund on the way.",
    fr: "Nous n'avons pas pu confirmer la réservation {reference} — remboursement complet en cours.",
    ar: "لم نتمكن من تأكيد الحجز {reference} — استرداد كامل قيد التنفيذ.",
  },
  "variant.rejected.kicker": {
    en: "Booking not confirmed",
    fr: "Réservation non confirmée",
    ar: "لم يتم تأكيد الحجز",
  },
  "variant.rejected.heading": {
    en: "We're sorry — the hotel couldn't confirm this booking.",
    fr: "Nous sommes désolés — l'hôtel n'a pas pu confirmer cette réservation.",
    ar: "نأسف — لم يستطع الفندق تأكيد هذا الحجز.",
  },
  "variant.rejected.lead": {
    en: "Hi {firstName} — the hotel was unable to honor your booking for the dates you requested. This usually means the room is no longer available. We've recorded this and any payment you made will be refunded in full.",
    fr: "Bonjour {firstName} — l'hôtel n'a pas pu honorer votre réservation aux dates demandées. Cela signifie généralement que la chambre n'est plus disponible. Nous avons enregistré cela et tout paiement effectué sera intégralement remboursé.",
    ar: "مرحباً {firstName} — لم يتمكن الفندق من قبول حجزك للتواريخ المطلوبة. عادةً ما يعني هذا أن الغرفة لم تعد متاحة. لقد سجّلنا ذلك وسيتم استرداد أي دفعة قمت بها بالكامل.",
  },
  "variant.rejected.note": {
    en: "If a payment was charged, the refund will appear on your card within 7–14 business days depending on your bank. We'd be happy to help you find a similar hotel for the same dates — just reply to this email and our team will send options within the hour.",
    fr: "Si un paiement a été prélevé, le remboursement apparaîtra sur votre carte sous 7 à 14 jours ouvrables selon votre banque. Nous serions heureux de vous aider à trouver un hôtel similaire pour les mêmes dates — répondez simplement à cet e-mail et notre équipe vous enverra des options dans l'heure.",
    ar: "إن تم تحصيل دفعة، سيظهر الاسترداد على بطاقتك خلال 7-14 يوم عمل حسب بنكك. يسعدنا مساعدتك في العثور على فندق مماثل لنفس التواريخ — فقط رد على هذا البريد وسيرسل فريقنا الخيارات خلال ساعة.",
  },

  // ---- VARIANT: cancelled — booking cancelled (by customer, admin, or system) ----
  // Tone: factual, neutral on who initiated. Cover refund timing.
  "variant.cancelled.preview": {
    en: "Booking {reference} has been cancelled.",
    fr: "La réservation {reference} a été annulée.",
    ar: "تم إلغاء الحجز {reference}.",
  },
  "variant.cancelled.kicker": {
    en: "Booking cancelled",
    fr: "Réservation annulée",
    ar: "تم إلغاء الحجز",
  },
  "variant.cancelled.heading": {
    en: "Your booking has been cancelled.",
    fr: "Votre réservation a été annulée.",
    ar: "تم إلغاء حجزك.",
  },
  "variant.cancelled.lead": {
    en: "Hi {firstName} — this email confirms your booking has been cancelled. Below are the details for your records.",
    fr: "Bonjour {firstName} — cet e-mail confirme l'annulation de votre réservation. Voici les détails pour vos dossiers.",
    ar: "مرحباً {firstName} — هذا البريد يؤكد إلغاء حجزك. فيما يلي التفاصيل للحفظ.",
  },
  "variant.cancelled.note": {
    en: "If you've already paid, the refund will follow our cancellation policy. For bookings cancelled more than 48 hours before check-in, the full amount is refunded. Inside 48 hours, charges may apply per the hotel's policy. We'll send a separate refund confirmation once it's processed.",
    fr: "Si vous avez déjà payé, le remboursement suivra notre politique d'annulation. Pour les réservations annulées plus de 48 heures avant l'arrivée, le montant total est remboursé. Dans les 48 heures, des frais peuvent s'appliquer selon la politique de l'hôtel. Nous enverrons une confirmation de remboursement distincte une fois traitée.",
    ar: "إن كنت قد دفعت بالفعل، فسيتبع الاسترداد سياسة الإلغاء لدينا. بالنسبة للحجوزات الملغاة قبل أكثر من 48 ساعة من الوصول، يتم استرداد المبلغ بالكامل. ضمن 48 ساعة، قد تنطبق رسوم وفقاً لسياسة الفندق. سنرسل تأكيد استرداد منفصلاً بمجرد معالجته.",
  },

  // ---- Booking reference card ----
  "ref.label": {
    en: "BOOKING REFERENCE",
    fr: "RÉFÉRENCE DE RÉSERVATION",
    ar: "مرجع الحجز",
  },

  // ---- Details section ----
  "details.title": {
    en: "BOOKING DETAILS",
    fr: "DÉTAILS DE LA RÉSERVATION",
    ar: "تفاصيل الحجز",
  },
  "details.hotel": {
    en: "Hotel",
    fr: "Hôtel",
    ar: "الفندق",
  },
  "details.guest": {
    en: "Guest",
    fr: "Client",
    ar: "النزيل",
  },
  "details.checkin": {
    en: "Check-in",
    fr: "Arrivée",
    ar: "تسجيل الوصول",
  },
  "details.checkout": {
    en: "Check-out",
    fr: "Départ",
    ar: "تسجيل المغادرة",
  },
  "details.nights": {
    en: "Nights",
    fr: "Nuits",
    ar: "الليالي",
  },
  "details.night_one": {
    en: "night",
    fr: "nuit",
    ar: "ليلة",
  },
  "details.night_many": {
    en: "nights",
    fr: "nuits",
    ar: "ليالٍ",
  },
  "details.rooms": {
    en: "Rooms",
    fr: "Chambres",
    ar: "الغرف",
  },
  "details.payment": {
    en: "Payment method",
    fr: "Méthode de paiement",
    ar: "طريقة الدفع",
  },
  "details.total": {
    en: "Total",
    fr: "Total",
    ar: "الإجمالي",
  },

  // ---- Payment method labels ----
  "payment.cib": {
    en: "CIB card",
    fr: "Carte CIB",
    ar: "بطاقة CIB",
  },
  "payment.eddahabia": {
    en: "Edahabia",
    fr: "Edahabia",
    ar: "الذهبية",
  },
  "payment.cash": {
    en: "Cash on arrival",
    fr: "Espèces à l'arrivée",
    ar: "نقداً عند الوصول",
  },
  "payment.bank_transfer": {
    en: "Bank transfer",
    fr: "Virement bancaire",
    ar: "تحويل بنكي",
  },
  "payment.whatsapp_assisted": {
    en: "WhatsApp assisted",
    fr: "Assistance WhatsApp",
    ar: "بمساعدة واتساب",
  },

  // ---- CTA ----
  "cta.view": {
    en: "View booking online",
    fr: "Voir la réservation en ligne",
    ar: "عرض الحجز عبر الإنترنت",
  },

  // ---- Footer ----
  "footer.operator": {
    en: "Nzzor is operated by Allouni Travel Agency, a licensed Algerian institution authorized by the Ministry of Tourism.",
    fr: "Nzzor est exploité par Allouni Travel Agency, une institution algérienne agréée par le Ministère du Tourisme.",
    ar: "نزور تُدار من طرف وكالة علوني للسياحة والأسفار، مؤسسة جزائرية معتمدة من وزارة السياحة.",
  },
  "footer.ministry": {
    en: "Licensed by the Algerian Ministry of Tourism · Made in Algeria 🇩🇿",
    fr: "Agréé par le Ministère du Tourisme algérien · Fait en Algérie 🇩🇿",
    ar: "مرخصة من وزارة السياحة الجزائرية · صُنع في الجزائر 🇩🇿",
  },
  "footer.contact": {
    en: "Questions? Reach us at",
    fr: "Des questions? Contactez-nous à",
    ar: "هل لديك أسئلة؟ راسلنا على",
  },
  "footer.unsubscribe_note": {
    en: "You received this email because you made a booking on nzzor.com. This is a transactional message — we don't send marketing email.",
    fr: "Vous recevez cet e-mail car vous avez effectué une réservation sur nzzor.com. Ceci est un message transactionnel — nous n'envoyons pas d'e-mails marketing.",
    ar: "تلقيت هذا البريد لأنك أجريت حجزاً على nzzor.com. هذه رسالة معاملات — نحن لا نرسل بريد تسويق.",
  },
};

/**
 * Lookup a translation. Falls back to EN, then to the key itself.
 *
 * @param {string} key
 * @param {string} lang  — "en" | "fr" | "ar"
 * @returns {string}
 */
function t(key, lang = "en") {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

module.exports = { t, STRINGS };

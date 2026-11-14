// =============================================================================
// Admin → Groups (GET /api/admin/groups, PATCH /api/admin/groups/:id)
// =============================================================================

const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

router.use(requireAuth, requireAdmin);

const STATUSES = ["NEW", "QUOTED", "WON", "LOST"];

router.get("/", async (req, res, next) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const [rows, counts] = await Promise.all([
      prisma.groupRequest.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      prisma.groupRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of counts) byStatus[c.status] = c._count._all;
    const won = await prisma.groupRequest.aggregate({
      where: { status: "WON" },
      _sum: { quoteAmount: true },
    });
    res.json({ data: rows, counts: byStatus, wonTotal: won._sum.quoteAmount || 0 });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  status: z.enum(["NEW", "QUOTED", "WON", "LOST"]).optional(),
  quoteAmount: z.coerce.number().int().min(0).max(1e10).nullable().optional(),
  adminNotes: z.string().max(5000).nullable().optional(),
});

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: "Validation failed" });
    const row = await prisma.groupRequest.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ data: row });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

module.exports = router;

const Stripe = require("stripe");

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!SECRET_KEY) {
    return res.status(500).json({ error: "STRIPE_SECRET_KEY env var is missing on the server." });
  }
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: "ADMIN_PASSWORD env var is missing on the server." });
  }

  const provided =
    req.headers["x-admin-password"] ||
    (req.query && req.query.pw) ||
    "";

  if (provided !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const stripe = new Stripe(SECRET_KEY, { apiVersion: "2024-06-20" });

  try {
    const hours = Math.min(Math.max(parseInt((req.query && req.query.hours) || "24", 10) || 24, 1), 24 * 30);
    const since = Math.floor(Date.now() / 1000) - hours * 3600;

    const [sessionsRes, linksRes, productsRes] = await Promise.all([
      stripe.checkout.sessions.list({ limit: 100, created: { gte: since } }),
      stripe.paymentLinks.list({ limit: 100, active: true }).catch(() => ({ data: [] })),
      stripe.products.list({ limit: 100, active: true }).catch(() => ({ data: [] })),
    ]);

    const productById = new Map(productsRes.data.map((p) => [p.id, p.name]));

    const linkLabelById = new Map();
    for (const link of linksRes.data) {
      try {
        const full = await stripe.paymentLinks.retrieve(link.id, { expand: ["line_items"] });
        const first = full.line_items && full.line_items.data && full.line_items.data[0];
        const productId = first && first.price && first.price.product;
        const label = (productId && productById.get(productId)) || link.url;
        linkLabelById.set(link.id, label);
      } catch {
        linkLabelById.set(link.id, link.url);
      }
    }

    const sales = sessionsRes.data
      .filter((s) => s.payment_status === "paid")
      .map((s) => {
        const email =
          (s.customer_details && s.customer_details.email) ||
          s.customer_email ||
          "";
        const name = (s.customer_details && s.customer_details.name) || "";
        const phone = (s.customer_details && s.customer_details.phone) || "";
        const product = s.payment_link ? linkLabelById.get(s.payment_link) || "" : "";
        return {
          id: s.id,
          date: s.created,
          email,
          name,
          phone,
          amount: s.amount_total,
          currency: (s.currency || "usd").toUpperCase(),
          product,
          paymentLinkId: s.payment_link || "",
        };
      })
      .sort((a, b) => b.date - a.date);

    return res.status(200).json({
      sales,
      count: sales.length,
      windowHours: hours,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.error("sales.js error:", err);
    return res.status(500).json({ error: err.message || "Stripe fetch failed" });
  }
};

const Stripe = require("stripe");

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function extractCustomFields(session) {
  const out = {};
  const fields = session.custom_fields || [];
  for (const f of fields) {
    const label =
      (f.label && (f.label.custom || f.label.type)) ||
      f.key ||
      "field";
    let val = "";
    if (f.type === "text" && f.text) val = f.text.value || "";
    else if (f.type === "numeric" && f.numeric) val = f.numeric.value || "";
    else if (f.type === "dropdown" && f.dropdown) val = f.dropdown.value || "";
    if (val !== "") out[label] = String(val);
  }
  return out;
}

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
    const hours = Math.min(Math.max(parseInt((req.query && req.query.hours) || "720", 10) || 720, 1), 24 * 90);
    const since = Math.floor(Date.now() / 1000) - hours * 3600;

    const collected = [];
    let starting_after = undefined;
    for (let i = 0; i < 3; i++) {
      const page = await stripe.checkout.sessions.list({
        limit: 100,
        created: { gte: since },
        starting_after,
      });
      collected.push(...page.data);
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1].id;
    }

    const [linksRes, productsRes] = await Promise.all([
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

    const sales = collected
      .filter((s) => s.payment_status === "paid")
      .map((s) => {
        const cd = s.customer_details || {};
        const product = s.payment_link ? linkLabelById.get(s.payment_link) || "" : "";
        return {
          id: s.id,
          date: s.created,
          email: cd.email || s.customer_email || "",
          name: cd.name || "",
          phone: cd.phone || "",
          amount: s.amount_total || 0,
          currency: (s.currency || "usd").toUpperCase(),
          product,
          paymentLinkId: s.payment_link || "",
          customFields: extractCustomFields(s),
        };
      })
      .sort((a, b) => b.date - a.date);

    const customFieldLabels = Array.from(
      sales.reduce((set, s) => {
        Object.keys(s.customFields || {}).forEach((k) => set.add(k));
        return set;
      }, new Set())
    );

    const products = Array.from(new Set(sales.map((s) => s.product).filter(Boolean))).sort();

    return res.status(200).json({
      sales,
      count: sales.length,
      totalCents: sales.reduce((sum, s) => sum + (s.amount || 0), 0),
      customFieldLabels,
      products,
      windowHours: hours,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.error("sales.js error:", err);
    return res.status(500).json({ error: err.message || "Stripe fetch failed" });
  }
};

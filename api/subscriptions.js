const Stripe = require("stripe");

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!SECRET_KEY) return res.status(500).json({ error: "STRIPE_SECRET_KEY env var is missing on the server." });
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: "ADMIN_PASSWORD env var is missing on the server." });

  const provided = req.headers["x-admin-password"] || (req.query && req.query.pw) || "";
  if (provided !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });

  const stripe = new Stripe(SECRET_KEY, { apiVersion: "2024-06-20" });

  try {
    const collected = [];
    let starting_after = undefined;
    for (let i = 0; i < 3; i++) {
      const page = await stripe.subscriptions.list({
        limit: 100,
        status: "all",
        starting_after,
        expand: ["data.customer", "data.items.data.price.product"],
      });
      collected.push(...page.data);
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1].id;
    }

    const subs = collected.map((s) => {
      const customer = s.customer && typeof s.customer === "object" ? s.customer : {};
      const firstItem = s.items && s.items.data && s.items.data[0];
      const price = firstItem && firstItem.price;
      const product = price && price.product && typeof price.product === "object" ? price.product : null;
      const amount = price ? price.unit_amount : null;
      const interval = price && price.recurring ? price.recurring.interval : "";
      return {
        id: s.id,
        status: s.status,
        email: customer.email || "",
        name: customer.name || "",
        phone: customer.phone || "",
        product: product ? product.name : "",
        amount: amount || 0,
        currency: (price && price.currency ? price.currency : "usd").toUpperCase(),
        interval,
        created: s.created,
        currentPeriodEnd: s.current_period_end,
        cancelAtPeriodEnd: !!s.cancel_at_period_end,
      };
    }).sort((a, b) => b.created - a.created);

    const activeSubs = subs.filter((s) => s.status === "active" || s.status === "trialing");
    const mrrCents = activeSubs.reduce((sum, s) => {
      if (!s.amount) return sum;
      if (s.interval === "year") return sum + Math.round(s.amount / 12);
      if (s.interval === "week") return sum + Math.round((s.amount * 52) / 12);
      if (s.interval === "day") return sum + Math.round((s.amount * 365) / 12);
      return sum + s.amount;
    }, 0);

    return res.status(200).json({
      subscriptions: subs,
      count: subs.length,
      activeCount: activeSubs.length,
      mrrCents,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.error("subscriptions.js error:", err);
    return res.status(500).json({ error: err.message || "Stripe fetch failed" });
  }
};

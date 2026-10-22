/** The published price and the maths behind the pricing slider. Rupees, whole numbers. */
export const PRICE_PER_CALL = 20;
export const GST_PERCENT = 18;
/** A recruiter's own time on a 15-minute phone screen at a ₹3 lakh salary. Our estimate. */
export const RECRUITER_SCREEN_COST = 65;

const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Monthly bill before GST: completed calls times ₹20. */
export const monthlyTotal = (calls: number) => whole(calls) * PRICE_PER_CALL;

/** An amount plus 18% GST, to the nearest rupee. */
export const withGst = (amount: number) => Math.round((amount * (100 + GST_PERCENT)) / 100);

/** What the same screens cost in recruiter time, to the nearest ₹50 so it reads as an estimate. */
export const recruiterTimeEstimate = (calls: number) => Math.round((whole(calls) * RECRUITER_SCREEN_COST) / 50) * 50;

/** ₹ with Indian digit grouping, e.g. ₹1,00,000. */
export const formatInr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

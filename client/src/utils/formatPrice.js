const whole = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
});
const withPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

// Prices are stored as integer paise. 49900 becomes "₹499", 49950 becomes "₹499.50".
export function formatPrice(paise) {
    if (!Number.isFinite(paise)) return "";
    return (paise % 100 === 0 ? whole : withPaise).format(paise / 100);
}
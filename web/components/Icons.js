// Small stroke icons (decorative - the buttons around them carry aria-labels)
const P = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true };
export const BookmarkIcon = ({ filled }) => <svg {...P} fill={filled ? "currentColor" : "none"}><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
export const StarIcon = () => <svg {...P}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>;
export const XIcon = () => <svg {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const PinIcon = () => <svg {...P} width={14} height={14} strokeWidth={2}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /></svg>;
export const SearchIcon = () => <svg {...P} width={20} height={20} strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const CheckIcon = () => <svg {...P} width={14} height={14} strokeWidth={3}><path d="M5 12l5 5 9-10" /></svg>;
export const BellIcon = () => <svg {...P} width={20} height={20}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>;

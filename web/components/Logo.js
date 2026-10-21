import Link from "next/link";
import Leaf from "./Leaf";

export default function Logo({ dark = false, href = "/" }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 no-underline" style={{ color: dark ? "#F7F1E8" : "#2B211C" }}>
      <Leaf size={30} color={dark ? "#C9874E" : "#A24B25"} vein={dark ? "#2B211C" : "#F7F1E8"} />
      <span className="font-serif text-[30px] font-semibold tracking-wide">BookBridge</span>
    </Link>
  );
}

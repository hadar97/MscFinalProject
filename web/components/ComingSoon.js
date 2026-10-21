import Link from "next/link";
import Leaf from "./Leaf";

// A placeholder for parts of BookBridge that are planned but not built yet
export default function ComingSoon({ title, children, owner }) {
  return (
    <div className="card relative flex flex-col items-start gap-4 overflow-hidden p-10">
      <Leaf size={160} color="#B8893B" vein={null} className="absolute -right-6 -top-6 rotate-[25deg] opacity-15" />
      <span className="eyebrow">Coming soon{owner ? ` · ${owner}` : ""}</span>
      <h1 className="m-0 font-serif text-5xl font-semibold">{title}</h1>
      <p className="m-0 max-w-[640px] text-lg leading-relaxed text-ink-soft">{children}</p>
      <Link href="/for-you" className="btn btn-outline">Back to your picks</Link>
    </div>
  );
}

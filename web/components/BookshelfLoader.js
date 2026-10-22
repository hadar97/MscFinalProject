// Loading animation: books on a shelf topple over and stand up again (styles in globals.css)
const BOOKS = [
  { w: 16, h: 52, c: "#7A3B22" },
  { w: 20, h: 60, c: "#556030" },
  { w: 14, h: 46, c: "#B8893B" },
  { w: 18, h: 56, c: "#5B2A1E" },
  { w: 22, h: 50, c: "#2F3B33" },
  { w: 15, h: 58, c: "#A24B25" },
  { w: 19, h: 48, c: "#8C6A2F" },
];

export default function BookshelfLoader({ label = "Loading…", className = "" }) {
  return (
    <div role="status" className={`flex justify-center py-10 ${className}`}>
      <div className="shelf-loader">
        <div className="books" aria-hidden="true">
          {BOOKS.map((b, i) => (
            <span key={i} className={`book ${i === BOOKS.length - 1 ? "last" : ""}`}
              style={{ "--w": `${b.w}px`, "--h": `${b.h}px`, "--c": b.c, "--i": i }} />
          ))}
        </div>
        <div className="plank" aria-hidden="true" />
        <span className="label">{label}</span>
      </div>
    </div>
  );
}

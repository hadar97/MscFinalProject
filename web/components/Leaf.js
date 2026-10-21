// The BookBridge leaf - logo and autumn decoration
export default function Leaf({ size = 28, color = "#A24B25", vein = "#F7F1E8", className = "", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className} style={style}>
      <path d="M12 2C6 6 4 11 6 17c1.5 3.5 4 5 6 5s4.5-1.5 6-5c2-6 0-11-6-15z" fill={color} />
      {vein && <path d="M12 5v17" stroke={vein} strokeWidth="1.2" />}
    </svg>
  );
}

"use client";

// 1-5 stars. With onChange: buttons the user can click; without: display only.
export default function Stars({ value = 0, onChange, size = 22, label = "Rating" }) {
  return (
    <div className="flex gap-0.5" role={onChange ? "group" : "img"} aria-label={onChange ? label : `${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"
              fill={n <= value ? "#B8893B" : "none"}
              stroke={n <= value ? "#B8893B" : "#B9A88F"}
              strokeWidth="1.4"
            />
          </svg>
        );
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={n === value} className="cursor-pointer bg-transparent p-0.5 leading-none">
            {star}
          </button>
        ) : (
          <span key={n} className="p-0.5 leading-none">{star}</span>
        );
      })}
    </div>
  );
}

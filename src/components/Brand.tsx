export function ZigZag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 12" preserveAspectRatio="none" className={className} fill="none" aria-hidden>
      <polyline
        points="2,9 14,3 26,9 38,3 50,9 62,3 74,9 86,3 98,9 110,3 118,7"
        stroke="#e50914"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <div className="select-none">
      <div className={`${big ? "text-4xl" : "text-2xl"} font-black tracking-tight leading-none`}>
        <span className="text-white text-glow">GHG</span>
        <span className="text-ghg-red">Flix</span>
      </div>
      <ZigZag className={big ? "h-2.5 w-28 mt-2" : "h-2 w-20 mt-1.5"} />
    </div>
  );
}

/** The Lab's rail icon: a conical flask half full of potion (operator's pick,
 *  version 6 "Pozione" of six, 2026-11-20). lucide-style 24-unit outline in
 *  currentColor; the liquid is the same colour at 35 % — violet when the Lab
 *  button is lit, grey when it is not. */
export default function LabFlaskIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.4 15h11.2l2.155 4.04A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96z" fill="currentColor" fillOpacity={0.35} stroke="none" />
      <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
      <path d="M6.453 15h11.094" />
      <path d="M8.5 2h7" />
    </svg>
  );
}

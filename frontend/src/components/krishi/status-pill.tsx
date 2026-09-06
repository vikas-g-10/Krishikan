import { cn } from "@/lib/utils";
import { statusLabel, type StatusLevel } from "@/data/mock-farm";

const tone: Record<StatusLevel, string> = {
  good: "bg-status-good/12 text-status-good ring-status-good/25",
  watch: "bg-status-watch/15 text-status-watch ring-status-watch/30",
  alert: "bg-status-alert/12 text-status-alert ring-status-alert/25",
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: StatusLevel;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        tone[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label ?? statusLabel[status]}
    </span>
  );
}

import { Badge } from "@/components/ui/badge";

interface OrderBadgeProps {
  index: number; // 1-based position
}

/**
 * Displays a numbered badge indicating the agent's position in the order.
 * Renders a small circular badge with the position number centered.
 */
export function OrderBadge({ index }: OrderBadgeProps) {
  return (
    <Badge aria-label={`Position ${index}`} className="min-w-[22px] justify-center">
      {index}
    </Badge>
  );
}

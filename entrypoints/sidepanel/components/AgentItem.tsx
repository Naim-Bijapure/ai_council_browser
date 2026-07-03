import type { SupportedAppWithRoles } from "@/utils/appRegistry";
import type { AppKey } from "@/utils/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle } from "./DragHandle";
import { OrderBadge } from "./OrderBadge";

interface DragHandleProps {
  disabled: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

interface AgentItemProps {
  agent: SupportedAppWithRoles;
  isSelected: boolean;
  orderIndex: number | null;
  isJudge: boolean;
  isDragged: boolean;
  isDropTarget: boolean;
  dragHandleProps: DragHandleProps;
  onToggle: () => void;
}

/**
 * Renders a single agent row with checkbox, drag handle, and order badge.
 */
export function AgentItem({
  agent,
  isSelected,
  orderIndex,
  isJudge,
  isDragged,
  isDropTarget,
  dragHandleProps,
  onToggle
}: AgentItemProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2 transition-colors",
        isSelected && "bg-accent border-primary/40",
        isDragged && "opacity-50 shadow-md",
        isDropTarget && "border-primary ring-2 ring-primary/20"
      )}
    >
      <label className="flex flex-1 items-center gap-2.5 cursor-pointer">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={isJudge}
        />
        <span className="text-sm text-foreground">
          {agent.displayName}
          {isJudge ? " (Judge)" : ""}
        </span>
      </label>

      {isSelected && orderIndex !== null && (
        <OrderBadge index={orderIndex} />
      )}

      <DragHandle {...dragHandleProps} />
    </div>
  );
}

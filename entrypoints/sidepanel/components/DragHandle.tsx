import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface DragHandleProps {
  disabled: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Renders a grip icon (lucide-react GripVertical) and serves as the drag
 * source element.
 */
export function DragHandle({
  disabled,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: DragHandleProps) {
  return (
    <div
      className={cn(
        "flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors",
        disabled ? "opacity-30 cursor-default" : "cursor-grab hover:text-primary active:cursor-grabbing"
      )}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="button"
      aria-label="Drag to reorder"
      tabIndex={disabled ? -1 : 0}
    >
      <GripVertical className="h-4 w-4" />
    </div>
  );
}

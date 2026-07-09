import { useCallback, useMemo, useState } from "react";
import type { AppKey, RedTeamRole } from "@/utils/types";
import type { SupportedAppWithRoles } from "@/utils/appRegistry";
import { AgentItem } from "./AgentItem";

interface DragHandleProps {
  disabled: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

interface AgentOrderListProps {
  agents: SupportedAppWithRoles[]; // All available agents from appRegistry
  selectedKeys: AppKey[]; // Ordered array of selected agent keys
  judgeKey: AppKey; // Current judge key (excluded from selection)
  showRelayRoles?: boolean;
  showPromptRefinerRoles?: boolean; // Drafter / Enhancer labels by order
  redTeamMode?: boolean; // When true, each selected agent shows a role selector
  redTeamRoles?: Partial<Record<AppKey, RedTeamRole>>;
  onRedTeamRoleChange?: (key: AppKey, role: RedTeamRole) => void;
  onToggle: (key: AppKey) => void; // Callback when agent checkbox toggled
  onReorder: (sourceKey: AppKey, targetKey: AppKey) => void; // Callback when agent dragged to new position
}

/**
 * Renders the ordered list of agents with drag-and-drop capability.
 * Displays selected agents first in their stored order, followed by unselected agents.
 * Manages drag-and-drop state and provides drag event handlers to child AgentItem components.
 */
function relayRoleLabel(orderIndex: number | null): string | null {
  if (orderIndex === null) return null;
  return orderIndex === 1 ? "Author" : "Reviewer";
}

function promptRefinerRoleLabel(orderIndex: number | null): string | null {
  if (orderIndex === null) return null;
  return orderIndex === 1 ? "Drafter" : "Enhancer";
}

export function AgentOrderList({
  agents,
  selectedKeys,
  judgeKey,
  showRelayRoles = false,
  showPromptRefinerRoles = false,
  redTeamMode = false,
  redTeamRoles,
  onRedTeamRoleChange,
  onToggle,
  onReorder
}: AgentOrderListProps) {
  const [draggedKey, setDraggedKey] = useState<AppKey | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<AppKey | null>(null);

  // Filter out judge from the list of displayable agents
  const displayableAgents = useMemo(
    () => agents.filter((agent) => agent.key !== judgeKey),
    [agents, judgeKey]
  );

  // Build ordered list: selected agents first (in selection order), then unselected
  const orderedAgents = useMemo(() => {
    const selectedSet = new Set(selectedKeys);
    const selectedList = selectedKeys
      .map((key) => agents.find((a) => a.key === key))
      .filter((a): a is SupportedAppWithRoles => a !== undefined);

    const unselectedList = displayableAgents.filter(
      (agent) => !selectedSet.has(agent.key)
    );

    return [...selectedList, ...unselectedList];
  }, [selectedKeys, agents, displayableAgents]);

  const handleDragStart = useCallback(
    (key: AppKey) => (e: React.DragEvent) => {
      setDraggedKey(key);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedKey(null);
    setDropTargetKey(null);
  }, []);

  const handleDragOver = useCallback(
    (targetKey: AppKey) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (draggedKey && draggedKey !== targetKey) {
        setDropTargetKey(targetKey);
      }
    },
    [draggedKey]
  );

  const handleDrop = useCallback(
    (targetKey: AppKey) => (e: React.DragEvent) => {
      e.preventDefault();

      if (draggedKey && draggedKey !== targetKey) {
        onReorder(draggedKey, targetKey);
      }

      setDraggedKey(null);
      setDropTargetKey(null);
    },
    [draggedKey, onReorder]
  );

  return (
    <div className="flex flex-col gap-2" role="list">
      {orderedAgents.map((agent) => {
        const isSelected = selectedKeys.includes(agent.key);
        const orderIndex = isSelected ? selectedKeys.indexOf(agent.key) + 1 : null;
        const isDragged = draggedKey === agent.key;
        const isDropTarget = dropTargetKey === agent.key;

        const dragHandleProps: DragHandleProps = {
          disabled: !isSelected,
          onDragStart: handleDragStart(agent.key),
          onDragEnd: handleDragEnd,
          onDragOver: handleDragOver(agent.key),
          onDrop: handleDrop(agent.key)
        };

        return (
          <AgentItem
            key={agent.key}
            agent={agent}
            isSelected={isSelected}
            orderIndex={orderIndex}
            roleLabel={
              showRelayRoles
                ? relayRoleLabel(orderIndex)
                : showPromptRefinerRoles
                  ? promptRefinerRoleLabel(orderIndex)
                  : null
            }
            isJudge={false}
            isDragged={isDragged}
            isDropTarget={isDropTarget}
            dragHandleProps={dragHandleProps}
            redTeamMode={redTeamMode}
            redTeamRole={redTeamRoles?.[agent.key] ?? null}
            onRedTeamRoleChange={onRedTeamRoleChange}
            onToggle={() => onToggle(agent.key)}
          />
        );
      })}
    </div>
  );
}

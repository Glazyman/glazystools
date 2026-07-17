"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { removeCard } from "@/lib/weave/ops";
import type { BoardDoc } from "@/lib/weave/types";
import { CardNode, type CardNodeType } from "./CardNode";

// Module-level: React Flow warns (and re-mounts every node) if this identity
// changes between renders.
const nodeTypes = { card: CardNode };

export type BoardProps = {
  boardId: string;
  doc: BoardDoc;
  /** Cards the mapper just touched — ringed briefly. */
  flash: Set<string>;
  /** Non-null while hovering a transcript line: only these cards stay lit. */
  spotlight: Set<string> | null;
  onDoc: (updater: (d: BoardDoc) => BoardDoc) => void;
  /** Snapshot the current doc for undo. Called before each discrete action. */
  onHistory: () => void;
  onSelect: (ids: string[]) => void;
  onCommitCard: (id: string, patch: { title: string; body: string }) => void;
  onCycleType: (id: string) => void;
};

export function Board(props: BoardProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({
  boardId,
  doc,
  flash,
  spotlight,
  onDoc,
  onHistory,
  onSelect,
  onCommitCard,
  onCycleType,
}: BoardProps) {
  // The instance handed over by onInit — not useReactFlow(). The hook's methods
  // come back inert here (a no-op zoomIn/fitView) while the very same actions
  // work by mouse, so we take the instance React Flow hands us once its pan/zoom
  // is genuinely live, and drive the buttons off that.
  const rf = useRef<ReactFlowInstance<CardNodeType, Edge> | null>(null);
  // Selection is view state, not document state — it must never be saved.
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());

  const linkCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of doc.edges) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return m;
  }, [doc.edges]);

  const nodes: CardNodeType[] = useMemo(
    () =>
      doc.cards.map((card) => ({
        id: card.id,
        type: "card" as const,
        position: { x: card.x, y: card.y },
        selected: selectedNodes.has(card.id),
        data: {
          card,
          flash: flash.has(card.id),
          dimmed: spotlight !== null && !spotlight.has(card.id),
          linkCount: linkCounts.get(card.id) ?? 0,
          onCommit: onCommitCard,
          onCycleType,
        },
      })),
    [
      doc.cards,
      flash,
      spotlight,
      linkCounts,
      selectedNodes,
      onCommitCard,
      onCycleType,
    ],
  );

  const edges: Edge[] = useMemo(
    () =>
      doc.edges.map((e) => {
        const lit =
          spotlight === null ||
          (spotlight.has(e.source) && spotlight.has(e.target));
        const on = selectedEdges.has(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          selected: on,
          reconnectable: true,
          style: {
            stroke: on ? "var(--accent)" : "var(--border-strong)",
            strokeWidth: on ? 2 : 1.5,
            opacity: lit ? 1 : 0.15,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: on ? "var(--accent)" : "var(--border-strong)",
          },
          labelStyle: { fill: "var(--fg-muted)", fontSize: 10 },
          labelBgStyle: { fill: "var(--bg-panel)" },
        };
      }),
    [doc.edges, selectedEdges, spotlight],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CardNodeType>[]) => {
      for (const ch of changes) {
        if (ch.type === "select") {
          setSelectedNodes((prev) => {
            const next = new Set(prev);
            if (ch.selected) next.add(ch.id);
            else next.delete(ch.id);
            onSelect([...next]);
            return next;
          });
        } else if (ch.type === "position" && ch.position) {
          const { id, position } = ch;
          onDoc((d) => ({
            ...d,
            cards: d.cards.map((c) =>
              c.id === id ? { ...c, x: position.x, y: position.y } : c,
            ),
          }));
        } else if (ch.type === "remove") {
          onHistory();
          onDoc((d) => removeCard(d, ch.id));
        }
      }
    },
    [onDoc, onHistory, onSelect],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      for (const ch of changes) {
        if (ch.type === "select") {
          setSelectedEdges((prev) => {
            const next = new Set(prev);
            if (ch.selected) next.add(ch.id);
            else next.delete(ch.id);
            return next;
          });
        } else if (ch.type === "remove") {
          onHistory();
          onDoc((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== ch.id) }));
        }
      }
    },
    [onDoc, onHistory],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      onHistory();
      onDoc((d) => {
        const id = `${c.source}->${c.target}`;
        const rev = `${c.target}->${c.source}`;
        if (d.edges.some((e) => e.id === id || e.id === rev)) return d;
        return {
          ...d,
          edges: [...d.edges, { id, source: c.source!, target: c.target! }],
        };
      });
    },
    [onDoc, onHistory],
  );

  // Dragging an edge end onto a different card rewires it rather than
  // forcing a delete-then-reconnect.
  const onReconnect = useCallback(
    (old: Edge, c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      onHistory();
      onDoc((d) => {
        const id = `${c.source}->${c.target}`;
        const rest = d.edges.filter((e) => e.id !== old.id);
        if (rest.some((e) => e.id === id)) return { ...d, edges: rest };
        return {
          ...d,
          edges: [...rest, { id, source: c.source!, target: c.target! }],
        };
      });
    },
    [onDoc, onHistory],
  );

  const zoomInFn = useCallback(() => rf.current?.zoomIn({ duration: 150 }), []);
  const zoomOutFn = useCallback(
    () => rf.current?.zoomOut({ duration: 150 }),
    [],
  );
  const fitFn = useCallback(
    () => rf.current?.fitView({ padding: 0.25, duration: 400 }),
    [],
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onNodeDragStart={onHistory}
        onInit={(inst) => {
          rf.current = inst;
        }}
        // React Flow's own initial fit: it waits for the nodes to be measured
        // before framing them, which hand-rolling in an effect gets wrong.
        // Weave remounts this component per board (key={boardId}), so each
        // board gets framed exactly once, on open — never mid-thought.
        fitView
        fitViewOptions={{ padding: 0.25 }}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode={["Meta", "Shift"]}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-bg"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--border)"
        />
      </ReactFlow>

      {/* Own zoom controls rather than <Controls/>: React Flow's ship with a
          light theme that would need overriding in the shared globals.css. */}
      <div className="absolute bottom-4 right-4 flex flex-col overflow-hidden rounded-[10px] border border-border bg-panel shadow-card">
        <ZoomBtn title="Zoom in" onClick={zoomInFn}>
          +
        </ZoomBtn>
        <ZoomBtn title="Zoom out" onClick={zoomOutFn}>
          −
        </ZoomBtn>
        <ZoomBtn title="Fit board" onClick={fitFn}>
          ⤢
        </ZoomBtn>
      </div>
    </div>
  );
}

function ZoomBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-8 w-8 border-b border-border text-sm text-muted transition-colors last:border-b-0 hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

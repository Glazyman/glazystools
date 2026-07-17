"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  getBezierPath,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
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

type EdgeData = { onDelete: (id: string) => void; hovered: boolean };

/**
 * An edge you can cut. Selecting it and pressing ⌫ already worked, but nothing
 * on screen said so — this puts the scissors where the line is.
 */
function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<Edge<EdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const hot = data?.hovered ?? false;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data?.onDelete(id);
          }}
          title="Remove this connection"
          // pointerEvents must be re-enabled: the whole label layer is
          // click-through so it can't block the canvas.
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          // Fixed size, colour-only hover. It used to grow when you neared the
          // line, which turned the thing you were aiming at into a moving
          // target. `hovered` is tracked in React, not CSS: EdgeLabelRenderer
          // portals this out of the edge's SVG group, so there's no ancestor
          // for a :hover selector to reach.
          className={[
            "nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full border bg-panel text-[10px] leading-none transition-colors",
            hot
              ? "border-accent-2 text-accent-2 opacity-100"
              : "border-border text-subtle opacity-40",
          ].join(" ")}
        >
          ✕
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { weave: DeletableEdge };

export type BoardProps = {
  boardId: string;
  doc: BoardDoc;
  /** Cards the mapper just touched — ringed briefly. */
  flash: Set<string>;
  /** Non-null while hovering a transcript line: only these cards stay lit. */
  spotlight: Set<string> | null;
  /** Cards with an expand call in flight. */
  expanding: Set<string>;
  onDoc: (updater: (d: BoardDoc) => BoardDoc) => void;
  /** Snapshot the current doc for undo. Called before each discrete action. */
  onHistory: () => void;
  onSelect: (ids: string[]) => void;
  onCommitCard: (id: string, patch: { title: string; body: string }) => void;
  onCycleType: (id: string) => void;
  onExpand: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenFile: (cardId: string, index: number) => void;
  /** Right-clicked a card — Weave owns the menu. */
  onCardContextMenu: (card: CardNodeType["data"]["card"], x: number, y: number) => void;
  /** Hands Weave an imperative handle once the canvas is live. */
  onApi: (api: BoardApi) => void;
};

/** What Weave needs from the canvas that only React Flow can answer. */
export type BoardApi = {
  /** Flow coords at the middle of what you're currently looking at. */
  viewportCenter: () => { x: number; y: number };
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
  expanding,
  onDoc,
  onHistory,
  onSelect,
  onCommitCard,
  onCycleType,
  onExpand,
  onDelete,
  onOpenFile,
  onCardContextMenu,
  onApi,
}: BoardProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  // The instance handed over by onInit — not useReactFlow(). The hook's methods
  // come back inert here (a no-op zoomIn/fitView) while the very same actions
  // work by mouse, so we take the instance React Flow hands us once its pan/zoom
  // is genuinely live, and drive the buttons off that.
  const rf = useRef<ReactFlowInstance<CardNodeType, Edge> | null>(null);
  // Selection is view state, not document state — it must never be saved.
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  // Which edge the cursor is near. React Flow reports this; CSS can't, because
  // the delete button is portalled out of the edge's own group.
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  // React Flow owns node state, and positions reach the document only on drop.
  //
  // The obvious controlled version — derive `nodes` from doc.cards and write
  // every position change straight back — re-renders the whole app on every
  // frame of a drag: new doc → Weave re-renders → the rail re-renders → every
  // card's `data` object is rebuilt → React Flow re-renders all nodes. At 60fps
  // that's what made dragging lurch and the board flicker.
  const [nodes, setNodes, onNodesChangeRF] = useNodesState<CardNodeType>([]);
  const dragging = useRef(false);

  const linkCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of doc.edges) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return m;
  }, [doc.edges]);

  // Rebuild nodes when the document changes — but never mid-drag, or an
  // utterance landing while you're moving a card would snap it back to the
  // position the document still remembers.
  useEffect(() => {
    if (dragging.current) return;
    setNodes((prev) => {
      const wasSelected = new Map(prev.map((n) => [n.id, n.selected]));
      return doc.cards.map((card) => ({
        id: card.id,
        type: "card" as const,
        position: { x: card.x, y: card.y },
        selected: wasSelected.get(card.id) ?? false,
        data: {
          card,
          flash: flash.has(card.id),
          dimmed: spotlight !== null && !spotlight.has(card.id),
          linkCount: linkCounts.get(card.id) ?? 0,
          expanding: expanding.has(card.id),
          onCommit: onCommitCard,
          onCycleType,
          onExpand,
          onDelete,
          onOpenFile,
        },
      }));
    });
  }, [
    doc.cards,
    flash,
    spotlight,
    expanding,
    linkCounts,
    onCommitCard,
    onCycleType,
    onExpand,
    onDelete,
    onOpenFile,
    setNodes,
  ]);

  const deleteEdge = useCallback(
    (id: string) => {
      onHistory();
      onDoc((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== id) }));
    },
    [onDoc, onHistory],
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
          type: "weave" as const,
          data: { onDelete: deleteEdge, hovered: hoveredEdge === e.id },
          source: e.source,
          target: e.target,
          label: e.label,
          selected: on,
          reconnectable: true,
          // A 1.5px line is a cruel thing to ask anyone to hit. This is the
          // invisible band around it that counts as "on the line".
          interactionWidth: 28,
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
    [doc.edges, selectedEdges, spotlight, hoveredEdge, deleteEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CardNodeType>[]) => {
      // Let React Flow move things first — this is the cheap, internal path
      // that keeps a drag at 60fps.
      onNodesChangeRF(changes);
      for (const ch of changes) {
        if (ch.type === "remove") {
          onHistory();
          onDoc((d) => removeCard(d, ch.id));
        }
      }
    },
    [onNodesChangeRF, onDoc, onHistory],
  );

  const onNodeDragStart = useCallback(() => {
    dragging.current = true;
    onHistory();
  }, [onHistory]);

  /** The one place a drag reaches the document. `moved` covers multi-select. */
  const onNodeDragStop = useCallback(
    (_e: unknown, _node: CardNodeType, moved: CardNodeType[]) => {
      dragging.current = false;
      if (!moved.length) return;
      const at = new Map(moved.map((n) => [n.id, n.position]));
      onDoc((d) => ({
        ...d,
        cards: d.cards.map((c) => {
          const p = at.get(c.id);
          return p ? { ...c, x: p.x, y: p.y } : c;
        }),
      }));
    },
    [onDoc],
  );

  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: CardNodeType[] }) => onSelect(sel.map((n) => n.id)),
    [onSelect],
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

  // Publish the handle once. A new card must land in the middle of what you're
  // looking at — appending it to the right edge of the board would drop it
  // somewhere off-screen and feel like nothing happened.
  useEffect(() => {
    onApi({
      viewportCenter: () => {
        const el = wrapper.current;
        const inst = rf.current;
        if (!el || !inst) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return inst.screenToFlowPosition({
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
        });
      },
    });
  }, [onApi]);

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
    <div
      ref={wrapper}
      className="relative h-full w-full"
      // Shift+drag is our selection box, but Shift+click is ALSO the
      // browser's "extend text selection" gesture — without this, dragging a
      // box paints native blue selection across the transcript rail and the
      // rest of the page. Killing the default only when Shift is down leaves
      // normal clicking, dragging, and text selection everywhere else alone.
      onMouseDownCapture={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          onCardContextMenu(node.data.card, e.clientX, e.clientY);
        }}
        onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
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
        // Shift+drag draws a selection box (partial overlap counts) instead of
        // panning; plain drag still pans. Shift had to move OFF
        // multiSelectionKeyCode for that — while it was there, React Flow
        // treated Shift as "add to selection" and swallowed the box gesture.
        // ⌘-click still accumulates a selection card by card.
        selectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Meta"
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

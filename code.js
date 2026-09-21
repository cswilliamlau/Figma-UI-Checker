// UI Checker - No build needed
figma.showUI(__html__, { width: 900, height: 700 });

let compareMode = false;

let screenshotNode = null; // SceneNode
let designFrameNode = null; // SceneNode (Frame / Component)
let screenshotAbs = null;
let designAbs = null;

function isFrameLike(n) {
  return n.type === "FRAME" || n.type === "COMPONENT" || n.type === "COMPONENT_SET" || n.type === "INSTANCE";
}

function getAbsBox(node) {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function isDescendantOf(node, ancestor) {
  let p = node.parent;
  while (p) {
    if (p.id === ancestor.id) return true;
    p = p.parent;
  }
  return false;
}

function guessRoles(sel) {
  // Heuristic:
  // - design frame: frame-like
  // - screenshot: the other one
  // If both are frame-like, keep selection order: [0]=screenshot, [1]=design
  const a = sel[0], b = sel[1];
  if (isFrameLike(a) && !isFrameLike(b)) return { design: a, shot: b };
  if (!isFrameLike(a) && isFrameLike(b)) return { design: b, shot: a };
  return { design: b, shot: a }; // default: second is design
}

function pushReadyState() {
  const sel = figma.currentPage.selection;

  if (sel.length === 2) {
    const { design, shot } = guessRoles(sel);
    figma.ui.postMessage({
      type: "selection-valid",
      valid: true,
      designName: `${design.name} (${design.type})`,
      shotName: `${shot.name} (${shot.type})`,
    });
  } else {
    figma.ui.postMessage({ type: "selection-valid", valid: false });
  }
}

figma.on("selectionchange", async () => {
  pushReadyState();

  // In compare mode, user will single-select a target node inside design frame
  if (!compareMode || !designFrameNode) return;

  const sel = figma.currentPage.selection;
  if (sel.length !== 1) return;

  const target = sel[0];
  if (target.id === designFrameNode.id) return;
  if (!isDescendantOf(target, designFrameNode)) return;

  const tAbs = getAbsBox(target);
  if (!tAbs || !designAbs) return;

  // Export the selected target node as PNG
  const bytes = await target.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });

  figma.ui.postMessage({
    type: "target-selected",
    targetName: `${target.name} (${target.type})`,
    targetAbs: tAbs,
    targetRel: {
      x: tAbs.x - designAbs.x,
      y: tAbs.y - designAbs.y,
      w: tAbs.w,
      h: tAbs.h,
    },
    targetPngBytes: bytes,
  });
});

pushReadyState();

figma.ui.onmessage = async (msg) => {
  if (msg.type === "start-compare") {
    const sel = figma.currentPage.selection;
    if (sel.length !== 2) {
      figma.ui.postMessage({ type: "error", message: "Please select exactly 2 layers: screenshot + design frame." });
      return;
    }

    const { design, shot } = guessRoles(sel);
    designFrameNode = design;
    screenshotNode = shot;

    screenshotAbs = getAbsBox(screenshotNode);
    designAbs = getAbsBox(designFrameNode);

    if (!screenshotAbs || !designAbs) {
      figma.ui.postMessage({ type: "error", message: "Failed to read bounding boxes. Try selecting Frames/Rectangles." });
      return;
    }

    compareMode = true;

    // Export both as PNG
    const shotBytes = await screenshotNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
    const designBytes = await designFrameNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });

    figma.ui.postMessage({
      type: "receive-images",
      screenshotBytes: shotBytes,
      designBytes: designBytes,
      screenshotAbs,
      designAbs,
      hint: "Now select ONE target layer inside the design frame (in the canvas). It will become draggable.",
    });
  }

  if (msg.type === "exit-compare") {
    compareMode = false;
    screenshotNode = null;
    designFrameNode = null;
    screenshotAbs = null;
    designAbs = null;
  }
};

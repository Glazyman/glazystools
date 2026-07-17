import { ToolPage } from "@/components/workspace/ToolPage";
import { Weave } from "./Weave";

export const metadata = { title: "Weave · Glazy's Tools" };

export default function WeavePage() {
  // bleed: the board owns the whole viewport — the centred scrolling column
  // every other tool uses would be actively wrong for a canvas.
  // hideHeader: the breadcrumb already says WEAVE; a second heading would just
  // cost the whiteboard 70px for nothing.
  return (
    <ToolPage slug="weave" bleed hideHeader>
      <Weave />
    </ToolPage>
  );
}

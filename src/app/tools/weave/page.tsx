import { ToolPage } from "@/components/workspace/ToolPage";
import { Weave } from "./Weave";

export const metadata = { title: "Weave · Glazy's Tools" };

export default function WeavePage() {
  // bleed: the board owns the whole viewport — the centred scrolling column
  // every other tool uses would be actively wrong for a canvas.
  return (
    <ToolPage slug="weave" bleed>
      <Weave />
    </ToolPage>
  );
}

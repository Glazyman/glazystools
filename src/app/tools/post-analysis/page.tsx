import { ToolPage } from "@/components/workspace/ToolPage";
import { GrabIt } from "./GrabIt";

export const metadata = { title: "Post Analysis · Glazy's Tools" };

export default function PostAnalysisPage() {
  return (
    <ToolPage slug="post-analysis">
      <GrabIt />
    </ToolPage>
  );
}

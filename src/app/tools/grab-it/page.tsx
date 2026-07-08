import { ToolPage } from "@/components/workspace/ToolPage";
import { GrabIt } from "./GrabIt";

export const metadata = { title: "Grab It · Glazy's Tools" };

export default function GrabItPage() {
  return (
    <ToolPage slug="grab-it">
      <GrabIt />
    </ToolPage>
  );
}

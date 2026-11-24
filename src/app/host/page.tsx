import { developmentSetupHint } from "@/lib/lottery";
import HostDesk from "./host-desk";

export default function HostPage() {
  return <HostDesk initialDevHint={developmentSetupHint()} />;
}

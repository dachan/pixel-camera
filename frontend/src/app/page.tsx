import CameraTabs from "@/components/CameraTabs";
import StatusRow from "@/components/StatusRow";
import { ThermalProvider } from "@/lib/thermal-context";
import { FocusProvider } from "@/lib/focus-context";

export default function Home() {
  return (
    <ThermalProvider>
      <FocusProvider>
        <main className="flex min-h-0 flex-1 flex-col gap-3 bg-stone-200">
          <StatusRow />
          <CameraTabs />
        </main>
      </FocusProvider>
    </ThermalProvider>
  );
}

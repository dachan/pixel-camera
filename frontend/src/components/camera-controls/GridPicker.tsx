"use client";

import Button from "@/components/_shared/Button";
import ButtonGroup from "@/components/_shared/ButtonGroup";
import Slider, { SliderInput } from "@/components/_shared/Slider";
import DragScrollArea from "@/components/DragScrollArea";
import { BackIcon } from "@/components/camera-controls/control-tab-icons";
import { GRID_OVERLAY_ITEMS, type GridOverlayId } from "@/lib/grid-overlays";

export default function GridPicker({
  gridType,
  onGridTypeChange,
  gridOpacity,
  onGridOpacityChange,
  onBack,
}: {
  gridType: GridOverlayId;
  onGridTypeChange: (next: GridOverlayId) => void;
  gridOpacity: number;
  onGridOpacityChange: (next: number) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <Button
        variant="secondary"
        onClick={onBack}
        className="flex h-10.5 shrink-0 items-center justify-center gap-1.5"
      >
        <BackIcon />
        <span className="translate-y-px">Back</span>
      </Button>
      <DragScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4">
          <ButtonGroup
            items={GRID_OVERLAY_ITEMS}
            active={gridType}
            onChange={onGridTypeChange}
            columns={2}
          />
          {gridType !== "none" && (
            <Slider
              orientation="horizontal"
              label="Grid"
              value={`${Math.round(gridOpacity * 100)}%`}
              lockable={false}
            >
              <SliderInput
                orientation="horizontal"
                min={5}
                max={100}
                step={5}
                value={Math.round(gridOpacity * 100)}
                onChange={(e) =>
                  onGridOpacityChange(Number(e.target.value) / 100)
                }
              />
            </Slider>
          )}
        </div>
      </DragScrollArea>
    </div>
  );
}

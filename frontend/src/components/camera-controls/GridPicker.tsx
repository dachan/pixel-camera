"use client";

import ButtonGroup from "@/components/_shared/ButtonGroup";
import Slider, { SliderInput } from "@/components/_shared/Slider";
import DragScrollArea from "@/components/DragScrollArea";
import { GRID_OVERLAY_ITEMS, type GridOverlayId } from "@/lib/grid-overlays";

export default function GridPicker({
  gridType,
  onGridTypeChange,
  gridOpacity,
  onGridOpacityChange,
}: {
  gridType: GridOverlayId;
  onGridTypeChange: (next: GridOverlayId) => void;
  gridOpacity: number;
  onGridOpacityChange: (next: number) => void;
}) {
  return (
    <DragScrollArea className="h-full min-h-0">
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
  );
}

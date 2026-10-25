import { t } from '../../../i18n';
import React from "react"
import type { ExploredBrushOptions, ExploredEditMode } from "../../../lighting/exploredEdits"
import type { StrokeMode } from "../../../tools/shapeStroke"
import { DropdownSliderRow } from "../primitives/DropdownSliderRow"
import { SegmentedControl, type SegmentedOption } from "../primitives/SegmentedControl"

const MODES: readonly SegmentedOption<ExploredEditMode>[] = [
  { value: 'reveal', label: t('light.reveal') },
  { value: 'forget', label: t('light.forget') },
]

const SHAPES: readonly SegmentedOption<StrokeMode>[] = [
  { value: 'brush', label: t('toolbar.brush') },
  { value: 'lasso', label: t('toolbar.lasso') },
  { value: 'rectangle', label: t('toolbar.rectangle') },
]

interface ExploredMemorySectionProps {
  options: ExploredBrushOptions
  onChange: (changes: Partial<ExploredBrushOptions>) => void
}

/**
 * The explored-memory mode's choices in the lighting tool's menu: whether a stroke marks an
 * area as explored or takes its memory away, the stroke's shape, and the brush's size.
 */
export function ExploredMemorySection({ options, onChange }: ExploredMemorySectionProps): React.ReactElement {
  return (
    <div className="atlas-dropdown-section atlas-explored-brush">
      <SegmentedControl value={options.mode} options={MODES} ariaLabel={t('light.whatStrokeDoes')} onChange={(mode) => onChange({ mode })} />
      <SegmentedControl value={options.shape} options={SHAPES} ariaLabel={t('light.strokeShape')} onChange={(shape) => onChange({ shape })} />
      {options.shape === 'brush' && (
        <DropdownSliderRow label={t('light.brushSize')} value={options.brushSize} min={10} max={200} onChange={(brushSize) => onChange({ brushSize })} />
      )}
    </div>
  )
}

import { PROJECT_COLORS } from '@/types/domain'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LabelChip } from '@/components/labels/LabelChip'
import { cn } from '@/lib/utils'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function LabelColorPicker({
  name,
  color,
  onColorChange,
  className,
}: {
  name: string
  color: string
  onColorChange: (color: string) => void
  className?: string
}) {
  const preview = HEX.test(color) ? color : PROJECT_COLORS[0]

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-3">
        <LabelChip name={name.trim() || 'Label'} color={preview} />
        <span className="text-xs text-muted">Live preview</span>
      </div>
      <div className="space-y-2">
        <Label>Preset colors</Label>
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Use ${swatch}`}
              onClick={() => onColorChange(swatch)}
              className="size-7 rounded-full border-2 transition-transform"
              style={{
                backgroundColor: swatch,
                borderColor: color === swatch ? 'var(--foreground)' : 'transparent',
                transform: color === swatch ? 'scale(1.1)' : undefined,
              }}
            />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="label-custom-color">Custom color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={HEX.test(color) && color.length === 7 ? color : '#94a3b8'}
            onChange={(e) => onColorChange(e.target.value)}
            className="size-9 cursor-pointer rounded border border-border-subtle bg-transparent"
            aria-label="Pick custom color"
          />
          <Input
            id="label-custom-color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            placeholder="#94a3b8"
            className="font-mono text-sm"
          />
        </div>
      </div>
    </div>
  )
}
